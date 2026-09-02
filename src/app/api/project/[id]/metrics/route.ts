import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { publishMetrics, projects, scripts as scriptsTable } from "@/lib/db/schema";
import { apiError } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;
const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** GET /api/project/[id]/metrics —— list the publish metrics recorded for this project (newest → oldest) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");
  const db = getDb();
  const rows = await db
    .select()
    .from(publishMetrics)
    .where(eq(publishMetrics.projectId, id))
    .orderBy(desc(publishMetrics.createdAt));
  return NextResponse.json({ metrics: rows });
}

/**
 * POST /api/project/[id]/metrics —— record one post-publish metrics entry.
 * style/category are frozen here (prefer the passed-in values; fall back to the project's latest script style / product category),
 * so future style-based aggregation is not contaminated by later edits.
 * body: { style?, category?, platform?, views?, likes?, comments?, shares?, orders?, note?, publishedAt? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is allowed */
  }

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) return apiError(req, "项目不存在", "Project not found", 404);

  let style = typeof body.style === "string" && body.style ? body.style : "";
  if (!style) {
    const [s] = await db
      .select({ styleType: scriptsTable.styleType })
      .from(scriptsTable)
      .where(eq(scriptsTable.projectId, id))
      .orderBy(desc(scriptsTable.version))
      .limit(1);
    style = s?.styleType || "custom";
  }

  const category = typeof body.category === "string" ? body.category : project.productCategory ?? null;
  const [row] = await db
    .insert(publishMetrics)
    .values({
      projectId: id,
      style,
      hookId: typeof body.hookId === "string" && body.hookId ? body.hookId : null,
      category,
      platform: typeof body.platform === "string" ? body.platform : null,
      views: num(body.views),
      likes: num(body.likes),
      comments: num(body.comments),
      shares: num(body.shares),
      orders: num(body.orders),
      note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      publishedAt: body.publishedAt ? new Date(Number(body.publishedAt) || Date.now()) : null,
    })
    .returning();

  return NextResponse.json({ metric: row });
}
