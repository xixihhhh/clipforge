import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { classifyMaterial, scoreByFilename, scanLocalMaterials } from "@/lib/providers/local-stock";
import { downloadStockFile } from "@/lib/providers/stock-types";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipforge-local-"));
  await writeFile(join(dir, "kitchen_pour_over.mp4"), "v1");
  await writeFile(join(dir, "city_night.mov"), "v2");
  await writeFile(join(dir, "product_shot.jpg"), "img");
  await writeFile(join(dir, "notes.txt"), "ignore"); // 非素材，忽略
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("classifyMaterial", () => {
  it("识别视频/图片，其余 null（大小写不敏感）", () => {
    expect(classifyMaterial("a.mp4")).toBe("video");
    expect(classifyMaterial("a.MOV")).toBe("video");
    expect(classifyMaterial("a.png")).toBe("image");
    expect(classifyMaterial("a.txt")).toBeNull();
    expect(classifyMaterial("noext")).toBeNull();
  });
});

describe("scoreByFilename", () => {
  it("文件名与检索词 token 交集计数", () => {
    expect(scoreByFilename("kitchen_pour_over.mp4", "pour over coffee")).toBe(2); // pour + over
    expect(scoreByFilename("city_night.mov", "pour over")).toBe(0);
  });
});

describe("scanLocalMaterials", () => {
  it("过滤非素材、视频优先、相关度排序", async () => {
    const c = await scanLocalMaterials(dir, "pour over");
    expect(c.length).toBe(3); // txt 被过滤
    expect(c.every((x) => x.source === "local")).toBe(true);
    expect(c[0].id).toBe("kitchen_pour_over.mp4"); // 视频优先 + 命中 pour/over → 排第一
    expect(c[0].mediaType).toBe("video");
    expect(c[c.length - 1].mediaType).toBe("image"); // 图片排在视频后
  });
  it("perPage 截断 + 目录不存在 → []", async () => {
    expect((await scanLocalMaterials(dir, "x", { perPage: 1 })).length).toBe(1);
    expect(await scanLocalMaterials(join(dir, "nope"), "x")).toEqual([]);
  });
  it("audio 请求 → []（本地不支持音频）", async () => {
    expect(await scanLocalMaterials(dir, "x", { mediaType: "audio" })).toEqual([]);
  });
});

describe("downloadStockFile 本地复制分支", () => {
  it("绝对路径素材按复制处理，落到目标目录", async () => {
    const out = await mkdtemp(join(tmpdir(), "clipforge-out-"));
    try {
      const { filePath, bytes } = await downloadStockFile(join(dir, "kitchen_pour_over.mp4"), out, "copied_clip", "video");
      expect(filePath.endsWith("copied_clip.mp4")).toBe(true);
      expect(bytes).toBe(2); // "v1"
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
