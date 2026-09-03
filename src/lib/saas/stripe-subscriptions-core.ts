import type Stripe from "stripe";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/saas-db/schema";

export const PRO_MONTHLY_CREDITS = 1000;

export type StripeSubscriptionSnapshot = {
  customerId: string;
  subscriptionId: string;
  status: SubscriptionStatus;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  appUserIdHint: string | null;
};

export type StripeCheckoutBinding = {
  customerId: string;
  subscriptionId: string | null;
  appUserIdHint: string;
};

export interface StripeWebhookTransaction {
  bindCheckout(input: StripeCheckoutBinding): Promise<string | null>;
  syncSubscription(input: StripeSubscriptionSnapshot, proPriceId: string): Promise<string | null>;
  grantSubscriptionCredits(input: {
    userId: string;
    amount: number;
    invoiceId: string;
    subscriptionId: string;
  }): Promise<void>;
}

export interface StripeWebhookStore {
  processEventOnce(
    event: Pick<Stripe.Event, "id" | "type" | "livemode">,
    operation: (tx: StripeWebhookTransaction) => Promise<string | null>,
  ): Promise<{ duplicate: boolean; userId: string | null }>;
}

export type StripeWebhookDependencies = {
  store: StripeWebhookStore;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  proPriceId: string;
  proMonthlyCredits?: number;
};

const STRIPE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
  "unpaid",
]);

export const HANDLED_STRIPE_EVENT_TYPES = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

function objectId(value: { id: string } | string | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription ?? null;
  return objectId(subscription);
}

function invoicePriceIds(invoice: Stripe.Invoice): string[] {
  return invoice.lines.data.flatMap((line) => {
    const price = line.pricing?.price_details?.price;
    const id = objectId(price ?? null);
    return id ? [id] : [];
  });
}

export function invoiceQualifiesForProCredits(invoice: Stripe.Invoice, proPriceId: string): boolean {
  return (
    invoice.billing_reason !== null &&
    ["subscription", "subscription_create", "subscription_cycle"].includes(invoice.billing_reason) &&
    invoicePriceIds(invoice).includes(proPriceId)
  );
}

export function planForStripeSubscription(
  status: SubscriptionStatus,
  stripePriceId: string | null,
  proPriceId: string,
): SubscriptionPlan {
  return (status === "active" || status === "trialing") && stripePriceId === proPriceId
    ? "pro"
    : "free";
}

export function normalizeStripeSubscription(subscription: Stripe.Subscription): StripeSubscriptionSnapshot {
  if (!STRIPE_SUBSCRIPTION_STATUSES.has(subscription.status as SubscriptionStatus)) {
    throw new Error("Unsupported Stripe subscription status");
  }
  const items = subscription.items.data;
  const currentPeriodEnd = items.length > 0
    ? new Date(Math.max(...items.map((item) => item.current_period_end)) * 1000)
    : null;
  return {
    customerId: objectId(subscription.customer)!,
    subscriptionId: subscription.id,
    status: subscription.status as SubscriptionStatus,
    stripePriceId: items[0]?.price.id ?? null,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    appUserIdHint: subscription.metadata.app_user_id ?? null,
  };
}

export async function handleStripeWebhookEvent(
  event: Stripe.Event,
  dependencies: StripeWebhookDependencies,
): Promise<{ handled: boolean; duplicate: boolean }> {
  if (!HANDLED_STRIPE_EVENT_TYPES.has(event.type)) {
    return { handled: false, duplicate: false };
  }

  const result = await dependencies.store.processEventOnce(event, async (tx) => {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = objectId(session.customer);
      const appUserIdHint = session.metadata?.app_user_id;
      if (!customerId || !appUserIdHint) return null;
      return tx.bindCheckout({
        customerId,
        subscriptionId: objectId(session.subscription),
        appUserIdHint,
      });
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      return tx.syncSubscription(
        normalizeStripeSubscription(event.data.object as Stripe.Subscription),
        dependencies.proPriceId,
      );
    }

    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    if (!subscriptionId) return null;
    const subscription = await dependencies.retrieveSubscription(subscriptionId);
    const snapshot = normalizeStripeSubscription(subscription);
    const invoiceCustomerId = objectId(invoice.customer);
    if (!invoiceCustomerId || invoiceCustomerId !== snapshot.customerId) {
      throw new Error("Stripe invoice customer does not match subscription customer");
    }
    const userId = await tx.syncSubscription(snapshot, dependencies.proPriceId);
    if (
      event.type === "invoice.paid" &&
      userId &&
      invoiceQualifiesForProCredits(invoice, dependencies.proPriceId) &&
      planForStripeSubscription(snapshot.status, snapshot.stripePriceId, dependencies.proPriceId) === "pro"
    ) {
      await tx.grantSubscriptionCredits({
        userId,
        amount: dependencies.proMonthlyCredits ?? PRO_MONTHLY_CREDITS,
        invoiceId: invoice.id,
        subscriptionId,
      });
    }
    return userId;
  });

  return { handled: true, duplicate: result.duplicate };
}
