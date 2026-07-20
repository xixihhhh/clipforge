import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { compositions } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { fileNameOf } from "@/lib/paths";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * GET /api/project/[id]/compositions — list this project's *successful* compositions,
 * newest first, each with a playable/downloadable url. The export page (and any future
 * version picker) reads from here so a failed retry sitting on top of the history can
 * never hide a good take — unlike "latest row regardless of status".
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

    const db = getDb();
    const rows = await db
      .select()
      .from(compositions)
      .where(and(eq(compositions.projectId, id), eq(compositions.status, "done")))
      .orderBy(desc(compositions.createdAt))
      .limit(50);

    const list = rows
      .filter((c) => !!c.outputPath)
      .map((c) => {
        // separator-agnostic: Windows rows store backslash absolute paths (issue #15)
        const fileName = fileNameOf(c.outputPath);
        return { ...c, fileName, url: fileName ? `/api/output/${id}/${fileName}` : null };
      });
    return NextResponse.json({ compositions: list });
  } catch (error) {
    console.error("获取成片列表失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取成片列表失败", "Failed to list compositions") },
      { status: 500 }
    );
  }
}
