import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREDIT_USAGE_COSTS,
  DEFAULT_SUBSCRIPTION_PLAN,
  FREE_SIGNUP_CREDITS,
  PLAN_CATALOG,
  isMeteredUsage,
  isSafeCreditReference,
} from "@/lib/saas/billing-core";

const migration = readFileSync(
  join(process.cwd(), "drizzle-saas", "0002_windy_sharon_ventura.sql"),
  "utf8",
).toLowerCase();

function route(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("SaaS billing and credits", () => {
  it("creates every user on the Free plan", () => {
    expect(DEFAULT_SUBSCRIPTION_PLAN).toBe("free");
    expect(PLAN_CATALOG.free.available).toBe(true);
    expect(PLAN_CATALOG.pro.available).toBe(true);
    expect(PLAN_CATALOG.business.available).toBe(false);
    expect(PLAN_CATALOG.team.available).toBe(false);
    expect(migration).toContain("values (new.id, 'free', 'active')");
  });

  it("starts new and existing users with one recorded signup grant", () => {
    expect(FREE_SIGNUP_CREDITS).toBe(100);
    expect(migration).toContain("values (new.id, 100)");
    expect(migration).toContain("'signup_bonus'");
    expect(migration).toContain("'signup:' || new.id::text");
  });

  it("uses one guarded SQL update for atomic concurrent deduction", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("pg_catalog.hashtextextended");
    expect(migration).toMatch(
      /update public\.credit_accounts[\s\S]*set balance = balance - p_amount[\s\S]*where user_id = p_user_id[\s\S]*and balance >= p_amount[\s\S]*returning balance into v_balance/,
    );
    expect(migration).toContain("when unique_violation then");
  });

  it("rejects insufficient balance instead of allowing a negative account", () => {
    expect(migration).toContain("credit_accounts_balance_nonnegative");
    expect(migration).toContain("raise exception 'insufficient_credits'");
  });

  it("only lets user A read user A's subscription, account, and ledger", () => {
    for (const table of ["subscriptions", "credit_accounts", "credit_transactions"]) {
      expect(migration).toContain(`create policy ${table}_select_own`);
      expect(migration).toContain("using (user_id = private.current_app_user_id())");
    }
  });

  it("does not let authenticated user A modify user B's plan or balances", () => {
    expect(migration).toContain("revoke all on table public.subscriptions from public, anon, authenticated");
    expect(migration).toContain("grant select on table public.subscriptions to authenticated");
    expect(migration).not.toContain("grant select, insert, update, delete on table public.subscriptions to authenticated");
    expect(migration).not.toContain("create policy subscriptions_update");
    expect(migration).not.toContain("create policy credit_accounts_update");
  });

  it("enables and forces RLS on every billing table", () => {
    for (const table of ["subscriptions", "credit_accounts", "credit_transactions"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("keeps credit mutation functions unavailable to ordinary authenticated users", () => {
    expect(migration).toContain(
      "revoke all on function private.consume_credits(uuid, bigint, text, text, jsonb) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function private.consume_credits(uuid, bigint, text, text, jsonb) to service_role",
    );
  });

  it("derives consume cost and user identity on the server", () => {
    const consumeRoute = route("src/app/api/billing/credits/consume/route.ts");
    expect(consumeRoute).toContain("access.identity!.user.id");
    expect(consumeRoute).toContain("CREDIT_USAGE_COSTS[body.usage]");
    expect(consumeRoute).not.toContain("body.userId");
    expect(consumeRoute).not.toContain("body.amount");
  });

  it("validates metered operations and idempotency references", () => {
    expect(CREDIT_USAGE_COSTS.ai_video).toBeGreaterThan(CREDIT_USAGE_COSTS.ai_image);
    expect(isMeteredUsage("ai_video")).toBe(true);
    expect(isMeteredUsage("manual")).toBe(false);
    expect(isSafeCreditReference("request:12345678")).toBe(true);
    expect(isSafeCreditReference("../bad")).toBe(false);
  });

  it("keeps Stripe secrets in a server-only module", () => {
    const stripeModule = route("src/lib/saas/stripe.ts");
    expect(stripeModule).toMatch(/^import "server-only";/);
    expect(stripeModule).not.toContain("NEXT_PUBLIC_STRIPE_SECRET");
  });
});
