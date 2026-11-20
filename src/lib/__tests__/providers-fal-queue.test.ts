// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { toEditVariant } from "@/lib/gen-params";
import { FalAIProvider } from "@/lib/providers/fal-ai";

const requestId = "request-123";
const baseUrl = "https://queue.fal.run";
const imageUrl = "https://assets.example.invalid/result.png";
const videoUrl = "https://assets.example.invalid/result.mp4";

// This fixture accepts application-scoped GETs and full endpoint POSTs, as the
// queue API does. Incorrect operation-scoped GETs reproduce issue #43's 405.
function mockQueue(
  appId: string,
  result: Record<string, unknown>,
  options: {
    endpointId?: string;
    states?: string[];
    baseUrl?: string;
  } = {},
) {
  const origin = options.baseUrl ?? baseUrl;
  const states = [...(options.states ?? ["COMPLETED"])];
  let lastState = "COMPLETED";
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown;
    if (method === "POST" && url === `${origin}/${options.endpointId}`) {
      body = { request_id: requestId };
    } else if (method === "GET" && url === `${origin}/${appId}/requests/${requestId}/status`) {
      lastState = states.shift() ?? lastState;
      body = { request_id: requestId, status: lastState, progress: 25 };
    } else if (method === "GET" && url === `${origin}/${appId}/requests/${requestId}`) {
      body = result;
    } else {
      return new Response("Wrong queue route", { status: 405, statusText: "Method Not Allowed" });
    }
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

class ImmediatePollingProvider extends FalAIProvider {
  protected override sleep(): Promise<void> {
    return Promise.resolve();
  }
}

function provider(origin = baseUrl) {
  return new ImmediatePollingProvider({ name: "fal-ai", apiKey: "test-key", baseUrl: origin });
}

afterEach(() => vi.unstubAllGlobals());

describe("FalAIProvider queue application routes", () => {
  it.each([
    ["bytedance/seedance-2.5/text-to-video", "bytedance/seedance-2.5", "video"],
    ["bytedance/seedance-2.5/image-to-video", "bytedance/seedance-2.5", "video"],
    ["openai/gpt-image-2/image-to-image", "openai/gpt-image-2", "image"],
    ["fal-ai/kling-video/v3/pro/text-to-video", "fal-ai/kling-video", "video"],
    ["fal-ai/flux/schnell", "fal-ai/flux", "image"],
    ["workflows/example/storyboard/render", "workflows/example/storyboard", "image"],
    ["comfy/example/workflow/api/render", "comfy/example/workflow", "image"],
    ["workflows/example/storyboard", "workflows/example/storyboard", "image"],
    ["comfy/example/workflow", "comfy/example/workflow", "image"],
    ["openai/gpt-image-2", "openai/gpt-image-2", "image"],
    ["fal-ai/flux-2-pro", "fal-ai/flux-2-pro", "image"],
  ] as const)("retrieves %s without changing its saved model ID", async (modelId, appId, media) => {
    const result = media === "video" ? { video: { url: videoUrl } } : { images: [{ url: imageUrl }] };
    const fetchMock = mockQueue(appId, result);
    const taskId = `${modelId}::${requestId}`;

    const status = await provider().getTaskStatus(taskId);

    expect(status).toMatchObject({
      taskId,
      status: "completed",
      result: {
        taskId,
        modelId,
        ...(media === "video" ? { videoUrls: [videoUrl] } : { imageUrls: [imageUrl] }),
      },
    });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`${baseUrl}/${appId}/requests/${requestId}/status`, "GET"],
      [`${baseUrl}/${appId}/requests/${requestId}`, "GET"],
    ]);
  });

  it.each([
    ["IN_QUEUE", "pending"],
    ["IN_PROGRESS", "processing"],
    ["FAILED", "failed"],
  ] as const)("queries %s without requesting a result", async (remoteStatus, status) => {
    const fetchMock = mockQueue("bytedance/seedance-2.5", {}, { states: [remoteStatus] });
    const taskId = `bytedance/seedance-2.5/text-to-video::${requestId}`;

    await expect(provider().getTaskStatus(taskId)).resolves.toEqual({ taskId, status, progress: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["fal-ai/flux/dev", "fal-ai/flux"],
    ["custom-model", "custom-model"],
  ])("keeps the configured gateway prefix and authentication for %s", async (modelId, appId) => {
    const origin = "https://gateway.example.invalid/fal";
    const fetchMock = mockQueue(appId, { images: [{ url: imageUrl }] }, { baseUrl: origin });

    await provider(origin).getTaskStatus(`${modelId}::${requestId}`);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/${appId}/requests/${requestId}/status`,
      `${origin}/${appId}/requests/${requestId}`,
    ]);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Key test-key" });
  });

  it.each(["openai/gpt-image-2/edit", "openai/gpt-image-2/image-to-image"])("submits %s to fal's edit endpoint exactly once", async (selectedId) => {
    const modelId = "openai/gpt-image-2/edit";
    const fetchMock = mockQueue("openai/gpt-image-2", { images: [{ url: imageUrl }] }, { endpointId: modelId });
    const referenceImageUrl = "https://assets.example.invalid/source.png";

    const result = await provider().generateImage({
      modelId: selectedId, mode: "image-to-image", prompt: "replace background", referenceImageUrl,
    });

    expect(result).toMatchObject({ modelId, taskId: `${modelId}::${requestId}`, imageUrls: [imageUrl] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(`${baseUrl}/${modelId}`);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({
      prompt: "replace background", image_urls: [referenceImageUrl],
    });
  });

  it("submits a video to its full operation endpoint exactly once", async () => {
    const modelId = "bytedance/seedance-2.5/text-to-video";
    const fetchMock = mockQueue("bytedance/seedance-2.5", { video: { url: videoUrl } }, { endpointId: modelId });

    const result = await provider().generateVideo({
      modelId, mode: "text-to-video", prompt: "a rotating product", duration: 5,
    });

    expect(result).toMatchObject({ modelId, taskId: `${modelId}::${requestId}`, videoUrls: [videoUrl] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(`${baseUrl}/${modelId}`);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ prompt: "a rotating product", duration: 5 });
  });

  it("resumes a saved task through pending and processing without another submission", async () => {
    const fetchMock = mockQueue("bytedance/seedance-2.5", { video: { url: videoUrl } }, {
      states: ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"],
    });
    const taskId = `bytedance/seedance-2.5/text-to-video::${requestId}`;

    const status = await provider().waitForTask(taskId, { interval: 0, maxAttempts: 3 });

    expect(status).toMatchObject({ taskId, status: "completed", result: { videoUrls: [videoUrl] } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("rejects a malformed saved task ID before making a request", async () => {
    const fetchMock = mockQueue("fal-ai/flux", {});

    await expect(provider().getTaskStatus("missing-separator")).rejects.toMatchObject({ code: "INVALID_TASK_ID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fal queue terminal errors (#44)", () => {
  const taskId = "openai/gpt-image-2::job";

  it("returns the model's rejection without repolling or echoing the input", async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/status")
      ? Response.json({ status: "COMPLETED" })
      : Response.json({ detail: [{ type: "content_policy_violation", msg: "Policy check failed", input: "private prompt" }] }, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().waitForTask(taskId)).rejects.toMatchObject({ code: "TASK_FAILED", taskId,
      message: expect.stringMatching(/^任务失败: .*content_policy_violation.*Policy check failed$/) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a failure declared by a COMPLETED status without fetching a result", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "COMPLETED", error: "Generation rejected" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().getTaskStatus(taskId)).resolves.toMatchObject({ status: "failed", error: "Generation rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves recovery when the result lookup fails without a model rejection", async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/status")
      ? Response.json({ status: "COMPLETED" })
      : Response.json({ detail: "Invalid gateway route" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().waitForTask(taskId)).rejects.toMatchObject({ code: "STATUS_UNKNOWN", taskId });
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});

it("selects the published fal edit endpoint for product redraws", () => {
  expect(toEditVariant("openai/gpt-image-2")).toBe("openai/gpt-image-2/edit");
});

describe("fal GPT Image 2.6 Flare", () => {
  const application = "openai/gpt-image-2.6";
  const catalogId = application + "/flare/text-to-image";
  const editId = application + "/flare/edit";

  it.each([
    { references: [] as string[], endpoint: catalogId },
    { references: ["https://example.invalid/product.png", "https://example.invalid/presenter.png"], endpoint: editId },
  ])("uses the selected model for $endpoint", async ({ references, endpoint }) => {
    const catalog = await provider().listModels("image");
    expect(catalog[0].id).toBe("openai/gpt-image-2");
    const selected = catalog.find(model => model.id === catalogId);
    expect(selected?.modes).toEqual(["text-to-image", "image-to-image"]);

    const fetchMock = mockQueue(application, { images: [{ url: imageUrl }] }, { endpointId: endpoint });
    const result = await provider().generateImage({
      modelId: selected!.id, mode: references.length ? "image-to-image" : "text-to-image",
      prompt: "Create a product photo", referenceImageUrls: references,
      width: 1080, height: 1920, seed: 42, guidanceScale: 4, steps: 10, negativePrompt: "noise",
    });
    expect(result).toMatchObject({ modelId: endpoint, imageUrls: [imageUrl] });
    const posts = fetchMock.mock.calls.filter(([, request]) => request?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      prompt: "Create a product photo", image_size: { width: 1088, height: 1920 }, num_images: 1,
      ...(references.length > 0 && { image_urls: references }),
    });
  });

  it("rejects an unsupported output count before submitting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generateImage({
      modelId: catalogId, mode: "text-to-image", prompt: "product", count: 11,
    })).rejects.toMatchObject({ code: "BAD_PARAMETER" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, 17])("rejects %i references for an edit before making a paid request", async count => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generateImage({
      modelId: catalogId, mode: "image-to-image", prompt: "product", referenceImageUrls: Array(count).fill(imageUrl),
    })).rejects.toMatchObject({ code: "BAD_REFERENCE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
