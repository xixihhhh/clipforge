/**
 * Shop-link utilities for 2026 commerce monetization.
 *
 * A creator's product project can carry a storefront URL (shopUrl) — preserved from link ingest or set
 * manually. This module builds a UTM-tagged version of that link so the creator can measure which
 * platform/video drove traffic, and it feeds into publish copy and an end-card QR code.
 *
 * Pure function, unit-testable. The QR-image generation lives in shop-qr.ts (depends on the qrcode lib).
 */

export interface ShopLinkOpts {
  /** distribution platform → utm_source (douyin/kuaishou/xiaohongshu/shipinhao/tiktok/reels/shorts) */
  platform?: string;
  /** optional affiliate/partner code, appended as a generic `aff` param (exact mechanism is platform-specific) */
  affiliateCode?: string;
  /** utm_campaign, defaults to "clipforge" */
  campaign?: string;
}

/**
 * Append UTM tracking params (+ optional affiliate code) to a storefront URL, preserving any existing
 * query/hash. Returns "" for empty/invalid/non-http(s) input so callers can simply skip a falsy result.
 * Pure function.
 */
export function buildShopLink(shopUrl: string | null | undefined, opts: ShopLinkOpts = {}): string {
  const raw = (shopUrl || "").trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return ""; // not a valid absolute URL → skip
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";

  const platform = (opts.platform || "").trim().toLowerCase();
  if (platform) u.searchParams.set("utm_source", platform);
  u.searchParams.set("utm_medium", "short_video");
  u.searchParams.set("utm_campaign", (opts.campaign || "").trim() || "clipforge");

  const aff = (opts.affiliateCode || "").trim();
  if (aff) u.searchParams.set("aff", aff);

  return u.toString();
}
