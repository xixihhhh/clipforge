// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { KITTEN_TTS_URL, hasTTSConfig, isPaidTTSReady, resolveTTSConfig } from "@/lib/tts-presets";
import { generateSpeech } from "@/lib/tts";

vi.mock("@/lib/tts-cache", () => ({
  ttsCacheKey: () => "test-key",
  readTtsCache: async () => null,
  writeTtsCache: async () => {},
}));

afterEach(() => vi.unstubAllGlobals());

it("resolves the local preset without reusing a paid key or a previous endpoint", async () => {
  const stored = { enabled: true, provider: "kitten", apiKey: "old-tts-key", model: "kitten-tts-2-mini", voice: "de", baseUrl: "https://example.invalid/v1" };
  const cfg = resolveTTSConfig(stored, {});
  expect(cfg).toMatchObject({ baseUrl: KITTEN_TTS_URL, apiKey: "", voice: "de" });
  expect(isPaidTTSReady(stored, {})).toBe(true);
  expect(hasTTSConfig({ ...cfg, baseUrl: stored.baseUrl })).toBe(false);
  expect(hasTTSConfig({ ...cfg, voice: "zh" })).toBe(false);
  expect(hasTTSConfig({ ...cfg, provider: "openai" })).toBe(false);
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response("mp3"));
  vi.stubGlobal("fetch", fetch);
  expect(await generateSpeech("Ein Produkt.", cfg)).toEqual(Buffer.from("mp3"));
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`${KITTEN_TTS_URL}/audio/speech`);
  expect(init.redirect).toBe("error");
  expect(new Headers(init.headers).has("Authorization")).toBe(false);
  expect(JSON.parse(String(init.body))).toMatchObject({ input: "Ein Produkt.", voice: "de", response_format: "mp3" });
});
