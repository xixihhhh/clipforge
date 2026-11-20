// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { OpenAIProvider } from "@/lib/providers/openai";
import type { ImageOptions } from "@/lib/providers/types";

const provider = new OpenAIProvider({ name: "openai", apiKey: "test", baseUrl: "https://example.invalid/v1" });
const options: ImageOptions = { modelId: "gpt-image-2", mode: "image-to-image", prompt: "storyboard grid" };
const product = "data:image/png;base64,Yg==";
const presenter = "data:image/png;base64,YQ==";

afterEach(() => vi.unstubAllGlobals());

it.each([
  { name: "storyboard product photo", refs: { referenceImageUrls: [product] }, expected: ["b"] },
  { name: "presenter followed by product", refs: { referenceImageUrls: [presenter, product], referenceImageUrl: presenter }, expected: ["a", "b"] },
  { name: "legacy reference", refs: { referenceImageUrls: [], referenceImageUrl: product }, expected: ["b"] },
])("sends $name to the edit endpoint", async ({ refs, expected }) => {
  const fetchMock = vi.fn(async (url: string, request: RequestInit) => {
    expect(url).toBe("https://example.invalid/v1/images/edits");
    const images = (request.body as FormData).getAll("image[]") as File[];
    expect(await Promise.all(images.map(image => image.text()))).toEqual(expected);
    return Response.json({ data: [{ url: "https://example.invalid/result.png" }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  await provider.generateImage({ ...options, ...refs });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("rejects multiple DALL·E 2 input images before submission", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(provider.generateImage({ ...options, modelId: "dall-e-2", referenceImageUrls: [presenter, product] }))
    .rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  expect(fetchMock).not.toHaveBeenCalled();
});
