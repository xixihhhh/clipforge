export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// 获取单个项目
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const result = await db.select().from(projects).where(eq(projects.id, id));

    if (result.length === 0) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("获取项目失败:", error);
    return NextResponse.json({ error: "获取项目失败" }, { status: 500 });
  }
}

// 更新项目
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const db = getDb();

    const result = await db
      .update(projects)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("更新项目失败:", error);
    return NextResponse.json({ error: "更新项目失败" }, { status: 500 });
  }
}

// 删除项目
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    await db.delete(projects).where(eq(projects.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除项目失败:", error);
    return NextResponse.json({ error: "删除项目失败" }, { status: 500 });
  }
}
