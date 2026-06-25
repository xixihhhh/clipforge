import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { extractJSON } from "@/lib/script-engine/generator";
import { buildPublishPrompt } from "@/lib/publish-pack";

/**
 * 生成发布文案：标题（3 个）、#话题标签、一句话种草文案。
 * 用于带货视频发布到抖音/快手/小红书时直接复制。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productName, productDescription, category, platform, llmConfig, locale } = body;

    if (!productName) {
      return NextResponse.json({ error: "缺少商品名称" }, { status: 400 });
    }
    if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
      return NextResponse.json({ error: "请先配置 LLM" }, { status: 400 });
    }

    const client = new OpenAI({ baseURL: llmConfig.baseUrl, apiKey: llmConfig.apiKey });
    const en = locale === "en";
    const prompt = buildPublishPrompt({ productName, category, productDescription, platform }, en ? "en" : "zh");

    const resp = await client.chat.completions.create({
      model: llmConfig.model,
      messages: [
        { role: "system", content: en ? "You only output JSON, no explanation." : "你只输出 JSON，不输出任何解释。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 1200,
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) throw new Error("LLM 未返回内容");

    const parsed = JSON.parse(extractJSON(content)) as {
      titles?: string[];
      hashtags?: string[];
      caption?: string;
    };

    return NextResponse.json({
      titles: Array.isArray(parsed.titles) ? parsed.titles.slice(0, 3) : [],
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      caption: parsed.caption ?? "",
    });
  } catch (error) {
    console.error("生成发布文案失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成失败" },
      { status: 500 }
    );
  }
}
