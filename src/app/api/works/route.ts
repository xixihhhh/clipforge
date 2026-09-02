import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { compositions, projects } from "@/lib/db/schema";
import { fileNameOf } from "@/lib/paths";
import { extractFirstFrame } from "@/lib/video-composer/frame-extract";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { projectRepository } from "@/lib/saas/project-repository";

/** Poster backfill budget per request — keeps the first works-page load snappy on old libraries. */
const BACKFILL_MAX = 6;

/**
 * GET /api/works — the cross-project works feed: every successful composition,
 * newest first, with project context and a poster thumbnail. "Find that clip by
 * its picture" used to mean opening N projects' export pages one by one.
 *
 * Rows rendered before the thumbnail column existed are backfilled lazily here
 * (first-frame extraction, a few per request) so history gains posters over time.
 */
export async function GET() {
  try {
    const access = await requireApiIdentity();
    if (!access.ok) return access.response;
    const scopedProjectIds = access.identity
      ? (await projectRepository.getProjects(access.identity.user.id)).map((project) => project.id)
      : null;
    if (scopedProjectIds?.length === 0) return NextResponse.json({ works: [] });
    const db = getDb();
    const rows = await db
      .select({
        id: compositions.id,
        projectId: compositions.projectId,
        outputPath: compositions.outputPath,
        thumbnailPath: compositions.thumbnailPath,
        duration: compositions.duration,
        aspectRatio: compositions.aspectRatio,
        label: compositions.label,
        createdAt: compositions.createdAt,
        projectName: projects.name,
        productName: projects.productName,
      })
      .from(compositions)
      .innerJoin(projects, eq(compositions.projectId, projects.id))
      .where(and(
        eq(compositions.status, "done"),
        ...(scopedProjectIds ? [inArray(compositions.projectId, scopedProjectIds)] : []),
      ))
      .orderBy(desc(compositions.createdAt))
      .limit(200);

    let backfilled = 0;
    const works = [] as Array<Record<string, unknown>>;
    for (const c of rows) {
      const fileName = fileNameOf(c.outputPath);
      if (!fileName) continue;
      let thumbName = fileNameOf(c.thumbnailPath);
      // lazy poster backfill for pre-column history (best-effort, budgeted)
      if (!thumbName && backfilled < BACKFILL_MAX && c.outputPath && existsSync(c.outputPath)) {
        backfilled++;
        const thumb = await extractFirstFrame(c.outputPath);
        if (thumb) {
          try {
            await db.update(compositions).set({ thumbnailPath: thumb }).where(eq(compositions.id, c.id));
          } catch { /* poster persistence is best-effort */ }
          thumbName = fileNameOf(thumb);
        }
      }
      works.push({
        id: c.id,
        projectId: c.projectId,
        projectName: c.projectName,
        productName: c.productName,
        label: c.label,
        duration: c.duration,
        aspectRatio: c.aspectRatio,
        createdAt: c.createdAt,
        url: `/api/output/${c.projectId}/${fileName}`,
        thumbnailUrl: thumbName ? `/api/output/${c.projectId}/${thumbName}` : null,
      });
    }
    return NextResponse.json({ works });
  } catch (error) {
    console.error("获取作品流失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取作品流失败" },
      { status: 500 }
    );
  }
}
