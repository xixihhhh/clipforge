// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { POST } from "@/app/api/billing/sync/route";
import { BillingSyncConflictError } from "@/lib/saas/stripe-billing-sync-core";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sync: vi.fn(), saas: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/saas/authorization", () => ({ requireApiIdentity: mocks.auth }));
vi.mock("@/lib/saas/stripe-billing-sync", () => ({ syncBillingForCurrentUser: mocks.sync }));
vi.mock("@/lib/saas/runtime", () => ({ isSaasMode: mocks.saas }));
vi.mock("@/lib/saas/stripe", () => ({ getStripeAppUrl: () => "http://localhost:3000" }));

function request(body?: object, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/billing/sync?user_id=user_B&stripe_customer_id=cus_B", {
    method: "POST", headers: { origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saas.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ ok: true, identity: { user: { id: "user_A" } } });
  mocks.sync.mockResolvedValue({ synced: true, plan: "pro", balance: 1090, creditsGranted: 1000 });
});

describe("POST /api/billing/sync", () => {
  it("rejects unauthenticated callers before reaching Stripe", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("ignores user/customer/amount/plan spoofing and syncs only authenticated A", async () => {
    const response = await POST(request({ user_id: "user_B", stripe_customer_id: "cus_B", amount: 999999, plan: "pro" }));
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith("user_A");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects cross-origin requests", async () => {
    expect((await POST(request(undefined, "https://attacker.example"))).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("remains unavailable in Electron/local mode", async () => {
    mocks.saas.mockReturnValue(false);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("reports concurrent/ownership conflicts without leaking identifiers", async () => {
    mocks.sync.mockRejectedValue(new BillingSyncConflictError("private details"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private details");
  });
});
