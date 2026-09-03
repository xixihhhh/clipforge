import type Stripe from "stripe";
import type { SubscriptionPlan } from "@/lib/saas-db/schema";
import {
  invoiceQualifiesForProCredits,
  normalizeStripeSubscription,
  type StripeSubscriptionSnapshot,
} from "@/lib/saas/stripe-subscriptions-core";

export class BillingSyncConflictError extends Error {}

export type BillingSyncDecision = {
  plan: Extract<SubscriptionPlan, "free" | "pro">;
  snapshot: StripeSubscriptionSnapshot | null;
  invoiceId: string | null;
};

function objectId(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

/** Only Stripe API responses belong here, never browser payloads or synthetic events. */
export async function resolveBillingSync(
  owner: { userId: string; customerId: string },
  dependencies: {
    proPriceId: string;
    listSubscriptions(customerId: string): Promise<Stripe.Subscription[]>;
    retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice>;
  },
): Promise<BillingSyncDecision> {
  const stripeSubscriptions = await dependencies.listSubscriptions(owner.customerId);
  for (const subscription of stripeSubscriptions) {
    if (
      objectId(subscription.customer) !== owner.customerId ||
      (subscription.metadata.app_user_id && subscription.metadata.app_user_id !== owner.userId)
    ) {
      throw new BillingSyncConflictError("Stripe subscription ownership mismatch");
    }
    if (subscription.items.has_more) {
      throw new BillingSyncConflictError("Incomplete Stripe subscription items");
    }
  }

  const proSubscriptions = stripeSubscriptions.filter((subscription) =>
    subscription.items.data.some((item) => item.price.id === dependencies.proPriceId),
  );
  const active = proSubscriptions.filter((subscription) =>
    subscription.status === "active" || subscription.status === "trialing",
  );
  if (active.length > 1) {
    throw new BillingSyncConflictError("Multiple active Pro subscriptions require review");
  }
  const selected = active[0] ?? proSubscriptions.sort((a, b) => b.created - a.created)[0];
  if (!selected) return { plan: "free", snapshot: null, invoiceId: null };

  const proItem = selected.items.data.find((item) => item.price.id === dependencies.proPriceId)!;
  const snapshot: StripeSubscriptionSnapshot = {
    ...normalizeStripeSubscription(selected),
    stripePriceId: proItem.price.id,
    currentPeriodEnd: new Date(proItem.current_period_end * 1000),
  };
  if (active.length === 0) return { plan: "free", snapshot, invoiceId: null };

  const decision: BillingSyncDecision = { plan: "pro", snapshot, invoiceId: null };
  const latestInvoiceId = objectId(selected.latest_invoice);
  if (!latestInvoiceId) return decision;
  const invoice = await dependencies.retrieveInvoice(latestInvoiceId);
  if (
    invoice.id !== latestInvoiceId ||
    objectId(invoice.customer) !== owner.customerId ||
    objectId(invoice.parent?.subscription_details?.subscription ?? null) !== selected.id ||
    invoice.livemode !== selected.livemode
  ) {
    throw new BillingSyncConflictError("Stripe invoice ownership mismatch");
  }
  if (
    invoice.status === "paid" &&
    invoice.amount_remaining === 0 &&
    invoiceQualifiesForProCredits(invoice, dependencies.proPriceId) &&
    invoice.lines.data.some((line) =>
      objectId(line.pricing?.price_details?.price ?? null) === dependencies.proPriceId &&
      line.period.start === proItem.current_period_start &&
      line.period.end === proItem.current_period_end &&
      line.parent?.subscription_item_details?.proration !== true,
    )
  ) {
    decision.invoiceId = invoice.id;
  }
  return decision;
}
