import "server-only";

import Stripe from "stripe";

export const STRIPE_SERVER_ENVIRONMENT_VARIABLES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRO_PRICE_ID",
  "NEXT_PUBLIC_APP_URL",
  "PRO_MONTHLY_CREDITS",
] as const;

let stripeClient: Stripe | undefined;

function requiredEnvironmentVariable(name: (typeof STRIPE_SERVER_ENVIRONMENT_VARIABLES)[number]): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Stripe billing`);
  return value;
}

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(requiredEnvironmentVariable("STRIPE_SECRET_KEY"), {
      appInfo: { name: "ClipForge", version: "0.9.1" },
    });
  }
  return stripeClient;
}

export function getStripeAppUrl(): string {
  const configured = requiredEnvironmentVariable("NEXT_PUBLIC_APP_URL");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS outside localhost");
  }
  return url.origin;
}

export function getStripeCheckoutConfig() {
  return {
    stripe: getStripeClient(),
    appUrl: getStripeAppUrl(),
    proPriceId: requiredEnvironmentVariable("STRIPE_PRO_PRICE_ID"),
  };
}

export function getStripeWebhookConfig() {
  return {
    stripe: getStripeClient(),
    webhookSecret: requiredEnvironmentVariable("STRIPE_WEBHOOK_SECRET"),
    proPriceId: requiredEnvironmentVariable("STRIPE_PRO_PRICE_ID"),
  };
}

export function getProMonthlyCredits(defaultValue: number): number {
  const configured = process.env.PRO_MONTHLY_CREDITS?.trim();
  if (!configured) return defaultValue;
  const amount = Number(configured);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("PRO_MONTHLY_CREDITS must be a positive safe integer");
  }
  return amount;
}
