import { describe, it, expect } from "vitest";
import {
  toOpenverseImageCandidate,
  toOpenverseAudioCandidate,
  ccRequiresAttribution,
  composeLicense,
  type OpenverseImage,
  type OpenverseAudio,
} from "@/lib/providers/openverse";
import {
  pickPixabayVideoFile,
  toPixabayVideoCandidate,
  toPixabayImageCandidate,
  pixabayAuthorUrl,
  type PixabayVideoHit,
  type PixabayImageHit,
} from "@/lib/providers/pixabay";
import {
  resolveSourceKey,
  isSourceAvailable,
  getAvailableSources,
} from "@/lib/providers/stock-registry";
import { STOCK_SOURCES } from "@/lib/providers/stock-types";

// ==================== Openverse ====================

describe("Openverse 归一化", () => {
  const IMG: OpenverseImage = {
    id: "abc-123",
    title: "Coffee",
    url: "https://live.staticflickr.com/x/coffee.jpg",
    thumbnail: "https://api.openverse.org/v1/images/abc-123/thumb/",
    creator: "Jane Doe",
    creator_url: "https://flickr.com/jane",
    foreign_landing_url: "https://flickr.com/photos/jane/123",
    license: "by",
    license_version: "2.0",
    license_url: "https://creativecommons.org/licenses/by/2.0/",
    attribution: '"Coffee" by Jane Doe is licensed under CC BY 2.0.',
    width: 1920,
    height: 1080,
  };

  it("图片字段映射 + 组合 license + 现成署名文本", () => {
    const c = toOpenverseImageCandidate(IMG);
    expect(c.source).toBe("openverse");
    expect(c.mediaType).toBe("image");
    expect(c.downloadUrl).toContain("coffee.jpg");
    expect(c.pageUrl).toContain("flickr.com/photos");
    expect(c.author).toBe("Jane Doe");
    expect(c.license).toBe("by-2.0");
    expect(c.licenseUrl).toContain("creativecommons.org");
    expect(c.attributionText).toContain("CC BY 2.0");
    expect(c.requiresAttribution).toBe(true);
  });

  it("CC0/PDM 不强制署名，BY 系强制", () => {
    expect(ccRequiresAttribution("cc0")).toBe(false);
    expect(ccRequiresAttribution("pdm")).toBe(false);
    expect(ccRequiresAttribution("by")).toBe(true);
    expect(ccRequiresAttribution("by-sa")).toBe(true);
  });

  it("composeLicense 无版本时只用 license", () => {
    expect(composeLicense("cc0")).toBe("cc0");
    expect(composeLicense("by", "4.0")).toBe("by-4.0");
  });

  it("音频时长毫秒→秒，alt_files 取最高码率", () => {
    const AUD: OpenverseAudio = {
      id: "a1",
      url: "https://x/low.mp3",
      license: "cc0",
      duration: 125000, // 125s
      alt_files: [
        { url: "https://x/lq.mp3", bit_rate: 128000 },
        { url: "https://x/hq.mp3", bit_rate: 320000 },
      ],
    };
    const c = toOpenverseAudioCandidate(AUD);
    expect(c.mediaType).toBe("audio");
    expect(c.durationSec).toBe(125);
    expect(c.downloadUrl).toContain("hq.mp3");
    expect(c.requiresAttribution).toBe(false);
  });
});

// ==================== Pixabay ====================

describe("Pixabay 归一化", () => {
  const VIDEO: PixabayVideoHit = {
    id: 12345,
    pageURL: "https://pixabay.com/videos/id-12345/",
    tags: "coffee, morning, cafe",
    duration: 12,
    user: "maxlkt",
    user_id: 8989,
    videos: {
      large: { url: "", width: 0, height: 0, size: 0 }, // 常见空档
      medium: { url: "https://cdn.pixabay.com/m.mp4", width: 1920, height: 1080, size: 5_000_000, thumbnail: "https://x/m.jpg" },
      small: { url: "https://cdn.pixabay.com/s.mp4", width: 1280, height: 720, size: 2_000_000, thumbnail: "https://x/s.jpg" },
      tiny: { url: "https://cdn.pixabay.com/t.mp4", width: 960, height: 540, size: 800_000, thumbnail: "https://x/t.jpg" },
    },
  };

  it("挑清晰度：跳过空档，minShortSide=720 取达标最小体积(small 720)", () => {
    const f = pickPixabayVideoFile(VIDEO.videos, { minShortSide: 720 });
    expect(f?.height).toBe(720);
  });

  it("门槛 1080 升到 medium", () => {
    const f = pickPixabayVideoFile(VIDEO.videos, { minShortSide: 1080 });
    expect(f?.height).toBe(1080);
  });

  it("门槛过高回退到最高分辨率(medium 1080)", () => {
    const f = pickPixabayVideoFile(VIDEO.videos, { minShortSide: 9999 });
    expect(f?.height).toBe(1080);
  });

  it("视频候选：downloadUrl 追加 ?download=1，作者主页拼接，时长保留", () => {
    const c = toPixabayVideoCandidate(VIDEO, { minShortSide: 720 })!;
    expect(c.source).toBe("pixabay");
    expect(c.downloadUrl).toContain("?download=1");
    expect(c.authorUrl).toBe("https://pixabay.com/users/maxlkt-8989/");
    expect(c.durationSec).toBe(12);
    expect(c.requiresAttribution).toBe(false);
  });

  it("图片候选：largeImageURL 作下载、webformatURL 作预览", () => {
    const IMG: PixabayImageHit = {
      id: 99,
      pageURL: "https://pixabay.com/photos/id-99/",
      tags: "tea",
      previewURL: "https://x/prev.jpg",
      webformatURL: "https://x/web_640.jpg",
      largeImageURL: "https://x/large_1280.jpg",
      imageWidth: 4000,
      imageHeight: 3000,
      user: "alice",
      user_id: 1,
    };
    const c = toPixabayImageCandidate(IMG);
    expect(c.downloadUrl).toContain("large_1280");
    expect(c.previewImage).toContain("web_640");
    expect(c.width).toBe(4000);
  });

  it("pixabayAuthorUrl 拼接", () => {
    expect(pixabayAuthorUrl("bob", 42)).toBe("https://pixabay.com/users/bob-42/");
  });
});

// ==================== 注册表 ====================

describe("多源注册表", () => {
  it("STOCK_SOURCES 含 openverse(keyless)/pexels/pixabay", () => {
    const ids = STOCK_SOURCES.map((s) => s.id);
    expect(ids).toContain("openverse");
    expect(ids).toContain("pexels");
    expect(ids).toContain("pixabay");
    expect(STOCK_SOURCES.find((s) => s.id === "openverse")?.keyless).toBe(true);
  });

  it("resolveSourceKey 优先 apiKeys，其次为空", () => {
    expect(resolveSourceKey("pexels", { pexels: "k1" })).toBe("k1");
    expect(resolveSourceKey("pixabay", {})).toBe("");
  });

  it("openverse 始终可用(keyless)；pexels 无 key 不可用、有 key 可用", () => {
    const ov = STOCK_SOURCES.find((s) => s.id === "openverse")!;
    const px = STOCK_SOURCES.find((s) => s.id === "pexels")!;
    expect(isSourceAvailable(ov)).toBe(true);
    expect(isSourceAvailable(px, {})).toBe(false);
    expect(isSourceAvailable(px, { pexels: "k" })).toBe(true);
  });

  it("getAvailableSources 在无任何 key 时至少含 openverse", () => {
    const avail = getAvailableSources({}).map((s) => s.id);
    expect(avail).toContain("openverse");
  });
});
