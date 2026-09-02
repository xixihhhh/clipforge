import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { getSaasDb } from "@/lib/saas-db";
import {
  creditAccounts,
  creditTransactions,
  subscriptions,
  type CreditTransactionSource,
  type CreditTransactionType,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "@/lib/saas-db/schema";
import { DEFAULT_SUBSCRIPTION_PLAN, FREE_SIGNUP_CREDITS } from "@/lib/saas/billing-core";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

export class CreditReferenceConflictError extends Error {
  constructor() {
    super("Credit reference already exists with different parameters");
    this.name = "CreditReferenceConflictError";
  }
}

type AtomicCreditResult = {
  new_balance: number | string;
  transaction_id: string;
  idempotent: boolean;
};

function positiveCreditAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError("Credit amount must be a positive safe integer");
  }
  return amount;
}

function translateCreditError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("insufficient_credits")) throw new InsufficientCreditsError();
  if (message.includes("credit_reference_conflict") || message.includes("duplicate key")) {
    throw new CreditReferenceConflictError();
  }
  throw error;
}

function atomicResult(row: AtomicCreditResult | undefined) {
  if (!row) throw new Error("Credit operation returned no result");
  const balance = Number(row.new_balance);
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new Error("Credit operation returned an invalid balance");
  }
  return { balance, transactionId: row.transaction_id, idempotent: row.idempotent };
}

/** Idempotently create the default Free subscription, account, and signup ledger row. */
export async function ensureBillingProfile(userId: string): Promise<void> {
  await getSaasDb().transaction(async (tx) => {
    await tx
      .insert(subscriptions)
      .values({ userId, plan: DEFAULT_SUBSCRIPTION_PLAN, status: "active" })
      .onConflictDoNothing({ target: subscriptions.userId });

    const [createdAccount] = await tx
      .insert(creditAccounts)
      .values({ userId, balance: FREE_SIGNUP_CREDITS })
      .onConflictDoNothing({ target: creditAccounts.userId })
      .returning({ balance: creditAccounts.balance });

    if (createdAccount) {
      await tx.insert(creditTransactions).values({
        userId,
        amount: FREE_SIGNUP_CREDITS,
        balanceAfter: createdAccount.balance,
        type: "grant",
        source: "signup_bonus",
        referenceId: `signup:${userId}`,
        metadata: { reason: "initial_free_signup_grant" },
      });
    }
  });
}

export async function getBillingSummary(userId: string) {
  await ensureBillingProfile(userId);
  const [subscriptionRows, accountRows] = await Promise.all([
    getSaasDb().select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
    getSaasDb().select().from(creditAccounts).where(eq(creditAccounts.userId, userId)).limit(1),
  ]);
  const subscription = subscriptionRows[0];
  const account = accountRows[0];
  if (!subscription || !account) throw new Error("Billing profile is incomplete");
  return { subscription, balance: account.balance };
}

export async function getCreditHistory(userId: string, limit = 50) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  return getSaasDb()
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(safeLimit);
}

export async function consumeCredits(
  userId: string,
  input: {
    amount: number;
    source: "ai_video" | "ai_image" | "tts";
    referenceId: string;
    metadata?: Record<string, unknown>;
  },
) {
  const amount = positiveCreditAmount(input.amount);
  try {
    const rows = await getSaasDb().execute(sql`
      select * from private.consume_credits(
        ${userId}::uuid,
        ${amount}::bigint,
        ${input.source}::text,
        ${input.referenceId}::text,
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `);
    return atomicResult(rows[0] as AtomicCreditResult | undefined);
  } catch (error) {
    return translateCreditError(error);
  }
}

/** Trusted server-only grant/refund path. Never expose amount or target user directly to clients. */
export async function addCreditsTrusted(
  userId: string,
  input: {
    amount: number;
    type: Exclude<CreditTransactionType, "consume">;
    source: Extract<CreditTransactionSource, "signup_bonus" | "plan_grant" | "manual" | "refund" | "rollback">;
    referenceId: string;
    metadata?: Record<string, unknown>;
  },
) {
  const amount = positiveCreditAmount(input.amount);
  try {
    const rows = await getSaasDb().execute(sql`
      select * from private.add_credits(
        ${userId}::uuid,
        ${amount}::bigint,
        ${input.type}::text,
        ${input.source}::text,
        ${input.referenceId}::text,
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `);
    return atomicResult(rows[0] as AtomicCreditResult | undefined);
  } catch (error) {
    return translateCreditError(error);
  }
}

/** Future Stripe webhook/admin path; there is intentionally no user-facing plan mutation API. */
export async function setSubscriptionTrusted(
  userId: string,
  input: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: Date | null;
    priceId?: string | null;
  },
) {
  const [subscription] = await getSaasDb()
    .insert(subscriptions)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return subscription;
}
