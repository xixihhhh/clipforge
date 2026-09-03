CREATE TABLE "stripe_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" varchar(255) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"livemode" boolean NOT NULL,
	"user_id" uuid,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "price_id" TO "stripe_price_id";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD CONSTRAINT "stripe_webhook_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_webhook_events_event_id_unique" ON "stripe_webhook_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_user_created_at_idx" ON "stripe_webhook_events" USING btree ("user_id","created_at");
--> statement-breakpoint

-- Webhook receipts are internal audit/idempotency data. Browser clients get no
-- policy and no table privileges; only the trusted service role may access it.
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.stripe_webhook_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.stripe_webhook_events FROM public, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_webhook_events TO service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select_own ON public.stripe_webhook_events;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_own ON public.stripe_webhook_events;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_own ON public.stripe_webhook_events;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_own ON public.stripe_webhook_events;
--> statement-breakpoint

-- Extend the trusted credit grant function with a dedicated subscription grant
-- source. Invoice IDs are used as reference IDs, so the existing unique ledger
-- index also prevents duplicate credits if distinct Stripe events reference the
-- same paid invoice.
CREATE OR REPLACE FUNCTION private.add_credits(
	p_user_id uuid,
	p_amount bigint,
	p_type text,
	p_source text,
	p_reference_id text,
	p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (new_balance bigint, transaction_id uuid, idempotent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	v_balance bigint;
	v_transaction_id uuid;
	v_existing_amount bigint;
	v_existing_balance bigint;
BEGIN
	IF p_amount <= 0 THEN
		RAISE EXCEPTION 'credit_amount_must_be_positive' USING ERRCODE = '22023';
	END IF;
	IF p_type NOT IN ('grant', 'refund', 'adjustment') THEN
		RAISE EXCEPTION 'invalid_credit_addition_type' USING ERRCODE = '22023';
	END IF;
	IF p_source NOT IN ('signup_bonus', 'plan_grant', 'subscription_grant', 'manual', 'refund', 'rollback') THEN
		RAISE EXCEPTION 'invalid_credit_addition_source' USING ERRCODE = '22023';
	END IF;
	IF NULLIF(btrim(p_reference_id), '') IS NULL THEN
		RAISE EXCEPTION 'credit_reference_is_required' USING ERRCODE = '22023';
	END IF;

	PERFORM pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(p_user_id::text || ':' || p_source || ':' || p_reference_id, 0)
	);

	SELECT ct.id, ct.amount, ct.balance_after
	INTO v_transaction_id, v_existing_amount, v_existing_balance
	FROM public.credit_transactions AS ct
	WHERE ct.user_id = p_user_id
		AND ct.source = p_source
		AND ct.reference_id = p_reference_id;

	IF FOUND THEN
		IF v_existing_amount <> p_amount THEN
			RAISE EXCEPTION 'credit_reference_conflict' USING ERRCODE = '23505';
		END IF;
		RETURN QUERY SELECT v_existing_balance, v_transaction_id, true;
		RETURN;
	END IF;

	BEGIN
		UPDATE public.credit_accounts
		SET balance = balance + p_amount,
			updated_at = now()
		WHERE user_id = p_user_id
		RETURNING balance INTO v_balance;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'credit_account_not_found' USING ERRCODE = 'P0001';
		END IF;

		INSERT INTO public.credit_transactions (
			user_id, amount, balance_after, type, source, reference_id, metadata
		)
		VALUES (
			p_user_id, p_amount, v_balance, p_type, p_source, p_reference_id, COALESCE(p_metadata, '{}'::jsonb)
		)
		RETURNING id INTO v_transaction_id;
	EXCEPTION
		WHEN unique_violation THEN
			SELECT ct.id, ct.amount, ct.balance_after
			INTO v_transaction_id, v_existing_amount, v_existing_balance
			FROM public.credit_transactions AS ct
			WHERE ct.user_id = p_user_id
				AND ct.source = p_source
				AND ct.reference_id = p_reference_id;
			IF NOT FOUND OR v_existing_amount <> p_amount THEN
				RAISE;
			END IF;
			RETURN QUERY SELECT v_existing_balance, v_transaction_id, true;
			RETURN;
	END;

	RETURN QUERY SELECT v_balance, v_transaction_id, false;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.add_credits(uuid, bigint, text, text, text, jsonb) FROM public, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.add_credits(uuid, bigint, text, text, text, jsonb) TO service_role;
