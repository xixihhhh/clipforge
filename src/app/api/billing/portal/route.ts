import { NextResponse } from "next/server";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { isSaasMode } from "@/lib/saas/runtime";
import { createBillingPortalSession } from "@/lib/saas/stripe-billing";
import { getStripeAppUrl } from "@/lib/saas/stripe";
import { hasTrustedAppOrigin } from "@/lib/saas/stripe-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSaasMode()) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  const access = await requireApiIdentity();
  if (!access.ok || !access.identity) return access.ok
    ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    : access.response;

  try {
    if (!hasTrustedAppOrigin(request, getStripeAppUrl())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = await createBillingPortalSession(access.identity.user.id);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("Unable to create Stripe Billing Portal Session", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Billing portal is temporarily unavailable" }, { status: 503 });
  }
}
