import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adTemplateRecipes } from "@/lib/db/schema";
import { apiError } from "@/lib/api-error";
import {
  parseAdTemplateShare,
  parseAdTemplateShareAny,
  AD_TEMPLATE_SHARE_KIND,
  AD_TEMPLATE_SHARE_VERSION,
  type AdTemplate,
  type AdTemplateShareError,
} from "@/lib/ad-templates";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { isSaasMode } from "@/lib/saas/runtime";

/**
 * "My templates" — the user-owned side of the template economy. The curated
 * library ships in code; this endpoint persists what the user creates (saving an
 * AI-generated recipe) or brings in (importing a shared JSON file). Both paths
 * run the SAME authoritative validation (sanitize + ad-law screening) server-side
 * by normalizing into the share envelope first — the client's parse is a
 * courtesy preview, never the gate.
 */

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

async function requireLocalTemplateStore() {
  const auth = await requireApiIdentity();
  if (!auth.ok) return auth.response;
  if (isSaasMode()) {
    return NextResponse.json(
      { error: "Personal template storage is not available in SaaS phase one" },
      { status: 403 },
    );
  }
  return null;
}

const SHARE_ERRORS: Record<AdTemplateShareError, { zh: string; en: string }> = {
  invalid_json: { zh: "不是有效的 JSON 文本", en: "Not valid JSON" },
  wrong_kind: { zh: "这不是 ClipForge 模板分享文件", en: "Not a ClipForge template share file" },
  unsupported_version: {
    zh: "模板文件版本比当前应用新，请先升级 ClipForge",
    en: "Template file is newer than this app; please upgrade ClipForge",
  },
  invalid_template: { zh: "模板内容无法解析", en: "Could not parse the template content" },
};

/** GET /api/ad-template/mine —— list saved templates (newest first) */
export async function GET() {
  const unavailable = await requireLocalTemplateStore();
  if (unavailable) return unavailable;
  const db = getDb();
  const rows = await db
    .select()
    .from(adTemplateRecipes)
    .orderBy(desc(adTemplateRecipes.createdAt));
  const templates = rows.map((r) => ({
    ...(r.recipe as AdTemplate),
    id: r.id,
    source: r.source,
  }));
  return NextResponse.json({ templates });
}

/**
 * POST /api/ad-template/mine —— save one template OR a whole pack.
 * body: { share: string } (imported share-file text, single or pack envelope)
 *       OR { template: object, source?: "edit" } (AI custom result / editor fork).
 */
export async function POST(req: NextRequest) {
  const unavailable = await requireLocalTemplateStore();
  if (unavailable) return unavailable;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON");
  }

  const isImport = typeof body.share === "string";
  // normalize both inputs into the share envelope so import and save-from-AI
  // pass through identical sanitize + compliance rules
  const shareText = isImport
    ? (body.share as string)
    : JSON.stringify({
        kind: AD_TEMPLATE_SHARE_KIND,
        version: AD_TEMPLATE_SHARE_VERSION,
        template: body.template,
      });

  const result = parseAdTemplateShareAny(shareText);
  if (!result.templates) {
    const err = SHARE_ERRORS[result.error ?? "invalid_template"];
    return apiError(req, err.zh, err.en, 422);
  }

  const source = body.source === "edit" ? "edit" : isImport ? "import" : "ai";
  const db = getDb();
  const rows = await db
    .insert(adTemplateRecipes)
    .values(result.templates.map((t) => ({ recipe: t, source: source as "ai" | "import" | "edit" })))
    .returning();
  const templates = rows.map((row) => ({ ...(row.recipe as AdTemplate), id: row.id, source: row.source }));

  return NextResponse.json({
    // `template` (first row) kept alongside `templates` so single-save callers stay simple
    template: templates[0],
    templates,
    ...(result.warnings?.length && { warnings: result.warnings }),
  });
}

/**
 * PUT /api/ad-template/mine —— update one saved template in place (recipe editor).
 * body: { id: string, template: object }. Runs the same sanitize + compliance rules.
 */
export async function PUT(req: NextRequest) {
  const unavailable = await requireLocalTemplateStore();
  if (unavailable) return unavailable;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return apiError(req, "请求体不是有效 JSON", "Request body is not valid JSON");
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的模板ID", "Invalid template ID");

  const result = parseAdTemplateShare(
    JSON.stringify({
      kind: AD_TEMPLATE_SHARE_KIND,
      version: AD_TEMPLATE_SHARE_VERSION,
      template: body.template,
    })
  );
  if (!result.template) {
    const err = SHARE_ERRORS[result.error ?? "invalid_template"];
    return apiError(req, err.zh, err.en, 422);
  }

  const db = getDb();
  const [row] = await db
    .update(adTemplateRecipes)
    .set({ recipe: result.template })
    .where(eq(adTemplateRecipes.id, id))
    .returning();
  if (!row) return apiError(req, "模板不存在", "Template not found", 404);

  return NextResponse.json({
    template: { ...(row.recipe as AdTemplate), id: row.id, source: row.source },
    ...(result.warnings?.length && { warnings: result.warnings }),
  });
}

/** DELETE /api/ad-template/mine?id=... —— remove one saved template */
export async function DELETE(req: NextRequest) {
  const unavailable = await requireLocalTemplateStore();
  if (unavailable) return unavailable;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的模板ID", "Invalid template ID");
  const db = getDb();
  await db.delete(adTemplateRecipes).where(eq(adTemplateRecipes.id, id));
  return NextResponse.json({ ok: true });
}
