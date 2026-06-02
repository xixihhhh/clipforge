export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects, assets, compositions, videoClips, analyticsEvents } from "@/lib/db/schema";
import { eq, sql, inArray } from "drizzle-orm";

// 获取项目统计数据
export async function GET() {
  try {
    const db = getDb();

    // 1. 总项目数
    const [{ count: totalProjects }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(projects);

    // 2. 已完成项目数（status = "done"）
    const [{ count: completedProjects }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(projects)
      .where(eq(projects.status, "done"));

    // 3. 生成中项目数（status 属于中间状态）
    const [{ count: generatingProjects }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(projects)
      .where(
        inArray(projects.status, ["scripting", "assets", "video", "composing"])
      );

    // 4. 失败项目数：存在失败的 composition 但没有已完成 composition 的项目
    const failedProjectRows = await db
      .select({ projectId: compositions.projectId })
      .from(compositions)
      .where(eq(compositions.status, "failed"))
      .groupBy(compositions.projectId);

    const doneProjectRows = await db
      .select({ projectId: compositions.projectId })
      .from(compositions)
      .where(eq(compositions.status, "done"))
      .groupBy(compositions.projectId);

    const doneProjectIds = new Set(doneProjectRows.map((r) => r.projectId));
    const failedProjects = failedProjectRows.filter(
      (r) => !doneProjectIds.has(r.projectId)
    ).length;

    // 5. 总视频时长（已完成的 compositions 时长之和，单位毫秒）
    const [{ totalDuration }] = await db
      .select({
        totalDuration: sql<number>`coalesce(cast(sum(${compositions.duration}) as integer), 0)`,
      })
      .from(compositions)
      .where(eq(compositions.status, "done"));

    // 6. 总素材数（所有 assets + video clips）
    const [{ count: totalAssets }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(assets);

    const [{ count: totalVideoClips }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(videoClips);

    return NextResponse.json({
      totalProjects,
      completedProjects,
      generatingProjects,
      failedProjects,
      totalDuration, // 毫秒，前端可转换为 分:秒
      totalAssets: totalAssets + totalVideoClips,
    });
  } catch (error) {
    console.error("获取统计数据失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取统计数据失败" },
      { status: 500 }
    );
  }
}

// 记录分析事件（视频生成 / 导出 / 分享）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { eventType, projectId, metadata } = body;

    // 校验 eventType
    const validEventTypes = ["video_generate", "export", "share"];
    if (!eventType || !validEventTypes.includes(eventType)) {
      return NextResponse.json(
        {
          error: `无效的事件类型，必须为: ${validEventTypes.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const db = getDb();

    // 如果传了 projectId，校验项目是否存在
    if (projectId) {
      const [existingProject] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!existingProject) {
        return NextResponse.json(
          { error: "指定的项目不存在" },
          { status: 404 }
        );
      }
    }

    const [newEvent] = await db
      .insert(analyticsEvents)
      .values({
        eventType: eventType as "video_generate" | "export" | "share",
        projectId: projectId || null,
        metadata: metadata || null,
      })
      .returning();

    return NextResponse.json(newEvent, { status: 201 });
  } catch (error) {
    console.error("记录分析事件失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "记录分析事件失败" },
      { status: 500 }
    );
  }
}
