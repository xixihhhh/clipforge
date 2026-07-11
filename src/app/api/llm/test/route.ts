import { NextRequest, NextResponse } from "next/server";
import { errText } from "@/lib/api-error";

/**
 * Server-side LLM connection test.
 * Must run server-side: direct browser requests to provider APIs are blocked by CORS, causing a false "connection failed" error even when the API key is valid.
 *
 * 传了 model 时做「模型级」校验：真实调一次 chat/completions（max_tokens=1，成本可忽略），
 * 能一次性暴露 baseUrl / Key / 模型名三类填写错误。只验 GET /models 的旧探针对「模型名不存在」
 * 完全无感——历史预设写过失效模型名，用户看到"连接成功"、生成脚本才炸（issue #12）。
 * 未传 model 时退回旧行为（GET /models 验 Key）。
 */
export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey, model } = await req.json();
    if (!baseUrl || !apiKey) {
      return NextResponse.json({ ok: false, error: errText(req, "缺少 baseUrl 或 apiKey", "Missing baseUrl or apiKey") }, { status: 400 });
    }

    const base = String(baseUrl).replace(/\/$/, "");
    let resp: Response;
    if (model) {
      resp = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      resp = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
    }

    if (resp.ok) {
      return NextResponse.json({ ok: true });
    }
    const text = await resp.text().catch(() => "");
    // 常见失败给出可行动的中文提示，原始响应片段附后便于截图排查
    const hint =
      resp.status === 401 || resp.status === 403
        ? errText(req, "Key 无效或无权限", "Invalid or unauthorized key")
        : model && (resp.status === 404 || /model/i.test(text))
        ? errText(req, `模型名可能不存在（${model}）`, `Model may not exist (${model})`)
        : "";
    return NextResponse.json({
      ok: false,
      status: resp.status,
      error: `${hint ? `${hint} · ` : ""}${resp.status} ${resp.statusText}${text ? ` - ${text.slice(0, 200)}` : ""}`,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : errText(req, "连接失败", "Connection failed"),
    });
  }
}
