import "server-only";

export const STRIPE_SERVER_ENVIRONMENT_VARIABLES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_BUSINESS",
  "STRIPE_PRICE_TEAM",
] as const;

export function getStripeServerConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return null;
  return {
    secretKey,
    webhookSecret,
    priceIds: {
      pro: process.env.STRIPE_PRICE_PRO ?? null,
      business: process.env.STRIPE_PRICE_BUSINESS ?? null,
      team: process.env.STRIPE_PRICE_TEAM ?? null,
    },
  };
}
