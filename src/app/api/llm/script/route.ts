import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { generateScript, analyzeProduct } from "@/lib/script-engine/generator";
import type { ScriptStyleType } from "@/lib/script-engine/prompts";
import type { ProductCategory } from "@/lib/script-engine/templates";
import { getDb } from "@/lib/db";
import { scripts as scriptsTable, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** scripts 表 styleType 列允许的枚举值 */
const VALID_SCRIPT_STYLE = new Set(["pain_point", "scene", "comparison", "story", "custom"]);

/** 将本地图片路径转为 base64 data URI，供 LLM 视觉模型使用 */
async function imagePathToBase64(imagePath: string): Promise<string> {
  // 已经是完整 URL 或 base64，直接返回
  if (imagePath.startsWith("http") || imagePath.startsWith("data:")) {
    return imagePath;
  }

  // 本地 API 路径如 /api/files/projectId/filename.png
  // 提取实际文件路径: data/uploads/projectId/filename.png
  const match = imagePath.match(/\/api\/files\/(.+)/);
  if (!match) return imagePath;

  const relativePath = match[1];
  const filePath = join(process.cwd(), "data", "uploads", relativePath);

  try {
    const buffer = await readFile(filePath);
    const base64 = buffer.toString("base64");
    // 根据扩展名推断 MIME 类型
    const ext = filePath.split(".").pop()?.toLowerCase() || "png";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
    };
    const mime = mimeMap[ext] || "image/png";
    return `data:${mime};base64,${base64}`;
  } catch {
    console.warn(`无法读取图片文件: ${filePath}`);
    return imagePath;
  }
}

/** 将前端品类值规范化为引擎支持的 ProductCategory */
function normalizeCategory(raw: unknown): ProductCategory {
  const map: Record<string, ProductCategory> = {
    beauty: "beauty",
    food: "food",
    home: "home",
    fashion: "fashion",
    tech: "tech",
    digital: "tech", // 前端"数码3C"用 digital
    "3c": "tech",
    other: "beauty", // 其他类回退
  };
  return map[String(raw ?? "").toLowerCase()] ?? "beauty";
}

/** 将前端脚本风格值规范化为引擎支持的 ScriptStyleType */
function normalizeStyle(raw: unknown): ScriptStyleType {
  const map: Record<string, ScriptStyleType> = {
    pain_point: "pain_point",
    "pain-point": "pain_point",
    scene: "scene",
    scenario: "scene", // 前端"场景安利"用 scenario
    comparison: "comparison",
    story: "story",
    custom: "custom",
    auto: "pain_point", // 智能推荐默认按痛点种草起手
  };
  return map[String(raw ?? "").toLowerCase()] ?? "pain_point";
}

// 生成带货脚本
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    productImages,
    productName,
    productDescription,
    llmConfig,
  } = body;

  // 兼容前端两种字段命名：category/productCategory、targetDuration/duration
  const category = normalizeCategory(body.category ?? body.productCategory);
  const styleType = normalizeStyle(body.styleType);
  const duration = body.targetDuration ?? body.duration ?? 30;

  if (!productName) {
    return NextResponse.json({ error: "请填写商品名称" }, { status: 400 });
  }

  if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
    return NextResponse.json({ error: "请配置 LLM 参数（baseUrl、apiKey、model）" }, { status: 400 });
  }

  try {
    // 商品图分析：将本地路径转为 base64 后传给视觉模型
    let analysis = body.productAnalysis;
    if (!analysis && productImages?.length > 0 && llmConfig) {
      try {
        const imageUrls = await Promise.all(
          (productImages as string[]).map(imagePathToBase64)
        );
        analysis = await analyzeProduct(imageUrls, llmConfig);
      } catch (e) {
        // 图片分析失败不阻塞脚本生成
        console.warn("商品图片分析失败（已跳过）:", e);
      }
    }

    // 生成脚本（category/styleType/duration 已在上方规范化）
    const scripts = await generateScript({
      productName,
      category,
      productDescription,
      productAnalysis: analysis,
      styleType,
      targetDuration: duration,
      videoMode: body.videoMode,
      priceRange: body.priceRange,
      platforms: body.platforms,
      usageAdvantage: body.usageAdvantage,
      targetAudience: body.targetAudience,
      referenceStructure: body.referenceStructure,
      llmConfig,
    });

    // 落库：把生成的脚本写入 scripts 表，供脚本页/素材页按 projectId 读取
    let savedScripts = scripts;
    const projectId = body.projectId;
    if (projectId) {
      try {
        const db = getDb();
        // 先清掉该项目旧脚本（重新生成时覆盖）
        await db.delete(scriptsTable).where(eq(scriptsTable.projectId, projectId));
        const rows = await db
          .insert(scriptsTable)
          .values(
            scripts.map((s, i) => ({
              projectId,
              version: 1,
              styleType: (VALID_SCRIPT_STYLE.has(s.styleType) ? s.styleType : "custom") as
                | "pain_point" | "scene" | "comparison" | "story" | "custom",
              title: s.title,
              totalDuration: s.totalDuration,
              shots: s.shots,
              selected: i === 0, // 默认选中第一套
            }))
          )
          .returning();
        savedScripts = rows.map((r) => ({
          id: r.id,
          title: r.title ?? "",
          styleType: r.styleType,
          totalDuration: r.totalDuration ?? 0,
          shots: r.shots ?? [],
          selected: r.selected ?? false,
        })) as typeof scripts;
        // 同步项目状态与分析结果
        await db
          .update(projects)
          .set({ status: "scripting", ...(analysis && { productAnalysis: analysis }), updatedAt: new Date() })
          .where(eq(projects.id, projectId));
      } catch (e) {
        // 落库失败不阻塞返回（前端仍可拿到脚本），但记录日志
        console.error("脚本落库失败:", e);
      }
    }

    return NextResponse.json({ scripts: savedScripts, analysis });
  } catch (error) {
    console.error("脚本生成失败:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `脚本生成失败: ${errMsg}` },
      { status: 500 }
    );
  }
}
