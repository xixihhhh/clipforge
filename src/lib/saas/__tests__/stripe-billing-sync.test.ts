// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { creditAccounts, creditTransactions, subscriptions, type SaasSubscription } from "@/lib/saas-db/schema";
import { getSaasDb } from "@/lib/saas-db";
import { getBillingSummary } from "@/lib/saas/billing";
import { syncBillingForCurrentUser } from "@/lib/saas/stripe-billing-sync";
import { BillingSyncConflictError, resolveBillingSync } from "@/lib/saas/stripe-billing-sync-core";

const stripeMock = vi.hoisted(() => ({
  customer: vi.fn(), subscriptions: vi.fn(), invoice: vi.fn(), lines: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/saas-db", () => ({ getSaasDb: vi.fn() }));
vi.mock("@/lib/saas/billing", () => ({ getBillingSummary: vi.fn() }));
vi.mock("@/lib/saas/stripe", () => ({
  getProMonthlyCredits: () => 1000,
  getStripeCheckoutConfig: () => ({
    proPriceId: "price_pro",
    stripe: {
      customers: { retrieve: stripeMock.customer },
      subscriptions: { list: stripeMock.subscriptions },
      invoices: { retrieve: stripeMock.invoice, listLineItems: stripeMock.lines },
    },
  }),
}));

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const customerId = "cus_owner";
const period = { start: 1_800_000_000, end: 1_802_592_000 };

function subscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_pro", customer: customerId, status: "active", created: period.start,
    metadata: { app_user_id: userId }, livemode: false,
    cancel_at_period_end: false, latest_invoice: "in_current",
    items: { has_more: false, data: [{
      price: { id: "price_pro" }, current_period_start: period.start, current_period_end: period.end,
    }] },
    ...overrides,
  } as Stripe.Subscription;
}

function invoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_current", status: "paid", customer: customerId, livemode: false,
    amount_remaining: 0, billing_reason: "subscription_cycle",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_pro" } },
    lines: { has_more: false, data: [{
      period, pricing: { price_details: { price: "price_pro" } },
      parent: { subscription_item_details: { proration: false } },
    }] },
    ...overrides,
  } as Stripe.Invoice;
}

function dependencies(subs = [subscription()], bill = invoice()) {
  return {
    proPriceId: "price_pro",
    listSubscriptions: vi.fn(async () => subs),
    retrieveInvoice: vi.fn(async () => bill),
  };
}

describe("Stripe billing sync decisions", () => {
  it("restores active Pro using the owner's actual latest paid invoice", async () => {
    const deps = dependencies();
    const result = await resolveBillingSync({ userId, customerId }, deps);
    expect(result.plan).toBe("pro");
    expect(result.invoiceId).toBe("in_current");
    expect(result.snapshot).toMatchObject({ subscriptionId: "sub_pro", customerId, stripePriceId: "price_pro" });
    expect(deps.listSubscriptions).toHaveBeenCalledWith(customerId);
    expect(deps.retrieveInvoice).toHaveBeenCalledWith("in_current");
  });

  it("keeps trialing Pro without inventing a paid invoice", async () => {
    const result = await resolveBillingSync({ userId, customerId }, dependencies([
      subscription({ status: "trialing", latest_invoice: null }),
    ]));
    expect(result).toMatchObject({ plan: "pro", invoiceId: null });
  });

  it("does not upgrade when there is no subscription", async () => {
    expect(await resolveBillingSync({ userId, customerId }, dependencies([])))
      .toEqual({ plan: "free", snapshot: null, invoiceId: null });
  });

  it("does not upgrade an active subscription with the wrong Price", async () => {
    const sub = subscription();
    sub.items.data[0]!.price.id = "price_other";
    expect((await resolveBillingSync({ userId, customerId }, dependencies([sub]))).plan).toBe("free");
  });

  it("downgrades canceled subscriptions and does not grant their historical invoice", async () => {
    const deps = dependencies([subscription({ status: "canceled" })]);
    expect(await resolveBillingSync({ userId, customerId }, deps)).toMatchObject({
      plan: "free", snapshot: { status: "canceled" }, invoiceId: null,
    });
    expect(deps.retrieveInvoice).not.toHaveBeenCalled();
  });

  it("retains Pro while cancel_at_period_end is pending", async () => {
    expect(await resolveBillingSync({ userId, customerId }, dependencies([
      subscription({ cancel_at_period_end: true }),
    ]))).toMatchObject({ plan: "pro", snapshot: { cancelAtPeriodEnd: true } });
  });

  it.each([
    { customer: "cus_someone_else" },
    { metadata: { app_user_id: otherUserId } },
  ])("rejects cross-user subscription ownership %j", async (override) => {
    await expect(resolveBillingSync({ userId, customerId }, dependencies([subscription(override)])))
      .rejects.toBeInstanceOf(BillingSyncConflictError);
  });

  it("rejects an invoice for another customer", async () => {
    await expect(resolveBillingSync({ userId, customerId }, dependencies(
      [subscription()], invoice({ customer: "cus_someone_else" }),
    ))).rejects.toBeInstanceOf(BillingSyncConflictError);
  });

  it("rejects an invoice for another subscription", async () => {
    const bill = invoice();
    bill.parent!.subscription_details!.subscription = "sub_other";
    await expect(resolveBillingSync({ userId, customerId }, dependencies([subscription()], bill)))
      .rejects.toBeInstanceOf(BillingSyncConflictError);
  });

  it("never grants an unpaid invoice", async () => {
    const result = await resolveBillingSync({ userId, customerId }, dependencies(
      [subscription()], invoice({ status: "open", amount_remaining: 2000 }),
    ));
    expect(result).toMatchObject({ plan: "pro", invoiceId: null });
  });

  it("never backfills a previous billing period", async () => {
    const bill = invoice();
    bill.lines.data[0]!.period = { start: period.start - 100, end: period.start };
    expect((await resolveBillingSync({ userId, customerId }, dependencies([subscription()], bill))).invoiceId).toBeNull();
  });

  it("fails closed for ambiguous multiple active Pro subscriptions", async () => {
    await expect(resolveBillingSync({ userId, customerId }, dependencies([
      subscription(), subscription({ id: "sub_second" }),
    ]))).rejects.toBeInstanceOf(BillingSyncConflictError);
  });
});

describe("trusted sync persistence (mocked Stripe and database)", () => {
  const dialect = new PgDialect();
  let local: SaasSubscription;
  let balance: number;
  let ledger: Set<string>;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    local = {
      id: "local_sub", userId, plan: "free", status: "active",
      stripeCustomerId: customerId, stripeSubscriptionId: null, stripePriceId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
      updatedAt: new Date(0), createdAt: new Date(0),
    };
    balance = 90;
    ledger = new Set();
    vi.mocked(getBillingSummary).mockImplementation(async (requestedUser) => {
      expect(requestedUser).toBe(userId);
      return { subscription: { ...local }, balance };
    });
    stripeMock.customer.mockResolvedValue({ id: customerId, metadata: { app_user_id: userId } });
    stripeMock.subscriptions.mockImplementation(async function* () { yield subscription(); });
    stripeMock.invoice.mockResolvedValue(invoice());
    execute = vi.fn(async (query: SQL) => {
      const parsed = dialect.sqlToQuery(query);
      if (parsed.sql.includes("private.add_credits")) {
        expect(parsed.params[0]).toBe(userId);
        expect(parsed.sql).toContain("'subscription_grant'");
        const reference = String(parsed.params[2]);
        if (!ledger.has(reference)) {
          balance += Number(parsed.params[1]);
          ledger.add(reference);
        }
      }
      return [];
    });
    const db = {
      execute,
      select: () => ({ from: (table: unknown) => ({ where: (query: SQL) => {
        const { params } = dialect.sqlToQuery(query);
        expect(params[0]).toBe(userId);
        const read = async () => {
          if (table === subscriptions) return [{ ...local }];
          if (table === creditAccounts) return [{ balance }];
          if (table === creditTransactions) {
            expect(params[1]).toBe("subscription_grant");
            return ledger.has(String(params[2])) ? [{ id: "existing_grant" }] : [];
          }
          throw new Error("Unexpected table");
        };
        return { for: read, limit: read };
      } }) }),
      update: (table: unknown) => ({ set: (values: Partial<SaasSubscription>) => ({ where: async (query: SQL) => {
        expect(table).toBe(subscriptions);
        expect(dialect.sqlToQuery(query).params).toEqual([userId, customerId]);
        local = { ...local, ...values };
      } }) }),
      transaction: async <T,>(operation: (tx: unknown) => Promise<T>): Promise<T> => operation(db),
    };
    vi.mocked(getSaasDb).mockReturnValue(db as unknown as ReturnType<typeof getSaasDb>);
  });

  it("restores Free/90 to Pro/1090, then repeated sync grants nothing", async () => {
    expect(await syncBillingForCurrentUser(userId)).toMatchObject({ plan: "pro", balance: 1090, creditsGranted: 1000 });
    expect(await syncBillingForCurrentUser(userId)).toMatchObject({
      plan: "pro", balance: 1090, creditsGranted: 0, invoiceAlreadyProcessed: true,
    });
    expect(ledger.size).toBe(1);
    expect(execute.mock.calls.filter(([query]) => dialect.sqlToQuery(query).sql.includes("private.add_credits"))).toHaveLength(1);
    expect(stripeMock.subscriptions).toHaveBeenCalledWith({ customer: customerId, status: "all", limit: 100 });
  });

  it("skips a ledger invoice already granted by the webhook", async () => {
    ledger.add("in_current");
    balance = 1090;
    expect(await syncBillingForCurrentUser(userId)).toMatchObject({
      plan: "pro", balance: 1090, creditsGranted: 0, invoiceAlreadyProcessed: true,
    });
    expect(execute.mock.calls.some(([query]) => dialect.sqlToQuery(query).sql.includes("private.add_credits"))).toBe(false);
  });

  it("does not retain stale Pro after Stripe cancellation", async () => {
    local.plan = "pro";
    stripeMock.subscriptions.mockImplementation(async function* () { yield subscription({ status: "canceled" }); });
    expect(await syncBillingForCurrentUser(userId)).toMatchObject({ plan: "free", balance: 90, creditsGranted: 0 });
    expect(local.status).toBe("canceled");
    expect(ledger.size).toBe(0);
  });

  it("does not contact Stripe or create a customer when there is no local binding", async () => {
    local.stripeCustomerId = null;
    expect(await syncBillingForCurrentUser(userId)).toMatchObject({ synced: false, reason: "no_customer" });
    expect(stripeMock.customer).not.toHaveBeenCalled();
  });

  it("cannot write when Stripe customer metadata belongs to B", async () => {
    stripeMock.customer.mockResolvedValue({ id: customerId, metadata: { app_user_id: otherUserId } });
    await expect(syncBillingForCurrentUser(userId)).rejects.toBeInstanceOf(BillingSyncConflictError);
    expect(local.plan).toBe("free");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not overwrite a webhook change during Stripe retrieval", async () => {
    stripeMock.invoice.mockImplementation(async () => {
      local.updatedAt = new Date(100);
      return invoice();
    });
    await expect(syncBillingForCurrentUser(userId)).rejects.toBeInstanceOf(BillingSyncConflictError);
    expect(local.plan).toBe("free");
    expect(ledger.size).toBe(0);
  });

  it("does not downgrade or grant when Stripe is unavailable", async () => {
    local.plan = "pro";
    stripeMock.customer.mockRejectedValue(new Error("Stripe unavailable"));
    await expect(syncBillingForCurrentUser(userId)).rejects.toThrow("Stripe unavailable");
    expect(local.plan).toBe("pro");
    expect(ledger.size).toBe(0);
  });
});
