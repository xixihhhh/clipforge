"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { SubscriptionPlan } from "@/lib/saas-db/schema";
import { CHECKOUT_REQUEST_ID_HEADER } from "@/lib/saas/stripe-checkout-idempotency";

export function BillingActions({
  plan,
  hasStripeCustomer,
}: {
  plan: SubscriptionPlan;
  hasStripeCustomer: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"checkout" | "portal" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  async function openBilling(path: string, action: "checkout" | "portal") {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(action);
    setError(null);
    setMessage(null);
    const checkoutRequestId = action === "checkout" ? crypto.randomUUID() : null;
    const requestOptions: RequestInit = {
      method: "POST",
      ...(checkoutRequestId
        ? { headers: { [CHECKOUT_REQUEST_ID_HEADER]: checkoutRequestId } }
        : {}),
    };
    try {
      let response: Response;
      try {
        response = await fetch(path, requestOptions);
      } catch (networkError) {
        if (!checkoutRequestId) throw networkError;
        response = await fetch(path, requestOptions);
      }
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Billing request failed");
      window.location.assign(result.url);
    } catch (caught) {
      inFlightRef.current = false;
      setError(caught instanceof Error ? caught.message : "Billing request failed");
      setPending(null);
    }
  }

  async function syncBilling() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPending("sync");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/billing/sync", { method: "POST" });
      const result = await response.json() as {
        synced?: boolean; plan?: string; creditsGranted?: number; error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Billing sync failed");
      setMessage(result.synced
        ? `Billing synced: ${result.plan === "pro" ? "Pro" : "Free"}. Credits added: ${result.creditsGranted ?? 0}.`
        : "No Stripe customer is linked to this account.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Billing sync failed");
    } finally {
      inFlightRef.current = false;
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {plan === "free" && (
        <Button disabled={pending !== null} onClick={() => openBilling("/api/billing/checkout", "checkout")}>
          {pending === "checkout" ? "Opening Checkout…" : "Upgrade to Pro"}
        </Button>
      )}
      {hasStripeCustomer && (
        <Button
          variant="outline"
          disabled={pending !== null}
          onClick={() => openBilling("/api/billing/portal", "portal")}
        >
          {pending === "portal" ? "Opening Portal…" : "Manage subscription"}
        </Button>
      )}
      {hasStripeCustomer && (
        <Button variant="outline" disabled={pending !== null} onClick={syncBilling}>
          {pending === "sync" ? "Syncing billing…" : "Sync billing"}
        </Button>
      )}
      {message && <p role="status" className="w-full text-right text-sm text-muted-foreground">{message}</p>}
      {error && <p className="w-full text-right text-sm text-destructive">{error}</p>}
    </div>
  );
}
