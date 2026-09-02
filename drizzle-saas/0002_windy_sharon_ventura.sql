CREATE TABLE "credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_balance_nonnegative" CHECK ("credit_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"type" varchar(32) NOT NULL,
	"source" varchar(64) NOT NULL,
	"reference_id" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_transactions_amount_nonzero" CHECK ("credit_transactions"."amount" <> 0),
	CONSTRAINT "credit_transactions_balance_after_nonnegative" CHECK ("credit_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" varchar(32) DEFAULT 'free' NOT NULL,
	"subscription_status" varchar(32) DEFAULT 'active' NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"current_period_end" timestamp with time zone,
	"price_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_accounts_user_id_unique" ON "credit_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_user_created_at_idx" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_user_source_reference_unique" ON "credit_transactions" USING btree ("user_id","source","reference_id") WHERE "credit_transactions"."reference_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_id_unique" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_unique" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_unique" ON "subscriptions" USING btree ("stripe_subscription_id");
--> statement-breakpoint

-- Existing users receive the same Free subscription and one-time signup grant
-- as users created after this migration.
INSERT INTO public.subscriptions (user_id, plan, subscription_status)
SELECT id, 'free', 'active' FROM public.users
ON CONFLICT (user_id) DO NOTHING;
--> statement-breakpoint

WITH inserted_accounts AS (
	INSERT INTO public.credit_accounts (user_id, balance)
	SELECT id, 100 FROM public.users
	ON CONFLICT (user_id) DO NOTHING
	RETURNING user_id, balance
)
INSERT INTO public.credit_transactions (
	user_id, amount, balance_after, type, source, reference_id, metadata
)
SELECT
	user_id,
	100,
	balance,
	'grant',
	'signup_bonus',
	'signup:' || user_id::text,
	'{"reason":"initial_free_signup_grant"}'::jsonb
FROM inserted_accounts
ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.initialize_billing_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	starting_balance bigint;
BEGIN
	INSERT INTO public.subscriptions (user_id, plan, subscription_status)
	VALUES (NEW.id, 'free', 'active')
	ON CONFLICT (user_id) DO NOTHING;

	INSERT INTO public.credit_accounts (user_id, balance)
	VALUES (NEW.id, 100)
	ON CONFLICT (user_id) DO NOTHING
	RETURNING balance INTO starting_balance;

	IF starting_balance IS NOT NULL THEN
		INSERT INTO public.credit_transactions (
			user_id, amount, balance_after, type, source, reference_id, metadata
		)
		VALUES (
			NEW.id,
			100,
			starting_balance,
			'grant',
			'signup_bonus',
			'signup:' || NEW.id::text,
			'{"reason":"initial_free_signup_grant"}'::jsonb
		)
		ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
	END IF;

	RETURN NEW;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.initialize_billing_for_new_user() FROM public, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS users_initialize_billing ON public.users;
--> statement-breakpoint
CREATE TRIGGER users_initialize_billing
AFTER INSERT ON public.users
FOR EACH ROW
EXECUTE FUNCTION private.initialize_billing_for_new_user();
--> statement-breakpoint

-- Atomic debit. The guarded UPDATE locks the account row and only succeeds
-- when the current balance covers the complete charge. The ledger insert is in
-- the same transaction as the balance change. A duplicate reference rolls the
-- second balance update back and returns the first transaction instead.
CREATE OR REPLACE FUNCTION private.consume_credits(
	p_user_id uuid,
	p_amount bigint,
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
	IF NULLIF(btrim(p_reference_id), '') IS NULL THEN
		RAISE EXCEPTION 'credit_reference_is_required' USING ERRCODE = '22023';
	END IF;
	IF p_source NOT IN ('ai_video', 'ai_image', 'tts') THEN
		RAISE EXCEPTION 'invalid_credit_consumption_source' USING ERRCODE = '22023';
	END IF;

	-- Serialize only duplicate attempts for this idempotency key. Without this
	-- lock, a concurrent retry that waits behind a debit which exhausts the
	-- balance could incorrectly observe "insufficient_credits" before reaching
	-- the unique ledger constraint.
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
		IF v_existing_amount <> -p_amount THEN
			RAISE EXCEPTION 'credit_reference_conflict' USING ERRCODE = '23505';
		END IF;
		RETURN QUERY SELECT v_existing_balance, v_transaction_id, true;
		RETURN;
	END IF;

	BEGIN
		UPDATE public.credit_accounts
		SET balance = balance - p_amount,
			updated_at = now()
		WHERE user_id = p_user_id
			AND balance >= p_amount
		RETURNING balance INTO v_balance;

		IF NOT FOUND THEN
			RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
		END IF;

		INSERT INTO public.credit_transactions (
			user_id, amount, balance_after, type, source, reference_id, metadata
		)
		VALUES (
			p_user_id, -p_amount, v_balance, 'consume', p_source, p_reference_id, COALESCE(p_metadata, '{}'::jsonb)
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
			IF NOT FOUND OR v_existing_amount <> -p_amount THEN
				RAISE;
			END IF;
			RETURN QUERY SELECT v_existing_balance, v_transaction_id, true;
			RETURN;
	END;

	RETURN QUERY SELECT v_balance, v_transaction_id, false;
END
$$;
--> statement-breakpoint

-- Trusted credit grant/refund/adjustment path. This is deliberately not
-- executable by authenticated users and always appends a ledger entry.
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
	IF p_source NOT IN ('signup_bonus', 'plan_grant', 'manual', 'refund', 'rollback') THEN
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

REVOKE ALL ON FUNCTION private.consume_credits(uuid, bigint, text, text, jsonb) FROM public, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.add_credits(uuid, bigint, text, text, text, jsonb) FROM public, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.consume_credits(uuid, bigint, text, text, jsonb) TO service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.add_credits(uuid, bigint, text, text, text, jsonb) TO service_role;
--> statement-breakpoint

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.credit_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.credit_transactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

REVOKE ALL ON TABLE public.subscriptions FROM public, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.credit_accounts FROM public, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.credit_transactions FROM public, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.credit_accounts TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.credit_transactions TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.credit_accounts TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.credit_transactions TO service_role;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_select_own ON public.subscriptions;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_own ON public.subscriptions;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_own ON public.subscriptions;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_own ON public.subscriptions;
--> statement-breakpoint
DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
--> statement-breakpoint
CREATE POLICY subscriptions_select_own
ON public.subscriptions
FOR SELECT
TO authenticated
USING (user_id = private.current_app_user_id());
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_select_own ON public.credit_accounts;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_own ON public.credit_accounts;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_own ON public.credit_accounts;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_own ON public.credit_accounts;
--> statement-breakpoint
DROP POLICY IF EXISTS credit_accounts_select_own ON public.credit_accounts;
--> statement-breakpoint
CREATE POLICY credit_accounts_select_own
ON public.credit_accounts
FOR SELECT
TO authenticated
USING (user_id = private.current_app_user_id());
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_select_own ON public.credit_transactions;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_own ON public.credit_transactions;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_own ON public.credit_transactions;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_own ON public.credit_transactions;
--> statement-breakpoint
DROP POLICY IF EXISTS credit_transactions_select_own ON public.credit_transactions;
--> statement-breakpoint
CREATE POLICY credit_transactions_select_own
ON public.credit_transactions
FOR SELECT
TO authenticated
USING (user_id = private.current_app_user_id());
