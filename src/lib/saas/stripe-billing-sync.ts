import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { getSaasDb } from "@/lib/saas-db";
import { creditAccounts, creditTransactions, subscriptions } from "@/lib/saas-db/schema";
import { getBillingSummary } from "@/lib/saas/billing";
import { getProMonthlyCredits, getStripeCheckoutConfig } from "@/lib/saas/stripe";
import { PRO_MONTHLY_CREDITS } from "@/lib/saas/stripe-subscriptions-core";
import { BillingSyncConflictError, resolveBillingSync } from "@/lib/saas/stripe-billing-sync-core";

/** The caller must obtain userId from requireApiIdentity(), never request data. */
export async function syncBillingForCurrentUser(userId: string) {
  const { subscription: local, balance } = await getBillingSummary(userId);
  const customerId = local.stripeCustomerId;
  if (!customerId) {
    return { synced: false, reason: "no_customer", plan: local.plan, balance, creditsGranted: 0 };
  }

  // No webhook signing secret is needed: the authenticated Stripe API is the source.
  const { stripe, proPriceId } = getStripeCheckoutConfig();
  const customer = await stripe.customers.retrieve(customerId);
  if (
    customer.id !== customerId || customer.deleted ||
    (customer.metadata.app_user_id && customer.metadata.app_user_id !== userId)
  ) {
    throw new BillingSyncConflictError("Stripe customer ownership mismatch");
  }
  const decision = await resolveBillingSync({ userId, customerId }, {
    proPriceId,
    async listSubscriptions(ownCustomerId) {
      const result: Stripe.Subscription[] = [];
      for await (const subscription of stripe.subscriptions.list({
        customer: ownCustomerId, status: "all", limit: 100,
      })) result.push(subscription);
      return result;
    },
    async retrieveInvoice(invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.lines.has_more) {
        const lines: Stripe.InvoiceLineItem[] = [];
        for await (const line of stripe.invoices.listLineItems(invoiceId, { limit: 100 })) lines.push(line);
        invoice.lines = { ...invoice.lines, data: lines, has_more: false };
      }
      return invoice;
    },
  });

  return getSaasDb().transaction(async (tx) => {
    const [current] = await tx.select().from(subscriptions)
      .where(eq(subscriptions.userId, userId)).for("update");
    // A webhook/customer change during the Stripe reads must not be overwritten.
    if (!current || current.stripeCustomerId !== customerId ||
      current.updatedAt.getTime() !== local.updatedAt.getTime()) {
      throw new BillingSyncConflictError("Billing changed during sync; retry");
    }
    const { snapshot } = decision;
    await tx.update(subscriptions).set({
      plan: decision.plan,
      status: snapshot?.status ?? "canceled",
      stripeCustomerId: customerId,
      stripeSubscriptionId: snapshot?.subscriptionId ?? null,
      stripePriceId: snapshot?.stripePriceId ?? null,
      currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: snapshot?.cancelAtPeriodEnd ?? false,
      updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
    }).where(and(eq(subscriptions.userId, userId), eq(subscriptions.stripeCustomerId, customerId)));

    let creditsGranted = 0;
    let invoiceAlreadyProcessed = false;
    if (decision.invoiceId && snapshot) {
      // Same lock, source, and reference as private.add_credits / invoice.paid.
      // Check after the lock so a concurrent webhook or a changed grant setting
      // cannot turn an already processed invoice into a second grant.
      await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(${userId + ':subscription_grant:' + decision.invoiceId}, 0)
      )`);
      const [existing] = await tx.select({ id: creditTransactions.id }).from(creditTransactions)
        .where(and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.source, "subscription_grant"),
          eq(creditTransactions.referenceId, decision.invoiceId),
        )).limit(1);
      invoiceAlreadyProcessed = Boolean(existing);
      if (!existing) {
        const amount = getProMonthlyCredits(PRO_MONTHLY_CREDITS);
        await tx.execute(sql`select * from private.add_credits(
          ${userId}::uuid, ${amount}::bigint, 'grant'::text, 'subscription_grant'::text,
          ${decision.invoiceId}::text,
          ${JSON.stringify({
            stripe_invoice_id: decision.invoiceId,
            stripe_subscription_id: snapshot.subscriptionId,
            reconciliation: "authenticated_billing_sync",
          })}::jsonb
        )`);
        creditsGranted = amount;
      }
    }
    const [account] = await tx.select({ balance: creditAccounts.balance }).from(creditAccounts)
      .where(eq(creditAccounts.userId, userId)).limit(1);
    if (!account) throw new Error("Credit account is missing");
    return {
      synced: true, plan: decision.plan, balance: account.balance,
      creditsGranted, invoiceAlreadyProcessed,
    };
  });
}
