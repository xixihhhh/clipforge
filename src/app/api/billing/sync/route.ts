import { NextResponse } from "next/server";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { isSaasMode } from "@/lib/saas/runtime";
import { syncBillingForCurrentUser } from "@/lib/saas/stripe-billing-sync";
import { BillingSyncConflictError } from "@/lib/saas/stripe-billing-sync-core";
import { getStripeAppUrl } from "@/lib/saas/stripe";
import { hasTrustedAppOrigin } from "@/lib/saas/stripe-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSaasMode()) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  const access = await requireApiIdentity();
  if (!access.ok) return access.response;
  if (!access.identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (!hasTrustedAppOrigin(request, getStripeAppUrl())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // There are no customer, user, subscription, price or amount input parameters.
    const result = await syncBillingForCurrentUser(access.identity.user.id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BillingSyncConflictError) {
      return NextResponse.json({ error: "Billing sync conflict. Refresh and retry; contact support if it persists." }, { status: 409 });
    }
    // Never serialize Stripe/DB errors: they can include request data or credentials.
    console.error("Stripe billing sync failed");
    return NextResponse.json({ error: "Billing sync is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
