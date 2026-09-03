import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { getSaasDb } from "@/lib/saas-db";
import {
  stripeWebhookEvents,
  subscriptions,
  users,
  type SaasUser,
} from "@/lib/saas-db/schema";
import { ensureBillingProfile, getBillingSummary } from "@/lib/saas/billing";
import {
  PRO_MONTHLY_CREDITS,
  handleStripeWebhookEvent,
  planForStripeSubscription,
  type StripeCheckoutBinding,
  type StripeSubscriptionSnapshot,
  type StripeWebhookStore,
} from "@/lib/saas/stripe-subscriptions-core";
import {
  getStripeAppUrl,
  getStripeCheckoutConfig,
  getStripeClient,
  getProMonthlyCredits,
  getStripeWebhookConfig,
} from "@/lib/saas/stripe";
import { buildCheckoutIdempotencyKey } from "@/lib/saas/stripe-checkout-idempotency";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validAppUserId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

async function getOrCreateStripeCustomer(user: SaasUser, stripe: Stripe): Promise<string> {
  await ensureBillingProfile(user.id);
  return getSaasDb().transaction(async (tx) => {
    await tx.execute(sql`
      select pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(${'stripe-customer:' + user.id}, 0)
      )
    `);
    const [subscription] = await tx
      .select({ stripeCustomerId: subscriptions.stripeCustomerId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id))
      .limit(1);
    if (!subscription) throw new Error("Billing profile is incomplete");
    if (subscription.stripeCustomerId) return subscription.stripeCustomerId;

    const customer = await stripe.customers.create(
      {
        ...(user.email ? { email: user.email } : {}),
        metadata: { app_user_id: user.id },
      },
      { idempotencyKey: `clipforge-customer-${user.id}` },
    );
    await tx
      .update(subscriptions)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(subscriptions.userId, user.id));
    return customer.id;
  });
}

export async function createProCheckoutSession(user: SaasUser, checkoutRequestId: string): Promise<string> {
  const { stripe, appUrl, proPriceId } = getStripeCheckoutConfig();
  const { subscription } = await getBillingSummary(user.id);
  if (subscription.plan === "pro" && (subscription.status === "active" || subscription.status === "trialing")) {
    throw new Error("User already has an active Pro subscription");
  }
  const customerId = await getOrCreateStripeCustomer(user, stripe);
  const stripeSubscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  if (stripeSubscriptions.data.some((item) => !["canceled", "incomplete_expired"].includes(item.status))) {
    throw new Error("Stripe customer already has a subscription that requires management");
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      managed_payments: { enabled: false },
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: proPriceId, quantity: 1 }],
      metadata: { app_user_id: user.id },
      subscription_data: { metadata: { app_user_id: user.id } },
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/dashboard?checkout=canceled`,
    },
    { idempotencyKey: buildCheckoutIdempotencyKey(user.id, checkoutRequestId) },
  );
  if (!session.url) throw new Error("Stripe Checkout did not return a URL");
  return session.url;
}

export async function createBillingPortalSession(userId: string): Promise<string> {
  const [{ subscription }, stripe, appUrl] = await Promise.all([
    getBillingSummary(userId),
    Promise.resolve(getStripeClient()),
    Promise.resolve(getStripeAppUrl()),
  ]);
  if (!subscription.stripeCustomerId) throw new Error("Stripe customer is not available");
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${appUrl}/dashboard`,
  });
  return session.url;
}

const stripeWebhookStore: StripeWebhookStore = {
  async processEventOnce(event, operation) {
    return getSaasDb().transaction(async (tx) => {
      const [receipt] = await tx
        .insert(stripeWebhookEvents)
        .values({ stripeEventId: event.id, eventType: event.type, livemode: event.livemode })
        .onConflictDoNothing({ target: stripeWebhookEvents.stripeEventId })
        .returning({ id: stripeWebhookEvents.id });
      if (!receipt) return { duplicate: true, userId: null };

      async function resolveOwner(
        customerId: string,
        subscriptionId: string | null,
        appUserIdHint: string | null,
      ): Promise<string | null> {
        const linked = await tx
          .select({
            userId: subscriptions.userId,
            stripeCustomerId: subscriptions.stripeCustomerId,
            stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          })
          .from(subscriptions)
          .where(
            subscriptionId
              ? or(
                  eq(subscriptions.stripeCustomerId, customerId),
                  eq(subscriptions.stripeSubscriptionId, subscriptionId),
                )
              : eq(subscriptions.stripeCustomerId, customerId),
          );
        const ownerIds = new Set(linked.map((row) => row.userId));
        if (ownerIds.size > 1) throw new Error("Conflicting Stripe ownership links");
        const linkedOwner = linked[0]?.userId ?? null;
        if (linkedOwner) {
          if (appUserIdHint && appUserIdHint !== linkedOwner) {
            throw new Error("Stripe metadata conflicts with existing customer ownership");
          }
          return linkedOwner;
        }
        if (!validAppUserId(appUserIdHint)) return null;
        const [appUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, appUserIdHint))
          .limit(1);
        return appUser?.id ?? null;
      }

      async function bindCheckout(input: StripeCheckoutBinding): Promise<string | null> {
        const userId = await resolveOwner(input.customerId, input.subscriptionId, input.appUserIdHint);
        if (!userId || userId !== input.appUserIdHint) return null;
        await tx
          .update(subscriptions)
          .set({
            stripeCustomerId: input.customerId,
            ...(input.subscriptionId ? { stripeSubscriptionId: input.subscriptionId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
        return userId;
      }

      async function syncSubscription(
        snapshot: StripeSubscriptionSnapshot,
        proPriceId: string,
      ): Promise<string | null> {
        const userId = await resolveOwner(
          snapshot.customerId,
          snapshot.subscriptionId,
          snapshot.appUserIdHint,
        );
        if (!userId) return null;
        await tx
          .update(subscriptions)
          .set({
            plan: planForStripeSubscription(snapshot.status, snapshot.stripePriceId, proPriceId),
            status: snapshot.status,
            stripeCustomerId: snapshot.customerId,
            stripeSubscriptionId: snapshot.subscriptionId,
            stripePriceId: snapshot.stripePriceId,
            currentPeriodEnd: snapshot.currentPeriodEnd,
            cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
        return userId;
      }

      const userId = await operation({
        bindCheckout,
        syncSubscription,
        async grantSubscriptionCredits(input) {
          if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
            throw new Error("Invalid subscription credit grant");
          }
          await tx.execute(sql`
            select * from private.add_credits(
              ${input.userId}::uuid,
              ${input.amount}::bigint,
              'grant'::text,
              'subscription_grant'::text,
              ${input.invoiceId}::text,
              ${JSON.stringify({
                stripe_invoice_id: input.invoiceId,
                stripe_subscription_id: input.subscriptionId,
              })}::jsonb
            )
          `);
        },
      });
      await tx
        .update(stripeWebhookEvents)
        .set({ userId, processedAt: new Date() })
        .where(and(eq(stripeWebhookEvents.id, receipt.id), eq(stripeWebhookEvents.stripeEventId, event.id)));
      return { duplicate: false, userId };
    });
  },
};

export async function processStripeWebhookEvent(event: Stripe.Event) {
  const { stripe, proPriceId } = getStripeWebhookConfig();
  return handleStripeWebhookEvent(event, {
    store: stripeWebhookStore,
    proPriceId,
    proMonthlyCredits: getProMonthlyCredits(PRO_MONTHLY_CREDITS),
    retrieveSubscription: (subscriptionId) => stripe.subscriptions.retrieve(subscriptionId),
  });
}
