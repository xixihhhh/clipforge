import { readFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  PRO_MONTHLY_CREDITS,
  handleStripeWebhookEvent,
  planForStripeSubscription,
  type StripeSubscriptionSnapshot,
  type StripeWebhookStore,
  type StripeWebhookTransaction,
} from "@/lib/saas/stripe-subscriptions-core";
import {
  buildCheckoutIdempotencyKey,
  CHECKOUT_REQUEST_ID_HEADER,
  isCheckoutRequestId,
} from "@/lib/saas/stripe-checkout-idempotency";

const appUserId = "11111111-1111-4111-8111-111111111111";
const proPriceId = "price_pro_allowlisted";

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function stripeEvent(type: Stripe.Event.Type, object: object, id = `evt_${type.replaceAll(".", "_")}`) {
  return { id, type, livemode: false, data: { object } } as Stripe.Event;
}

function subscription(overrides: Partial<Stripe.Subscription> = {}) {
  return {
    id: "sub_pro",
    object: "subscription",
    customer: "cus_owner",
    status: "active",
    metadata: { app_user_id: appUserId },
    cancel_at_period_end: false,
    items: {
      data: [{ price: { id: proPriceId }, current_period_end: 1_900_000_000 }],
    },
    ...overrides,
  } as Stripe.Subscription;
}

function invoice(paid: boolean) {
  return {
    id: paid ? "in_paid_001" : "in_failed_001",
    object: "invoice",
    customer: "cus_owner",
    billing_reason: "subscription_cycle",
    lines: {
      data: [{ pricing: { type: "price_details", price_details: { price: proPriceId, product: "prod_pro" } } }],
    },
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_pro", metadata: { app_user_id: appUserId } },
      quote_details: null,
    },
  } as unknown as Stripe.Invoice;
}

function harness() {
  const seen = new Set<string>();
  const grants: Array<{ amount: number; invoiceId: string; userId: string }> = [];
  const synced: Array<StripeSubscriptionSnapshot & { plan: string }> = [];
  const checkoutBindings: Array<{ appUserIdHint: string; customerId: string }> = [];
  const tx: StripeWebhookTransaction = {
    async bindCheckout(input) {
      checkoutBindings.push(input);
      return input.appUserIdHint;
    },
    async syncSubscription(input, allowlistedPriceId) {
      synced.push({
        ...input,
        plan: planForStripeSubscription(input.status, input.stripePriceId, allowlistedPriceId),
      });
      return input.appUserIdHint ?? appUserId;
    },
    async grantSubscriptionCredits(input) {
      grants.push(input);
    },
  };
  const store: StripeWebhookStore = {
    async processEventOnce(event, operation) {
      if (seen.has(event.id)) return { duplicate: true, userId: null };
      seen.add(event.id);
      try {
        return { duplicate: false, userId: await operation(tx) };
      } catch (error) {
        seen.delete(event.id);
        throw error;
      }
    },
  };
  return { store, grants, synced, checkoutBindings };
}

describe("Stripe subscriptions", () => {
  it("requires authentication for Checkout and never accepts a client price ID", () => {
    const route = source("src/app/api/billing/checkout/route.ts");
    const service = source("src/lib/saas/stripe-billing.ts");
    expect(route).toContain("requireApiIdentity()");
    expect(route).not.toContain("request.json");
    expect(service).toContain("line_items: [{ price: proPriceId, quantity: 1 }]");
    expect(service).toContain('mode: "subscription"');
    expect(service).toContain("managed_payments: { enabled: false }");
    expect(service).not.toContain("managed_payments: { enabled: true }");
  });

  it("reuses one idempotency key for a retry of the same Checkout request", () => {
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const firstAttempt = buildCheckoutIdempotencyKey(appUserId, requestId);
    const retryAttempt = buildCheckoutIdempotencyKey(appUserId, requestId);
    expect(retryAttempt).toBe(firstAttempt);
    expect(firstAttempt).toBe(`clipforge-pro-checkout-v2:${appUserId}:${requestId}`);
  });

  it("uses a new idempotency key for a new Checkout request", () => {
    const firstRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const nextRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(buildCheckoutIdempotencyKey(appUserId, nextRequestId)).not.toBe(
      buildCheckoutIdempotencyKey(appUserId, firstRequestId),
    );
    expect(isCheckoutRequestId(nextRequestId)).toBe(true);
    expect(isCheckoutRequestId("2026-09-02")).toBe(false);
  });

  it("passes one stable request ID through the client, route, and Stripe request", () => {
    const client = source("src/components/billing-actions.tsx");
    const route = source("src/app/api/billing/checkout/route.ts");
    const service = source("src/lib/saas/stripe-billing.ts");
    expect(client).toContain("crypto.randomUUID()");
    expect(client).toContain("inFlightRef.current");
    expect(client).toContain(`[CHECKOUT_REQUEST_ID_HEADER]: checkoutRequestId`);
    expect(route).toContain("request.headers.get(CHECKOUT_REQUEST_ID_HEADER)");
    expect(route).toContain("isCheckoutRequestId(checkoutRequestId)");
    expect(service).toContain("buildCheckoutIdempotencyKey(user.id, checkoutRequestId)");
    expect(CHECKOUT_REQUEST_ID_HEADER).toBe("x-clipforge-checkout-request-id");
    expect(service).not.toContain("new Date().toISOString().slice(0, 10)");
  });

  it("binds Checkout to the authenticated app user without granting credits", async () => {
    const state = harness();
    await handleStripeWebhookEvent(
      stripeEvent("checkout.session.completed", {
        id: "cs_complete",
        object: "checkout.session",
        customer: "cus_owner",
        subscription: "sub_pro",
        metadata: { app_user_id: appUserId },
      }),
      { store: state.store, proPriceId, retrieveSubscription: async () => subscription() },
    );
    expect(state.checkoutBindings).toEqual([{ appUserIdHint: appUserId, customerId: "cus_owner", subscriptionId: "sub_pro" }]);
    expect(state.grants).toHaveLength(0);
  });

  it("rejects an invalid webhook signature", () => {
    const stripe = new Stripe("unit-test-api-key");
    expect(() => stripe.webhooks.constructEvent("{}", "invalid", "unit-test-signing-key")).toThrow();
    const route = source("src/app/api/stripe/webhook/route.ts");
    expect(route).toContain("await request.text()");
    expect(route).toContain("stripe.webhooks.constructEvent(payload, signature, webhookSecret)");
  });

  it("grants the configured Pro credits for a paid invoice", async () => {
    const state = harness();
    await handleStripeWebhookEvent(stripeEvent("invoice.paid", invoice(true)), {
      store: state.store,
      proPriceId,
      proMonthlyCredits: PRO_MONTHLY_CREDITS,
      retrieveSubscription: async () => subscription(),
    });
    expect(state.grants).toEqual([{ amount: 1000, invoiceId: "in_paid_001", subscriptionId: "sub_pro", userId: appUserId }]);
    expect(state.synced.at(-1)?.plan).toBe("pro");
  });

  it("does not grant the same paid invoice twice when a webhook is replayed", async () => {
    const state = harness();
    const event = stripeEvent("invoice.paid", invoice(true), "evt_invoice_replay");
    const dependencies = {
      store: state.store,
      proPriceId,
      retrieveSubscription: async () => subscription(),
    };
    expect((await handleStripeWebhookEvent(event, dependencies)).duplicate).toBe(false);
    expect((await handleStripeWebhookEvent(event, dependencies)).duplicate).toBe(true);
    expect(state.grants).toHaveLength(1);
  });

  it("does not grant credits when payment fails", async () => {
    const state = harness();
    await handleStripeWebhookEvent(stripeEvent("invoice.payment_failed", invoice(false)), {
      store: state.store,
      proPriceId,
      retrieveSubscription: async () => subscription({ status: "past_due" }),
    });
    expect(state.grants).toHaveLength(0);
    expect(state.synced.at(-1)?.plan).toBe("free");
  });

  it("does not grant credits for a paid invoice without the allowlisted Pro Price", async () => {
    const state = harness();
    const wrongInvoice = invoice(true) as Stripe.Invoice;
    wrongInvoice.lines.data[0]!.pricing!.price_details!.price = "price_unapproved";
    await handleStripeWebhookEvent(stripeEvent("invoice.paid", wrongInvoice), {
      store: state.store,
      proPriceId,
      retrieveSubscription: async () => subscription(),
    });
    expect(state.grants).toHaveLength(0);
  });

  it("downgrades a deleted subscription to Free", async () => {
    const state = harness();
    await handleStripeWebhookEvent(
      stripeEvent("customer.subscription.deleted", subscription({ status: "canceled" })),
      { store: state.store, proPriceId, retrieveSubscription: async () => subscription() },
    );
    expect(state.synced.at(-1)?.plan).toBe("free");
  });

  it("keeps an active subscription Pro while cancellation is pending", async () => {
    const state = harness();
    await handleStripeWebhookEvent(
      stripeEvent("customer.subscription.updated", subscription({ cancel_at_period_end: true })),
      { store: state.store, proPriceId, retrieveSubscription: async () => subscription() },
    );
    expect(state.synced.at(-1)?.plan).toBe("pro");
    expect(state.synced.at(-1)?.cancelAtPeriodEnd).toBe(true);
  });

  it("processes a replayed subscription update only once", async () => {
    const state = harness();
    const event = stripeEvent(
      "customer.subscription.updated",
      subscription({ cancel_at_period_end: true }),
      "evt_subscription_replay",
    );
    const dependencies = { store: state.store, proPriceId, retrieveSubscription: async () => subscription() };
    await handleStripeWebhookEvent(event, dependencies);
    expect((await handleStripeWebhookEvent(event, dependencies)).duplicate).toBe(true);
    expect(state.synced).toHaveLength(1);
  });

  it("does not upgrade an active subscription using an unapproved Price", () => {
    expect(planForStripeSubscription("active", "price_attacker", proPriceId)).toBe("free");
    expect(planForStripeSubscription("trialing", proPriceId, proPriceId)).toBe("pro");
  });

  it("opens the Customer Portal only from the current user's stored customer", () => {
    const route = source("src/app/api/billing/portal/route.ts");
    const service = source("src/lib/saas/stripe-billing.ts");
    expect(route).toContain("requireApiIdentity()");
    expect(route).not.toContain("request.json");
    expect(service).toContain("customer: subscription.stripeCustomerId");
  });

  it("keeps webhook receipts private and invoice grants doubly idempotent", () => {
    const migration = source("drizzle-saas/0003_odd_enchantress.sql").toLowerCase();
    expect(migration).toContain("stripe_webhook_events_event_id_unique");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("force row level security");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("'subscription_grant'");
    const priorMigration = source("drizzle-saas/0002_windy_sharon_ventura.sql").toLowerCase();
    expect(priorMigration).toContain("credit_transactions_user_source_reference_unique");
  });

  it("preserves per-user subscription RLS and rejects cross-tenant ownership conflicts", () => {
    const billingMigration = source("drizzle-saas/0002_windy_sharon_ventura.sql").toLowerCase();
    const service = source("src/lib/saas/stripe-billing.ts");
    expect(billingMigration).toContain("create policy subscriptions_select_own");
    expect(billingMigration).toContain("using (user_id = private.current_app_user_id())");
    expect(billingMigration).not.toContain("create policy subscriptions_update");
    expect(service).toContain("Stripe metadata conflicts with existing customer ownership");
    expect(service).toContain("Conflicting Stripe ownership links");
  });

  it("keeps Free as the safe default and preserves atomic credit consumption", () => {
    expect(planForStripeSubscription("incomplete", proPriceId, proPriceId)).toBe("free");
    expect(planForStripeSubscription("unpaid", proPriceId, proPriceId)).toBe("free");
    const billingMigration = source("drizzle-saas/0002_windy_sharon_ventura.sql").toLowerCase();
    expect(billingMigration).toContain("set balance = balance - p_amount");
    expect(billingMigration).toContain("and balance >= p_amount");
  });
});
