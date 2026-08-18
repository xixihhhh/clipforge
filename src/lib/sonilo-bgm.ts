/**
 * Sonilo AI 配乐 — 可选的第三种 BGM 来源：把已合成的成片发给 Sonilo（video-to-music），
 * 生成一条跟着这条片子的剪辑点与情绪节奏走的整轨配乐；也可生成贴画面的音效（video-to-sfx）。
 * 与「上传 BGM」「免费 CC 音乐」并列，不替代任何现有来源。
 *
 * Why video-conditioned：曲库检索（free-bgm）按情绪关键词盲选，音乐不知道卖点在哪一秒；
 * video-to-music 读的是成片本身，节奏跟剪辑走。生成的音乐自带授权、可商用（以条款为准），
 * 每条音轨带 license_id；音效为免版税素材。license 信息写进音频旁的 .credit.json sidecar
 * （与 free-bgm 同一套 provenance 机制），素材授权清单（credits）自动收录，投流审核可出示。
 *
 * 计费与安全（与 issue #16 的付费任务原则一致）：
 * - 提交即计费（生成失败自动退款），因此创建任务的 POST 绝不自动重试
 * - task_id 在轮询开始前先落库（ai_tasks），轮询超时/断线不丢已付费任务
 * - 轮询是免费幂等查询：网络抖动 / 5xx 在时限内继续重试，不报废任务
 * - 结果为预签名 URL 下载，绝不把 API Key 发给存储域名
 *
 * Key：export SONILO_API_KEY=sk-xxx（服务端环境变量，同 JAMENDO_CLIENT_ID 的接法；
 * https://sonilo.com 注册获取，注册送免费额度）。未配置时该功能整体隐身，其余流程不受影响。
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, join } from "path";
import { getUploadsDir } from "@/lib/paths";

const DEFAULT_BASE_URL = "https://api.sonilo.com";

/** video-to-music 接口视频上限 6 分钟（超限后端 422 直接拒绝，不创建任务、不扣费） */
export const SONILO_MUSIC_MAX_SECONDS = 360;
/** video-to-sfx 接口视频上限 3 分钟 */
export const SONILO_SFX_MAX_SECONDS = 180;

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;

export type SoniloKind = "music" | "sfx";

/** 双语错误：路由用 errText(req, e.zh, e.en) 直接映射，kind 决定 ai_tasks 终态（timeout → unknown） */
export class SoniloBgmError extends Error {
  zh: string;
  en: string;
  kind: "config" | "http" | "failed" | "timeout";
  constructor(zh: string, en: string, kind: SoniloBgmError["kind"] = "http") {
    super(zh);
    this.name = "SoniloBgmError";
    this.zh = zh;
    this.en = en;
    this.kind = kind;
  }
}

export function getSoniloBaseUrl(): string {
  return (process.env.SONILO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** 是否配置了 Sonilo Key（未配置时前端面板与路由都直接短路） */
export function hasSoniloApiKey(): boolean {
  return Boolean(process.env.SONILO_API_KEY?.trim());
}

function requireApiKey(): string {
  const key = process.env.SONILO_API_KEY?.trim();
  if (!key) {
    throw new SoniloBgmError(
      "未配置 SONILO_API_KEY 环境变量（sonilo.com 注册获取，注册送免费额度）",
      "SONILO_API_KEY is not set (get a key at sonilo.com — free credits on signup)",
      "config"
    );
  }
  return key;
}

// 视频页配乐情绪（upbeat/chill/energetic/emotional，与变体矩阵同一维度）→ Sonilo 风格提示。
// 提示只引导风格，节奏仍按成片剪辑点走；none/未知返回 undefined = 完全按画面生成。
const MOOD_STYLE_HINT: Record<string, string> = {
  upbeat: "轻快明亮的流行节奏，适合带货口播，卖点处情绪上扬",
  chill: "舒缓放松的轻音乐，低干扰，衬托旁白",
  energetic: "动感强节奏电子乐，高能量，跟住快剪切点",
  emotional: "温暖有情感的钢琴与弦乐，柔和铺底",
};

/** 配乐情绪 → Sonilo 风格提示；未知/none/空返回 undefined（promptless，按画面自动）。纯函数，可单测。 */
export function soniloStyleHint(mood?: string | null): string | undefined {
  const key = (mood || "").toLowerCase().trim();
  return MOOD_STYLE_HINT[key];
}

function errorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const detail = parsed.detail || parsed.message || parsed.error;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
  } catch {
    /* not JSON — use raw text */
  }
  return text.slice(0, 300);
}

function httpError(status: number, detail: string): SoniloBgmError {
  if (status === 401)
    return new SoniloBgmError("Sonilo API Key 无效，检查 SONILO_API_KEY 是否填对", "Sonilo API key rejected — check SONILO_API_KEY");
  if (status === 402)
    return new SoniloBgmError(`Sonilo 账户余额不足（sonilo.com 可查用量/充值）: ${detail}`, `Sonilo account out of credits: ${detail}`);
  if (status === 413)
    return new SoniloBgmError(`视频文件过大: ${detail}`, `Video upload too large: ${detail}`);
  if (status === 422)
    return new SoniloBgmError(`参数不合法（常见：视频超时长上限）: ${detail}`, `Invalid request (video over the duration cap?): ${detail}`);
  if (status === 429)
    return new SoniloBgmError(`触发 Sonilo 频率限制，稍等再试: ${detail}`, `Sonilo rate limit hit — retry shortly: ${detail}`);
  return new SoniloBgmError(`Sonilo 接口错误 (${status}): ${detail}`, `Sonilo API error (${status}): ${detail}`);
}

export interface SoniloSubmitInput {
  /** 成片的本地绝对路径（compositions.outputPath） */
  videoPath: string;
  kind: SoniloKind;
  /** 可选风格提示；缺省完全按画面生成 */
  prompt?: string;
}

/**
 * 提交生成任务，返回 task_id。受理即计费（失败自动退款）——
 * 非幂等付费 POST，绝不自动重试（issue #16 原则）。
 */
export async function submitSoniloBgm(input: SoniloSubmitInput): Promise<{ taskId: string }> {
  const key = requireApiKey();
  const form = new FormData();
  const bytes = await readFile(input.videoPath);
  form.append("video", new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), basename(input.videoPath));
  if (input.prompt?.trim()) form.append("prompt", input.prompt.trim());
  // 配乐接口默认流式返回；mode=async 走异步任务（拿 task_id 轮询），断线/重启可找回，
  // 且成功结果带 license_id 字段。音效接口本身就是异步任务，无需该参数。
  if (input.kind === "music") form.append("mode", "async");

  const path = input.kind === "music" ? "/v1/video-to-music" : "/v1/video-to-sfx";
  const res = await fetch(`${getSoniloBaseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw httpError(res.status, errorDetail(await res.text().catch(() => "")));

  let taskId: unknown;
  try {
    taskId = ((await res.json()) as { task_id?: unknown }).task_id;
  } catch {
    taskId = undefined;
  }
  if (!taskId || (typeof taskId !== "string" && typeof taskId !== "number")) {
    throw new SoniloBgmError(
      "任务已受理但未返回 task_id（请联系 sonilo.com 支持并附时间点）",
      "Sonilo accepted the request but returned no task id"
    );
  }
  return { taskId: String(taskId) };
}

interface SoniloTaskArtifact {
  url?: string;
  license_id?: string;
  content_type?: string;
}

export interface SoniloTaskBody {
  status?: string;
  audio?: SoniloTaskArtifact;
  error?: { code?: string; message?: string } | string;
  refunded?: boolean;
}

export interface SoniloPollOpts {
  /** 轮询间隔/总预算，默认 5s / 10min（测试注入用） */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/**
 * 轮询 GET /v1/tasks/{task_id} 直到终态。轮询免费且幂等：网络抖动 / 5xx 在预算内继续重试，
 * 绝不因一次查询失败报废已计费的任务；404 = task 不存在，快速失败。
 * 超时抛 kind="timeout"（后台仍在跑，task_id 已随 ai_tasks 落库可找回）。
 */
export async function awaitSoniloBgm(taskId: string, opts: SoniloPollOpts = {}): Promise<{
  audioUrl: string;
  licenseId?: string;
  task: SoniloTaskBody;
}> {
  const key = requireApiKey();
  const interval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (opts.pollTimeoutMs ?? POLL_TIMEOUT_MS);

  for (;;) {
    let res: Response | null = null;
    try {
      res = await fetch(`${getSoniloBaseUrl()}/v1/tasks/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch (e) {
      console.warn(`[sonilo] 任务查询失败将重试 (task ${taskId}):`, e);
    }

    if (res) {
      if (res.status === 404) {
        throw new SoniloBgmError(
          `Sonilo 任务不存在 (task_id: ${taskId})`,
          `Sonilo task not found (task_id: ${taskId})`
        );
      }
      if (res.status >= 500) {
        console.warn(`[sonilo] 任务查询返回 ${res.status}，将重试 (task ${taskId})`);
      } else if (!res.ok) {
        const base = httpError(res.status, errorDetail(await res.text().catch(() => "")));
        throw new SoniloBgmError(`${base.zh}（task_id: ${taskId}）`, `${base.en} (task_id: ${taskId})`);
      } else {
        let task: SoniloTaskBody | null = null;
        try {
          task = (await res.json()) as SoniloTaskBody;
        } catch {
          task = null;
        }
        if (task && task.status === "succeeded") {
          const audio = task.audio;
          if (!audio?.url) {
            throw new SoniloBgmError(
              `任务成功但没有音频结果 (task_id: ${taskId})`,
              `Sonilo task succeeded without an audio artifact (task_id: ${taskId})`
            );
          }
          return { audioUrl: audio.url, licenseId: audio.license_id, task };
        }
        if (task && task.status === "failed") {
          const err = task.error;
          const message =
            (typeof err === "object" && err ? err.message || err.code : typeof err === "string" ? err : undefined) || "生成失败";
          const refundZh = task.refunded === true ? "，费用已自动退还" : "";
          const refundEn = task.refunded === true ? "; the charge was refunded" : "";
          throw new SoniloBgmError(
            `Sonilo 生成失败: ${message}（task_id: ${taskId}${refundZh}）`,
            `Sonilo generation failed: ${message} (task_id: ${taskId}${refundEn})`,
            "failed"
          );
        }
        // 非终态（pending / processing 等）继续等
      }
    }

    if (Date.now() >= deadline) {
      throw new SoniloBgmError(
        `等待生成超时，任务仍在后台跑（已计费不浪费，task_id: ${taskId} 已落库可查）`,
        `Timed out waiting for Sonilo; the task keeps running on the backend (task_id ${taskId} is recorded)`,
        "timeout"
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

function extFromUrl(url: string): string {
  const pathPart = url.split("?", 1)[0];
  const m = pathPart.match(/(\.(?:m4a|wav|mp3|aac|flac))$/i);
  return m ? m[1].toLowerCase() : ".m4a";
}

export interface SoniloSaveResult {
  /** 本地绝对路径（重新合成时经 toLocalPath 还原后作为 bgmPath 混入） */
  localPath: string;
  /** /api/files/... 形式的访问路径（与上传 BGM 接口同形，前端直接当 bgm.path 用） */
  publicPath: string;
  fileName: string;
}

/**
 * 下载结果音频到 uploads/<project>/bgm/（与 free-bgm 同目录），并写 .credit.json 授权留档
 * sidecar（素材授权清单自动收录：provider/licenseId/task_id，商用留档用）。
 * 预签名 URL 自带鉴权——绝不能把 API Key 发给存储域名，这里不带任何鉴权头。
 */
export async function saveSoniloBgm(
  projectId: string,
  kind: SoniloKind,
  result: { audioUrl: string; licenseId?: string; taskId: string }
): Promise<SoniloSaveResult> {
  const res = await fetch(result.audioUrl);
  if (!res.ok) {
    throw new SoniloBgmError(
      `结果下载失败 (HTTP ${res.status})，音频仍存于 Sonilo 后端 (task_id: ${result.taskId})`,
      `Could not download the generated audio (HTTP ${res.status}); it is still stored on Sonilo (task_id: ${result.taskId})`
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new SoniloBgmError("结果音频为空", "Sonilo returned an empty audio file");
  }

  const bgmDir = join(getUploadsDir(), projectId, "bgm");
  await mkdir(bgmDir, { recursive: true });
  const fileName = `sonilo_${kind}_${Date.now()}${extFromUrl(result.audioUrl)}`;
  const localPath = join(bgmDir, fileName);
  await writeFile(localPath, bytes);

  // 授权留档 sidecar（BgmCredit 形状 + licenseId/taskId 扩展字段）：credits 清单据此把这条 BGM
  // 归为「AI 生成、带 license 留档」条目。措辞口径：配乐=自带授权可商用（以条款为准）；音效=免版税。
  try {
    await writeFile(
      `${localPath}.credit.json`,
      JSON.stringify(
        {
          provider: "sonilo",
          author: "Sonilo",
          license:
            kind === "music"
              ? "Sonilo AI 生成配乐 · 自带授权、可商用（以条款为准）"
              : "Sonilo AI 生成音效 · 免版税（royalty-free）",
          sourceUrl: "https://sonilo.com",
          ...(result.licenseId && { licenseId: result.licenseId }),
          taskId: result.taskId,
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    /* credits sidecar is optional — never block BGM（与 free-bgm 同策略） */
  }

  return { localPath, publicPath: `/api/files/${projectId}/bgm/${fileName}`, fileName };
}
