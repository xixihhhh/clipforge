import { NextResponse } from "next/server";
import { getStripeWebhookConfig } from "@/lib/saas/stripe";
import { processStripeWebhookEvent } from "@/lib/saas/stripe-billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });

  let event;
  try {
    const payload = await request.text();
    const { stripe, webhookSecret } = getStripeWebhookConfig();
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    const result = await processStripeWebhookEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("Stripe webhook processing failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
