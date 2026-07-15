import { NextRequest, NextResponse } from "next/server";

/**
 * AI 平台 Key 连通性校验（生图/生视频平台）。
 * 各平台用最便宜的「鉴权先过」端点探针：
 * - 2xx → ok（Key 有效）
 * - 401/403 → invalid（Key 无效）
 * - 其它(404/400/5xx/网络) → unknown（无法判定，可直接试生成）
 * 走服务端发起，绕开浏览器 CORS；只读探针，不产生计费生成。
 */

const DEFAULT_BASE: Record<string, string> = {
  "atlas-cloud": "https://api.atlascloud.ai/api/v1",
  "fal-ai": "https://queue.fal.run",
  replicate: "https://api.replicate.com/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  alibaba: "https://dashscope.aliyuncs.com/api/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  openai: "https://api.openai.com/v1",
};

type Probe = { url: string; headers: Record<string, string>; authFirst?: boolean; method?: "GET" | "POST"; body?: string };

function buildProbe(name: string, apiKey: string, baseUrl?: string): Probe {
  const base = (baseUrl || DEFAULT_BASE[name] || "").replace(/\/$/, "");
  if (name === "fal-ai") {
    // fal 先校验鉴权再解析 request id：到达 404/422 即说明 Key 有效
    return {
      url: `${base}/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status`,
      headers: { Authorization: `Key ${apiKey}` },
      authFirst: true,
    };
  }
  if (name === "replicate") {
    return { url: `${base}/account`, headers: { Authorization: `Bearer ${apiKey}` } };
  }
  if (name === "alibaba") {
    // dashscope 原生无 /models，用 OpenAI 兼容模式的 /models 验 Key
    return { url: `https://dashscope.aliyuncs.com/compatible-mode/v1/models`, headers: { Authorization: `Bearer ${apiKey}` } };
  }
  if (name === "atlas-cloud") {
    // Atlas 的 GET /models 是公开模型目录，无效 Key 也返回 2xx（会误判为有效）。
    // Atlas 没有 /account、/me、/usage 这类只读鉴权端点，只能用 OpenAI 兼容的 chat/completions 做鉴权探针：
    // 选最便宜的聊天模型 + max_tokens:1，仅靠 401/403 判无效，2xx 即鉴权通过；成本/时延可忽略。
    return {
      url: `${base}/chat/completions`,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        model: "deepseek-ai/deepseek-v3.2",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    };
  }
  // siliconflow / volcengine / 自定义 OpenAI 兼容：GET /models
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
}

export async function POST(req: NextRequest) {
  let body: { name?: string; apiKey?: string; baseUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* 空 body */
  }
  const { name, apiKey, baseUrl } = body;
  if (!name || !apiKey) {
    return NextResponse.json({ status: "unknown", message: "缺少平台或 Key" }, { status: 400 });
  }

  const probe = buildProbe(name, apiKey, baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(probe.url, { method: probe.method ?? "GET", headers: probe.headers, body: probe.body, signal: controller.signal });
    if (r.status === 401 || r.status === 403) {
      return NextResponse.json({ status: "invalid", message: "Key 无效或无权限" });
    }
    if (r.ok || probe.authFirst) {
      // authFirst 平台：非 401/403 即视为鉴权通过
      return NextResponse.json({ status: "ok", message: "连接正常" });
    }
    return NextResponse.json({ status: "unknown", message: `无法判定（HTTP ${r.status}），可直接试生成` });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return NextResponse.json({ status: "unknown", message: aborted ? "超时，无法判定" : "网络异常，无法判定" });
  } finally {
    clearTimeout(timer);
  }
}
