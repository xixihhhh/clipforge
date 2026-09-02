import type { SubscriptionPlan } from "@/lib/saas-db/schema";

export const DEFAULT_SUBSCRIPTION_PLAN: SubscriptionPlan = "free";
export const FREE_SIGNUP_CREDITS = 100;

export const PLAN_CATALOG: Record<
  SubscriptionPlan,
  { name: string; available: boolean; description: string }
> = {
  free: { name: "Free", available: true, description: "Starter plan" },
  pro: { name: "Pro", available: true, description: "Paid creator plan" },
  business: { name: "Business", available: false, description: "Reserved for business accounts" },
  team: { name: "Team", available: false, description: "Reserved for team workspaces" },
};

export const CREDIT_USAGE_COSTS = {
  ai_video: 10,
  ai_image: 1,
  tts: 1,
} as const;

export type MeteredUsage = keyof typeof CREDIT_USAGE_COSTS;

export function isMeteredUsage(value: unknown): value is MeteredUsage {
  return typeof value === "string" && Object.hasOwn(CREDIT_USAGE_COSTS, value);
}

export function isSafeCreditReference(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9:_-]{8,255}$/.test(value);
}

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === "string" && Object.hasOwn(PLAN_CATALOG, value);
}
