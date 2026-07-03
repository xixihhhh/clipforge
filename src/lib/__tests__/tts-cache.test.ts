import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { ttsCacheKey, readTtsCache, writeTtsCache } from "@/lib/tts-cache";

// paths.ts resolves getDataDir() from APP_DATA_DIR at call time, so pointing it at a
// temp dir redirects all cache I/O away from the real data/ directory for this file.
const origData = process.env.APP_DATA_DIR;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipforge-ttscache-"));
  process.env.APP_DATA_DIR = dir;
});

afterAll(async () => {
  if (origData === undefined) delete process.env.APP_DATA_DIR;
  else process.env.APP_DATA_DIR = origData;
  await rm(dir, { recursive: true, force: true });
});

describe("ttsCacheKey 内容寻址键", () => {
  it("同输入同 key，且为 40 位 sha1 hex", () => {
    const parts = { provider: "edge", voice: "zh-CN-XiaoxiaoNeural", rate: "+0%", text: "你好世界" };
    const k1 = ttsCacheKey(parts);
    const k2 = ttsCacheKey({ ...parts });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{40}$/);
  });

  it("键的插入顺序不影响 key（canonical JSON 排序）", () => {
    expect(ttsCacheKey({ a: 1, b: "x", text: "t" })).toBe(ttsCacheKey({ text: "t", b: "x", a: 1 }));
  });

  it("任一字段变化 → key 变化", () => {
    const base = { provider: "atlas", model: "xai/tts-v1", voice: "eve", speed: 1, text: "hi" };
    const k = ttsCacheKey(base);
    expect(ttsCacheKey({ ...base, provider: "minimax" })).not.toBe(k);
    expect(ttsCacheKey({ ...base, model: "xai/tts-v2" })).not.toBe(k);
    expect(ttsCacheKey({ ...base, voice: "adam" })).not.toBe(k);
    expect(ttsCacheKey({ ...base, speed: 1.2 })).not.toBe(k);
    expect(ttsCacheKey({ ...base, text: "hi!" })).not.toBe(k);
    // Adding a new meaningful field also changes the key
    expect(ttsCacheKey({ ...base, baseUrl: "https://api.example.com" })).not.toBe(k);
  });

  it("undefined / null / '' 与字段缺失等价（provider 对三者都走默认值，产出相同音频）", () => {
    const k = ttsCacheKey({ voice: "eve", text: "hi" });
    expect(ttsCacheKey({ voice: "eve", text: "hi", speed: undefined })).toBe(k);
    expect(ttsCacheKey({ voice: "eve", text: "hi", speed: null })).toBe(k);
    expect(ttsCacheKey({ voice: "eve", text: "hi", speed: "" })).toBe(k);
  });

  it("值类型敏感：数字 1 与字符串 '1' 不同 key", () => {
    expect(ttsCacheKey({ speed: 1, text: "t" })).not.toBe(ttsCacheKey({ speed: "1", text: "t" }));
  });
});

describe("readTtsCache / writeTtsCache 读写", () => {
  it("写后读回同字节，文件落在 <data>/cache/tts/<key>.mp3", async () => {
    const key = ttsCacheKey({ provider: "edge", voice: "v", text: "round-trip" });
    const data = randomBytes(2048);
    await writeTtsCache(key, data);
    const back = await readTtsCache(key);
    expect(back).not.toBeNull();
    expect(Buffer.compare(back!, data)).toBe(0);
    const onDisk = await readFile(join(dir, "cache", "tts", `${key}.mp3`));
    expect(Buffer.compare(onDisk, data)).toBe(0);
  });

  it("未写过的 key → null（未命中不抛错）", async () => {
    expect(await readTtsCache(ttsCacheKey({ text: "never-written" }))).toBeNull();
  });

  it("小于 100 字节的音频不缓存（写入被跳过，读回 null）", async () => {
    const key = ttsCacheKey({ text: "tiny" });
    await writeTtsCache(key, Buffer.from("short"));
    expect(await readTtsCache(key)).toBeNull();
  });

  it("非法 key（路径穿越/非 hex 字符）静默拒绝，不抛错", async () => {
    await expect(writeTtsCache("../evil", randomBytes(2048))).resolves.toBeUndefined();
    expect(await readTtsCache("../evil")).toBeNull();
    expect(await readTtsCache("a/b")).toBeNull();
  });

  it("同 key 重复写为覆盖（内容寻址下内容相同，幂等）", async () => {
    const key = ttsCacheKey({ text: "overwrite" });
    const d1 = randomBytes(1024);
    const d2 = randomBytes(1024);
    await writeTtsCache(key, d1);
    await writeTtsCache(key, d2);
    const back = await readTtsCache(key);
    expect(Buffer.compare(back!, d2)).toBe(0);
  });
});
