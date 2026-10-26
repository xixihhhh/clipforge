// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadProviderVideo } from "@/lib/providers/video-download";
import { validateOrDelete } from "@/lib/media-validate";
import { MAX_DOWNLOAD_BYTES } from "@/lib/providers/stock-types";
vi.mock("@/lib/media-validate", () => ({ validateOrDelete: vi.fn() }));
let directory: string;
const fetchMock = vi.fn();
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "clipforge-video-download-"));
  vi.stubEnv("APP_DATA_DIR", directory);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.mocked(validateOrDelete).mockReset().mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
it("downloads with auth, validates, and reuses the local file without exposing the key", async () => {
  fetchMock.mockResolvedValue(new Response("video bytes"));
  const url = await downloadProviderVideo("https://video.test/v1/videos/1/content", { Authorization: "Bearer secret" });
  expect(url).toMatch(/^\/api\/files\/provider-videos\/[a-f0-9]{64}\.mp4$/);
  expect(readFileSync(join(directory, "uploads", url.replace("/api/files/", "")), "utf8")).toBe("video bytes");
  expect(validateOrDelete).toHaveBeenCalledWith(expect.any(String), "video");
  expect(await downloadProviderVideo("https://video.test/v1/videos/1/content", { Authorization: "Bearer secret" })).toBe(url);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer secret" }, redirect: "error" });
});
it("removes invalid partial files so recovery can redownload", async () => {
  fetchMock.mockResolvedValue(new Response("invalid"));
  vi.mocked(validateOrDelete).mockResolvedValue(false);
  await expect(downloadProviderVideo("https://video.test/v1/videos/1/content", {})).rejects.toThrow("无效");
  expect(readdirSync(join(directory, "uploads", "provider-videos"))).toEqual([]);
});
it("rejects oversized content before reading it", async () => {
  fetchMock.mockResolvedValue(new Response("x", { headers: { "Content-Length": String(MAX_DOWNLOAD_BYTES + 1) } }));
  await expect(downloadProviderVideo("https://video.test/v1/videos/1/content", {})).rejects.toThrow("大小限制");
  expect(validateOrDelete).not.toHaveBeenCalled();
});
