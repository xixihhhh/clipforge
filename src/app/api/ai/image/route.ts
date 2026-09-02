import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/providers";
import { toRemoteUsableImage } from "@/lib/remote-image";
import { apiError, errText } from "@/lib/api-error";
import { requireProjectAccess } from "@/lib/saas/authorization";
import { isSaasMode } from "@/lib/saas/runtime";
import { mediaReferencesBelongToProject } from "@/lib/saas/media-access";

// AI image generation
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider: providerName, model, prompt, imageUrl, imageUrls, mode, apiKey, baseUrl, options, projectId } = body;

  if (!providerName || !model || !prompt) {
    return apiError(req, "缺少必要参数", "Missing required parameters");
  }

  if (!apiKey) {
    return apiError(req, "缺少 API Key，请先在设置中配置对应平台", "Missing API Key, please configure the corresponding platform in settings first");
  }

  if (isSaasMode() && (typeof projectId !== "string" || !projectId)) {
    return apiError(req, "SaaS 模式必须指定项目", "A project is required in SaaS mode", 400);
  }
  if (typeof projectId === "string" && projectId) {
    const projectAccess = await requireProjectAccess(projectId);
    if (!projectAccess.ok) return projectAccess.response;
    if (
      projectAccess.identity &&
      !mediaReferencesBelongToProject(projectId, [
        imageUrl,
        ...(Array.isArray(imageUrls) ? imageUrls : []),
      ])
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });

    // For image-to-image mode, convert local reference images to data URIs.
    // imageUrls (plural) feeds multi-reference edits (e.g. character sheet + product photo);
    // the array order is preserved so prompts can cite references by position.
    const referenceImageUrl = await toRemoteUsableImage(imageUrl);
    const referenceImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
      ? (await Promise.all((imageUrls as string[]).map(toRemoteUsableImage))).filter((u): u is string => !!u)
      : undefined;

    const result = await provider.generateImage({
      modelId: model,
      mode: mode || "text-to-image",
      prompt,
      referenceImageUrl,
      ...(referenceImageUrls?.length && { referenceImageUrls }),
      ...options,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("生图失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "生图失败", "Image generation failed") },
      { status: 500 }
    );
  }
}
