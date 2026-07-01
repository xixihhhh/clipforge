import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { join } from "path";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { projects } from "@/lib/db/schema";
import { generateShopQr } from "@/lib/shop-qr";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/shop-qr — generate a scannable "scan to buy" QR PNG for the project's shop link.
 * The encoded link is UTM-tagged (utm_source=platform, campaign=clipforge) for traffic attribution.
 * body: { url?: string (override the project's shopUrl), platform?: string, size?: number }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }

  const db = getDb();
  const [proj] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!proj) return apiError(req, "项目不存在", "Project not found", 404);

  const shopUrl = (typeof body.url === "string" && body.url.trim()) || proj.shopUrl || "";
  if (!shopUrl) {
    return apiError(req, "该项目没有商品链接，请先设置或用 url 传入", "This project has no shop link; set one or pass a url", 400);
  }
  const platform = typeof body.platform === "string" ? body.platform : undefined;
  const size = typeof body.size === "number" ? body.size : undefined;

  const fileName = `shop-qr-${Date.now()}.png`;
  const outPath = join(getDataDir(), "uploads", id, fileName);
  let shopLink: string;
  try {
    shopLink = await generateShopQr(shopUrl, outPath, { platform, affiliateCode: proj.affiliateCode ?? undefined, size });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : errText(req, "二维码生成失败", "QR code generation failed") }, { status: 500 });
  }
  return NextResponse.json({ qr: `/api/files/${id}/${fileName}`, shopLink });
}
