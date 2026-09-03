export const CHECKOUT_REQUEST_ID_HEADER = "x-clipforge-checkout-request-id";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCheckoutRequestId(value: string | null): value is string {
  return value !== null && UUID_V4_PATTERN.test(value);
}

export function buildCheckoutIdempotencyKey(userId: string, checkoutRequestId: string): string {
  if (!isCheckoutRequestId(checkoutRequestId)) {
    throw new Error("Invalid Checkout request ID");
  }
  return `clipforge-pro-checkout-v2:${userId}:${checkoutRequestId}`;
}
