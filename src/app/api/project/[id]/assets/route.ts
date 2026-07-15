import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// 获取某项目已生成的素材（素材页恢复状态用）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const rows = await db.select().from(assets).where(eq(assets.projectId, id));
    return NextResponse.json(rows);
  } catch (error) {
    console.error("获取素材失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取素材失败" },
      { status: 500 }
    );
  }
}

/** 把远程图片下载到本地 uploads，返回可访问的 /api/files 路径；本地路径则原样返回 */
async function persistSource(projectId: string, sourceUrl: string, shotId: number): Promise<string> {
  // 已是本项目本地文件，直接复用
  if (sourceUrl.startsWith("/api/files/")) return sourceUrl;

  // base64 data URI（如 OpenAI gpt-image-1 只返回 base64）：直接解码落盘
  if (sourceUrl.startsWith("data:")) {
    const comma = sourceUrl.indexOf(",");
    if (comma === -1) throw new Error("无法解析 data URI 素材");
    const meta = sourceUrl.slice(5, comma); // 如 "image/png;base64"
    const payload = sourceUrl.slice(comma + 1);
    const mime = meta.split(";")[0] || "image/png";
    const buf = /;base64/i.test(meta)
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("mp4") ? "mp4" : "jpg";
    const dir = join(getDataDir(), "uploads", projectId);
    await mkdir(dir, { recursive: true });
    const fileName = `asset-${shotId}-${Date.now()}.${ext}`;
    await writeFile(join(dir, fileName), buf);
    return `/api/files/${projectId}/${fileName}`;
  }

  // 远程 URL：下载到本地，避免合成时依赖外链（且 AI 素材外链常有有效期）
  if (/^https?:\/\//.test(sourceUrl)) {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) throw new Error(`下载素材失败: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get("content-type") || "";
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("mp4") ? "mp4" : "jpg";
    const dir = join(getDataDir(), "uploads", projectId);
    await mkdir(dir, { recursive: true });
    const fileName = `asset-${shotId}-${Date.now()}.${ext}`;
    await writeFile(join(dir, fileName), buf);
    return `/api/files/${projectId}/${fileName}`;
  }

  throw new Error("不支持的素材来源");
}

// 保存/更新某分镜的素材（素材生成成功后落库，供合成读取真实素材）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { shotId, sourceUrl } = body as { shotId?: number; sourceUrl?: string };

    if (typeof shotId !== "number" || !sourceUrl) {
      return NextResponse.json({ error: "缺少 shotId 或 sourceUrl" }, { status: 400 });
    }
    // 校验 projectId 防路径穿越
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
    }

    const filePath = await persistSource(id, sourceUrl, shotId);
    const db = getDb();

    const typeMap: Record<string, "ai_generated" | "product_image" | "user_upload"> = {
      ai_generate: "ai_generated",
      ai_generated: "ai_generated",
      product_image: "product_image",
      user_upload: "user_upload",
    };
    const assetType = typeMap[body.type] ?? "ai_generated";

    // 按 (projectId, shotId) upsert：先删旧再插
    await db.delete(assets).where(and(eq(assets.projectId, id), eq(assets.shotId, shotId)));
    const rows = await db
      .insert(assets)
      .values({
        projectId: id,
        shotId,
        type: assetType,
        filePath,
        provider: body.provider,
        model: body.model,
        prompt: body.prompt,
        status: "done",
      })
      .returning();

    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("保存素材失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存素材失败" },
      { status: 500 }
    );
  }
}
