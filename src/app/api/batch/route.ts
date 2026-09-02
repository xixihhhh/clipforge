import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { batchJobItems, batchJobs } from "@/lib/db/schema";
import { apiError } from "@/lib/api-error";
import { isSaasMode } from "@/lib/saas/runtime";
import { requireApiIdentity } from "@/lib/saas/authorization";

async function rejectSaasBatch(req: NextRequest) {
  if (!isSaasMode()) return null;
  const access = await requireApiIdentity();
  if (!access.ok) return access.response;
  return apiError(req, "SaaS 第一阶段暂不支持批量任务", "Batch jobs are not available in SaaS phase one", 403);
}

/**
 * Batch job persistence (batch_jobs / batch_job_items).
 *
 * The /batch executor still runs in the page, but every stage transition is
 * written through here, so progress and per-item project/composition back-links
 * survive a refresh or crash — and an unfinished job can offer "continue where
 * it left off, skipping the N items already done".
 *
 * POST  { config, items: [{ productId, productName, variation? }] } → { jobId, itemIds }
 * PATCH { jobId, status } | { itemId, patch: { status?, projectId?, compositionId?, error? } }
 * GET   ?active=1 → latest running job + items; ?jobId=xxx → that job + items
 */
export async function POST(req: NextRequest) {
  const saasResponse = await rejectSaasBatch(req);
  if (saasResponse) return saasResponse;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      config?: Record<string, unknown>;
      items?: Array<{ productId?: unknown; productName?: unknown; variation?: unknown }>;
    };
    const items = Array.isArray(body.items)
      ? body.items.filter((i) => typeof i?.productId === "string" && typeof i?.productName === "string")
      : [];
    if (items.length === 0) return apiError(req, "缺少批量条目", "Missing batch items");

    const db = getDb();
    // one live job at a time: starting a new batch settles any stale running job
    await db.update(batchJobs).set({ status: "cancelled", updatedAt: new Date() }).where(eq(batchJobs.status, "running"));
    const [job] = await db
      .insert(batchJobs)
      .values({ status: "running", total: items.length, config: body.config ?? {} })
      .returning();
    const rows = await db
      .insert(batchJobItems)
      .values(
        items.map((i) => ({
          jobId: job.id,
          productId: i.productId as string,
          productName: i.productName as string,
          variation: typeof i.variation === "string" ? i.variation : null,
        }))
      )
      .returning({ id: batchJobItems.id, productId: batchJobItems.productId });
    return NextResponse.json({ jobId: job.id, items: rows }, { status: 201 });
  } catch (error) {
    console.error("创建批量任务失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建批量任务失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const saasResponse = await rejectSaasBatch(req);
  if (saasResponse) return saasResponse;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      jobId?: unknown;
      status?: unknown;
      itemId?: unknown;
      patch?: { status?: unknown; projectId?: unknown; compositionId?: unknown; error?: unknown };
    };
    const db = getDb();

    if (typeof body.itemId === "string") {
      const p = body.patch ?? {};
      const ITEM_STATUSES = ["pending", "generating", "composing", "done", "failed"];
      await db
        .update(batchJobItems)
        .set({
          ...(typeof p.status === "string" && ITEM_STATUSES.includes(p.status)
            ? { status: p.status as "pending" | "generating" | "composing" | "done" | "failed" }
            : {}),
          ...(typeof p.projectId === "string" ? { projectId: p.projectId } : {}),
          ...(typeof p.compositionId === "string" ? { compositionId: p.compositionId } : {}),
          ...(typeof p.error === "string" ? { error: p.error.slice(0, 500) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(batchJobItems.id, body.itemId));
      return NextResponse.json({ ok: true });
    }

    if (typeof body.jobId === "string" && typeof body.status === "string" && ["running", "done", "cancelled"].includes(body.status)) {
      await db
        .update(batchJobs)
        .set({ status: body.status as "running" | "done" | "cancelled", updatedAt: new Date() })
        .where(eq(batchJobs.id, body.jobId));
      return NextResponse.json({ ok: true });
    }

    return apiError(req, "无效的更新请求", "Invalid update request");
  } catch (error) {
    console.error("更新批量任务失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新批量任务失败" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const saasResponse = await rejectSaasBatch(req);
  if (saasResponse) return saasResponse;
  try {
    const db = getDb();
    const jobId = req.nextUrl.searchParams.get("jobId");
    const activeOnly = req.nextUrl.searchParams.get("active") === "1";

    const [job] = jobId
      ? await db.select().from(batchJobs).where(eq(batchJobs.id, jobId)).limit(1)
      : activeOnly
        ? await db.select().from(batchJobs).where(eq(batchJobs.status, "running")).orderBy(desc(batchJobs.createdAt)).limit(1)
        : await db.select().from(batchJobs).orderBy(desc(batchJobs.createdAt)).limit(1);
    if (!job) return NextResponse.json({ job: null, items: [] });
    const items = await db.select().from(batchJobItems).where(eq(batchJobItems.jobId, job.id));
    return NextResponse.json({ job, items });
  } catch (error) {
    console.error("查询批量任务失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "查询批量任务失败" },
      { status: 500 }
    );
  }
}
