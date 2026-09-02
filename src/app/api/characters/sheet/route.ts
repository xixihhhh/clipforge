import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { createProvider } from "@/lib/providers";
import { buildCharacterSheetPrompt } from "@/lib/character-sheet";
import { apiError, errText } from "@/lib/api-error";
import { isSaasMode } from "@/lib/saas/runtime";
import { requireApiIdentity } from "@/lib/saas/authorization";

/**
 * POST /api/characters/sheet — generate a presenter's 2x2 multi-view reference
 * sheet (front / side / back / close-up in ONE generation, so it's physically
 * the same person). The client stores the returned path on the character; the
 * storyboard grid and film passes then attach it as a reference image to keep
 * the presenter's identity locked across shots and videos.
 *
 * body: { appearance, name?, provider, model, apiKey, baseUrl?, options? }
 */
export async function POST(req: NextRequest) {
  if (isSaasMode()) {
    const access = await requireApiIdentity();
    if (!access.ok) return access.response;
    return apiError(
      req,
      "SaaS 第一阶段尚未迁移共享主播素材库",
      "The shared presenter media library is not available in SaaS phase one",
      501,
    );
  }

  try {
    const body = await req.json();
    const { appearance, name, provider: providerName, model, apiKey, baseUrl, options } = body as {
      appearance?: string;
      name?: string;
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      options?: Record<string, unknown>;
    };
    if (!appearance?.trim()) {
      return apiError(req, "缺少外观描述——先给主播写一段外观", "Missing appearance — describe the presenter first", 400);
    }
    if (!providerName || !model) {
      return apiError(req, "缺少 provider / model", "Missing provider / model", 400);
    }
    if (!apiKey) {
      return apiError(req, "缺少 API Key，请先在设置中配置生图平台", "Missing API key — configure an image provider in settings first", 400);
    }

    const prompt = buildCharacterSheetPrompt(appearance.trim(), name);
    const provider = createProvider({ name: providerName, apiKey, baseUrl: baseUrl ?? "" });
    const result = await provider.generateImage({
      ...(options ?? {}),
      modelId: model,
      mode: "text-to-image",
      prompt,
    });
    const sourceUrl = result.imageUrls?.[0];
    if (!sourceUrl) throw new Error("生图未返回图片");

    // persist into uploads/characters — served via /api/files/characters/<file>
    const dir = join(getDataDir(), "uploads", "characters");
    await mkdir(dir, { recursive: true });
    let buf: Buffer;
    let ext = "png";
    if (sourceUrl.startsWith("data:")) {
      const comma = sourceUrl.indexOf(",");
      if (comma === -1) throw new Error("无法解析 data URI 图片");
      buf = Buffer.from(sourceUrl.slice(comma + 1), "base64");
      const meta = sourceUrl.slice(5, comma);
      if (meta.includes("webp")) ext = "webp";
      else if (meta.includes("jpeg") || meta.includes("jpg")) ext = "jpg";
    } else if (/^https?:\/\//.test(sourceUrl)) {
      const resp = await fetch(sourceUrl);
      if (!resp.ok) throw new Error(`下载定妆图失败: ${resp.status}`);
      buf = Buffer.from(await resp.arrayBuffer());
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("webp")) ext = "webp";
      else if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
    } else {
      throw new Error("不支持的图片来源");
    }
    const fileName = `sheet-${Date.now()}.${ext}`;
    await writeFile(join(dir, fileName), buf);

    return NextResponse.json({ url: `/api/files/characters/${fileName}`, prompt });
  } catch (error) {
    console.error("多视图定妆生成失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "多视图定妆生成失败", "Character sheet generation failed") },
      { status: 500 }
    );
  }
}
