import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { publishMetrics, projects, scripts as scriptsTable } from "@/lib/db/schema";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;
const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** GET /api/project/[id]/metrics —— 列出该项目录入的投放数据（新→旧） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
  const db = getDb();
  const rows = await db
    .select()
    .from(publishMetrics)
    .where(eq(publishMetrics.projectId, id))
    .orderBy(desc(publishMetrics.createdAt));
  return NextResponse.json({ metrics: rows });
}

/**
 * POST /api/project/[id]/metrics —— 录入一条发布后的投放数据。
 * style/category 在此定格（优先取传入，否则取项目最新脚本风格 / 项目品类），便于后续按风格聚合不被改动污染。
 * body: { style?, category?, platform?, views?, likes?, comments?, shares?, orders?, note?, publishedAt? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* 允许空 body */
  }

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

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
