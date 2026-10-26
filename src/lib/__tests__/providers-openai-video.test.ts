// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "@/lib/providers/openai";
import { downloadProviderVideo } from "@/lib/providers/video-download";
vi.mock("@/lib/providers/video-download", () => ({ downloadProviderVideo: vi.fn() }));
const fetchMock = vi.fn();
const options = { modelId: "local-video", mode: "text-to-video" as const, prompt: "product", duration: 5, width: 720, height: 1280 };
const provider = (baseUrl = "https://video.example/v1") => new OpenAIProvider({ name: "openai", apiKey: "secret", baseUrl });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(downloadProviderVideo).mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI-compatible video (#38)", () => {
  it("submits multipart once, omitting Sora-only dimensions for custom models", async () => {
    fetchMock.mockResolvedValue(json({ id: "video-1", status: "queued" }));
    expect(await provider().submitVideoTask(options)).toEqual({ taskId: "video-1", modelId: "local-video" });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://video.example/v1/videos");
    expect(request.headers.Authorization).toBe("Bearer secret");
    expect(request.body.get("seconds")).toBe("5");
    expect(request.body.has("size")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses the explicitly selected legacy submit path and standard polling path", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "video-1" })).mockResolvedValueOnce(json({ status: "in_progress", progress: null }));
    const p = provider("https://video.example/v1/video/generations/");
    await p.submitVideoTask({ ...options, openaiSize: "832x480" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://video.example/v1/video/generations");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: "local-video", prompt: "product", seconds: "5", size: "832x480" });
    expect(await p.getTaskStatus("video-1")).toEqual({ taskId: "video-1", status: "processing" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://video.example/v1/videos/video-1");
  });
  it("uploads image references as files with the explicitly selected Sora duration", async () => {
    fetchMock.mockResolvedValue(json({ id: "video-1" }));
    await provider().submitVideoTask({ ...options, modelId: "sora-2", duration: 8, mode: "image-to-video", firstFrameUrl: "data:image/png;base64,YWJj" });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("input_reference")).toBeInstanceOf(Blob);
    expect(form.get("seconds")).toBe("8");
    expect(form.get("size")).toBe("720x1280");
  });
  it("downloads completed videos with authentication and returns only local paths", async () => {
    fetchMock.mockResolvedValue(json({ status: "completed", model: "local-video", seconds: "5" }));
    vi.mocked(downloadProviderVideo).mockResolvedValue("/api/files/provider-videos/clip.mp4");
    const result = await provider().getTaskStatus("task/1");
    expect(downloadProviderVideo).toHaveBeenCalledWith("https://video.example/v1/videos/task%2F1/content", { Authorization: "Bearer secret" });
    expect(result.result).toMatchObject({ videoUrls: ["/api/files/provider-videos/clip.mp4"], duration: 5 });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("keeps download failures recoverable and preserves provider failures", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "completed" })).mockResolvedValueOnce(json({ status: "failed", error: { code: "rejected", message: "policy" } }));
    vi.mocked(downloadProviderVideo).mockRejectedValue(new Error("download interrupted"));
    await expect(provider().getTaskStatus("video-1")).rejects.toThrow("download interrupted");
    expect(await provider().getTaskStatus("video-1")).toMatchObject({ status: "failed", error: "policy", errorCode: "rejected" });
  });
  it.each(["https://video.example/v1", "https://video.example/v1/video/generations"])("never retries or switches endpoints on a failed paid submit: %s", async (base) => {
    fetchMock.mockResolvedValue(json({ error: "upstream" }, 500));
    await expect(provider(base).submitVideoTask(options)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects unsupported inputs and missing task IDs", async () => {
    await expect(provider().submitVideoTask({ ...options, mode: "image-to-video" })).rejects.toThrow("缺少首帧");
    await expect(provider().submitVideoTask({ ...options, modelId: "sora-2" })).rejects.toThrow("4、8 或 12");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(json({}));
    await expect(provider().submitVideoTask(options)).rejects.toThrow("任务 ID");
  });
  it("exposes video models separately from image models", async () => {
    expect((await provider().listModels("video")).map((m) => m.id)).toEqual(["sora-2", "sora-2-pro"]);
    expect((await provider().listModels("image")).every((m) => m.mediaType === "image")).toBe(true);
  });
});

it("normalizes a legacy submission URL for the read-only connection probe", async () => {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/ai/test-provider/route");
  fetchMock.mockResolvedValue(json({}));
  const response = await POST(new NextRequest("http://localhost/api/ai/test-provider", {
    method: "POST", body: JSON.stringify({ name: "openai", apiKey: "secret", baseUrl: "https://video.example/v1/video/generations" }),
  }));
  expect((await response.json()).status).toBe("ok");
  expect(fetchMock.mock.calls[0][0]).toBe("https://video.example/v1/models");
  expect(fetchMock.mock.calls[0][1].method).toBe("GET");
});
