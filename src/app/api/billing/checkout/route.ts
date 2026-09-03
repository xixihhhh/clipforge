import { NextResponse } from "next/server";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { isSaasMode } from "@/lib/saas/runtime";
import { createProCheckoutSession } from "@/lib/saas/stripe-billing";
import { getStripeAppUrl } from "@/lib/saas/stripe";
import {
  CHECKOUT_REQUEST_ID_HEADER,
  isCheckoutRequestId,
} from "@/lib/saas/stripe-checkout-idempotency";
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
    const checkoutRequestId = request.headers.get(CHECKOUT_REQUEST_ID_HEADER);
    if (!isCheckoutRequestId(checkoutRequestId)) {
      return NextResponse.json({ error: "Invalid Checkout request ID" }, { status: 400 });
    }
    const url = await createProCheckoutSession(access.identity.user, checkoutRequestId);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("Unable to create Stripe Checkout Session", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Billing is temporarily unavailable" }, { status: 503 });
  }
}
