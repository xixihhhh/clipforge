/**
 * Shop-link QR code generation — renders a scannable QR PNG pointing at the (UTM-tagged) storefront link,
 * for an end-card "scan to buy" overlay (a proven 2026 short-video commerce conversion pattern) or manual use.
 *
 * The PNG is produced by the pure-JS `qrcode` lib (no native deps). Burning it into the video end-card is
 * done at compose time; this module only generates the image so it can be wired in and used via CLI/MCP now.
 */
import { dirname } from "path";
import { mkdir } from "fs/promises";
import QRCode from "qrcode";
import { buildShopLink, type ShopLinkOpts } from "@/lib/shop-link";

export interface ShopQrOptions extends ShopLinkOpts {
  /** output PNG side length in px (default 512, clamped 128–2048) */
  size?: number;
  /** quiet-zone margin in modules (default 2) */
  margin?: number;
  /** foreground (dark) color, default black */
  dark?: string;
  /** background (light) color, default white */
  light?: string;
}

/**
 * Generate a QR PNG for a shop link and write it to outPath. The link is UTM-tagged via buildShopLink.
 * Returns the UTM-tagged URL that was encoded. Throws if the shopUrl is empty/invalid (nothing to encode).
 */
export async function generateShopQr(shopUrl: string, outPath: string, opts: ShopQrOptions = {}): Promise<string> {
  const link = buildShopLink(shopUrl, opts);
  if (!link) throw new Error("无效的商品链接，无法生成二维码");
  const width = Math.min(2048, Math.max(128, Math.round(opts.size ?? 512)));
  await mkdir(dirname(outPath), { recursive: true });
  await QRCode.toFile(outPath, link, {
    type: "png",
    width,
    margin: Math.max(0, Math.round(opts.margin ?? 2)),
    color: { dark: opts.dark || "#000000", light: opts.light || "#FFFFFF" },
    errorCorrectionLevel: "M",
  });
  return link;
}
