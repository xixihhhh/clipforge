import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  soniloStyleHint,
  submitSoniloBgm,
  awaitSoniloBgm,
  saveSoniloBgm,
  hasSoniloApiKey,
  SoniloBgmError,
  SONILO_MUSIC_MAX_SECONDS,
  SONILO_SFX_MAX_SECONDS,
} from "@/lib/sonilo-bgm";

/**
 * Sonilo AI 配乐 —— 网络全 stub（不联网、不扣费）。
 * 付费任务安全语义与 issue #16 对齐：创建任务的 POST 绝不自动重试、
 * 轮询查询失败不报废任务、超时报错带 task_id、预签名下载绝不带 API Key。
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type FetchCall = { url: string; init?: RequestInit };

/** fetch stub：按序返回响应，记录每次调用（额外调用抛错，保证「不重试」可证） */
function stubFetchSequence(responses: Array<Partial<Response> | (() => Partial<Response>)>) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error(`意外的第 ${calls.length} 次请求: ${url}`);
      return (typeof next === "function" ? next() : next) as Response;
    })
  );
  return calls;
}

const okJson = (body: unknown, status = 200): Partial<Response> => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("soniloStyleHint（配乐情绪→风格提示）", () => {
  it("四种情绪映射到互不相同的风格提示", () => {
    const hints = ["upbeat", "chill", "energetic", "emotional"].map((m) => soniloStyleHint(m));
    for (const h of hints) expect(typeof h).toBe("string");
    expect(new Set(hints).size).toBe(4);
  });
  it("大小写不敏感、去空白", () => {
    expect(soniloStyleHint("UPBEAT")).toBe(soniloStyleHint("upbeat"));
    expect(soniloStyleHint("  chill  ")).toBe(soniloStyleHint("chill"));
  });
  it("none / 未知 / 空 / null / undefined 返回 undefined（promptless，完全按画面生成）", () => {
    expect(soniloStyleHint("none")).toBeUndefined();
    expect(soniloStyleHint("不存在")).toBeUndefined();
    expect(soniloStyleHint("")).toBeUndefined();
    expect(soniloStyleHint(null)).toBeUndefined();
    expect(soniloStyleHint(undefined)).toBeUndefined();
  });
});

describe("时长上限常量（与后端一致：配乐 6 分钟 / 音效 3 分钟）", () => {
  it("music 360s / sfx 180s", () => {
    expect(SONILO_MUSIC_MAX_SECONDS).toBe(360);
    expect(SONILO_SFX_MAX_SECONDS).toBe(180);
  });
});

describe("submitSoniloBgm（提交生成任务）", () => {
  let videoPath: string;
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "sonilo-test-"));
    videoPath = join(dir, "成片.mp4");
    await writeFile(videoPath, "fake-video-bytes");
    vi.stubEnv("SONILO_API_KEY", "sk-test");
  });

  it("配乐：POST /v1/video-to-music，带 Bearer 头 + mode=async + 视频文件 + 风格提示，返回 task_id", async () => {
    const calls = stubFetchSequence([okJson({ task_id: "task-abc" }, 202)]);
    const { taskId } = await submitSoniloBgm({ videoPath, kind: "music", prompt: "轻快明亮" });
    expect(taskId).toBe("task-abc");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.sonilo.com/v1/video-to-music");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const form = calls[0].init?.body as FormData;
    expect(form.get("mode")).toBe("async");
    expect(form.get("prompt")).toBe("轻快明亮");
    expect(form.get("video")).toBeInstanceOf(Blob);
  });

  it("音效：POST /v1/video-to-sfx，不带 mode 字段（该接口本身就是异步任务）", async () => {
    const calls = stubFetchSequence([okJson({ task_id: "task-sfx" }, 202)]);
    const { taskId } = await submitSoniloBgm({ videoPath, kind: "sfx" });
    expect(taskId).toBe("task-sfx");
    expect(calls[0].url).toBe("https://api.sonilo.com/v1/video-to-sfx");
    const form = calls[0].init?.body as FormData;
    expect(form.get("mode")).toBeNull();
    expect(form.get("prompt")).toBeNull();
  });

  it("未配置 SONILO_API_KEY：直接报配置错误，不发任何请求", async () => {
    vi.stubEnv("SONILO_API_KEY", "");
    const calls = stubFetchSequence([]);
    await expect(submitSoniloBgm({ videoPath, kind: "music" })).rejects.toMatchObject({ kind: "config" });
    expect(calls.length).toBe(0);
  });

  it("402 余额不足：错误信息可读，且付费 POST 绝不自动重试（fetch 仅 1 次）", async () => {
    const calls = stubFetchSequence([okJson({ detail: "no credits" }, 402)]);
    await expect(submitSoniloBgm({ videoPath, kind: "music" })).rejects.toThrow(/余额不足/);
    expect(calls.length).toBe(1);
  });

  it("受理但未返回 task_id：明确报错（任务可能已计费，不能静默吞掉）", async () => {
    stubFetchSequence([okJson({}, 202)]);
    await expect(submitSoniloBgm({ videoPath, kind: "music" })).rejects.toThrow(/task_id/);
  });

  it("hasSoniloApiKey 跟随环境变量", () => {
    expect(hasSoniloApiKey()).toBe(true);
    vi.stubEnv("SONILO_API_KEY", "  ");
    expect(hasSoniloApiKey()).toBe(false);
  });
});

describe("awaitSoniloBgm（轮询任务，免费幂等查询）", () => {
  beforeEach(() => {
    vi.stubEnv("SONILO_API_KEY", "sk-test");
  });
  const fast = { pollIntervalMs: 1, pollTimeoutMs: 5_000 };

  it("processing → succeeded：返回音频 URL + license_id", async () => {
    stubFetchSequence([
      okJson({ status: "processing" }),
      okJson({ status: "succeeded", audio: { url: "https://cdn.example/a.m4a", license_id: "lic-1" } }),
    ]);
    const r = await awaitSoniloBgm("task-abc", fast);
    expect(r.audioUrl).toBe("https://cdn.example/a.m4a");
    expect(r.licenseId).toBe("lic-1");
  });

  it("一次 5xx 查询失败不报废已计费任务：继续重试直到 succeeded（issue #16 原则）", async () => {
    stubFetchSequence([
      okJson({ detail: "boom" }, 500),
      okJson({ status: "succeeded", audio: { url: "https://cdn.example/a.m4a" } }),
    ]);
    const r = await awaitSoniloBgm("task-abc", fast);
    expect(r.audioUrl).toBe("https://cdn.example/a.m4a");
  });

  it("failed：报错带 task_id + 退款说明，kind=failed", async () => {
    stubFetchSequence([okJson({ status: "failed", error: { message: "boom" }, refunded: true })]);
    const err = await awaitSoniloBgm("task-abc", fast).catch((e) => e as SoniloBgmError);
    expect(err).toBeInstanceOf(SoniloBgmError);
    expect((err as SoniloBgmError).kind).toBe("failed");
    expect((err as SoniloBgmError).zh).toContain("task-abc");
    expect((err as SoniloBgmError).zh).toContain("退还");
  });

  it("404：task 不存在，快速失败不空转（fetch 仅 1 次）", async () => {
    const calls = stubFetchSequence([okJson({ detail: "not found" }, 404)]);
    await expect(awaitSoniloBgm("task-gone", fast)).rejects.toThrow(/task-gone/);
    expect(calls.length).toBe(1);
  });

  it("超时：kind=timeout 且报错带 task_id（后台仍在跑，落库后可找回）", async () => {
    stubFetchSequence([okJson({ status: "processing" })]);
    const err = await awaitSoniloBgm("task-slow", { pollIntervalMs: 1, pollTimeoutMs: 0 }).catch((e) => e as SoniloBgmError);
    expect((err as SoniloBgmError).kind).toBe("timeout");
    expect((err as SoniloBgmError).zh).toContain("task-slow");
  });
});

describe("saveSoniloBgm（落盘 + 授权留档 sidecar）", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "sonilo-data-"));
    vi.stubEnv("APP_DATA_DIR", dataDir);
    vi.stubEnv("SONILO_API_KEY", "sk-test");
  });

  const audioResponse = (): Partial<Response> => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode("audio-bytes").buffer as ArrayBuffer,
  });

  it("预签名 URL 下载绝不带 API Key；音频落到 uploads/<project>/bgm/，路径与上传 BGM 接口同形", async () => {
    const calls = stubFetchSequence([audioResponse()]);
    const saved = await saveSoniloBgm("proj-1", "music", {
      audioUrl: "https://cdn.example/track.m4a?sig=xyz",
      licenseId: "lic-a",
      taskId: "task-abc",
    });
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(saved.localPath).toContain(join(dataDir, "uploads", "proj-1", "bgm"));
    expect(saved.localPath.endsWith(".m4a")).toBe(true);
    expect(saved.publicPath).toBe(`/api/files/proj-1/bgm/${saved.fileName}`);
    expect(await readFile(saved.localPath, "utf-8")).toBe("audio-bytes");
  });

  it("配乐 sidecar：provider/licenseId/taskId 留档，措辞=自带授权可商用（以条款为准）", async () => {
    stubFetchSequence([audioResponse()]);
    const saved = await saveSoniloBgm("proj-1", "music", {
      audioUrl: "https://cdn.example/track.m4a",
      licenseId: "lic-a",
      taskId: "task-abc",
    });
    const sidecar = JSON.parse(await readFile(`${saved.localPath}.credit.json`, "utf-8"));
    expect(sidecar.provider).toBe("sonilo");
    expect(sidecar.licenseId).toBe("lic-a");
    expect(sidecar.taskId).toBe("task-abc");
    expect(sidecar.license).toContain("可商用");
    expect(sidecar.license).toContain("以条款为准");
  });

  it("音效 sidecar：措辞=免版税（不写「可商用授权」口径）", async () => {
    stubFetchSequence([audioResponse()]);
    const saved = await saveSoniloBgm("proj-1", "sfx", {
      audioUrl: "https://cdn.example/sfx.wav",
      taskId: "task-sfx",
    });
    expect(saved.localPath.endsWith(".wav")).toBe(true);
    const sidecar = JSON.parse(await readFile(`${saved.localPath}.credit.json`, "utf-8"));
    expect(sidecar.license).toContain("免版税");
    expect(sidecar.licenseId).toBeUndefined();
  });

  it("下载失败：报错带 task_id（结果仍存于后端，可找回），不落半截文件", async () => {
    stubFetchSequence([okJson({ detail: "gone" }, 403)]);
    await expect(
      saveSoniloBgm("proj-1", "music", { audioUrl: "https://cdn.example/track.m4a", taskId: "task-abc" })
    ).rejects.toThrow(/task-abc/);
    expect(existsSync(join(dataDir, "uploads", "proj-1", "bgm"))).toBe(false);
  });
});
