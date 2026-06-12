import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scripts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

// 获取某项目的全部脚本方案（脚本页 / 素材页按 projectId 读取真实数据）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const rows = await db
      .select()
      .from(scripts)
      .where(eq(scripts.projectId, id))
      .orderBy(desc(scripts.createdAt));
    return NextResponse.json(rows);
  } catch (error) {
    console.error("获取脚本失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取脚本失败" },
      { status: 500 }
    );
  }
}

// 更新某条脚本的选中状态（用户在脚本页切换选中的方案）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const selectedId = body.selectedScriptId as string | undefined;
    if (!selectedId) {
      return NextResponse.json({ error: "缺少 selectedScriptId" }, { status: 400 });
    }
    const db = getDb();
    // 该项目下所有脚本先取消选中，再选中目标
    const rows = await db.select().from(scripts).where(eq(scripts.projectId, id));
    for (const r of rows) {
      await db
        .update(scripts)
        .set({ selected: r.id === selectedId })
        .where(eq(scripts.id, r.id));
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("更新脚本选中状态失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 500 }
    );
  }
}
