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
  rankStockCandidates,
} from "@/lib/providers/stock-registry";
import { inferExtension, type StockCandidate } from "@/lib/providers/stock-types";
import {
  stripHtml,
  wikimediaRequiresAttribution,
  derivativeHeight,
  pickWikimediaVideoSrc,
  toWikimediaCandidate,
  type CommonsPage,
} from "@/lib/providers/wikimedia";
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
    const c = toOpenverseImageCandidate(IMG)!;
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
    const c = toOpenverseAudioCandidate(AUD)!;
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

// ==================== Wikimedia Commons ====================

describe("Wikimedia 归一化", () => {
  it("stripHtml 去标签并压空白", () => {
    expect(stripHtml('<a href="x">Jane  Doe</a>')).toBe("Jane Doe");
    expect(stripHtml(undefined)).toBe("");
  });

  it("wikimediaRequiresAttribution：PD/CC0 免署名，BY 系需署名", () => {
    expect(wikimediaRequiresAttribution("Public domain")).toBe(false);
    expect(wikimediaRequiresAttribution("CC0")).toBe(false);
    expect(wikimediaRequiresAttribution("CC BY-SA 4.0")).toBe(true);
    expect(wikimediaRequiresAttribution("CC BY 3.0")).toBe(true);
  });

  it("视频文件归一化为 video 候选，带时长/许可/署名链接", () => {
    const page: CommonsPage = {
      pageid: 123,
      title: "File:Ocean waves.webm",
      imageinfo: [
        {
          url: "https://upload.wikimedia.org/x/Ocean_waves.webm",
          thumburl: "https://upload.wikimedia.org/x/thumb.jpg",
          width: 1280,
          height: 720,
          mime: "video/webm",
          duration: 12.6,
          user: "Uploader",
          extmetadata: {
            LicenseShortName: { value: "CC BY-SA 4.0" },
            LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
            Artist: { value: '<a href="x">Jane Doe</a>' },
          },
        },
      ],
    };
    const c = toWikimediaCandidate(page, "video")!;
    expect(c.source).toBe("wikimedia");
    expect(c.mediaType).toBe("video");
    expect(c.downloadUrl).toBe("https://upload.wikimedia.org/x/Ocean_waves.webm");
    expect(c.durationSec).toBe(13); // 12.6 → 四舍五入
    expect(c.author).toBe("Jane Doe");
    expect(c.requiresAttribution).toBe(true);
    expect(c.previewImage).toBe("https://upload.wikimedia.org/x/thumb.jpg");
    expect(c.pageUrl).toContain("commons.wikimedia.org/wiki/");
  });

  it("无 imageinfo/直链 → 返回 null（被过滤）", () => {
    expect(toWikimediaCandidate({ pageid: 1, title: "File:x" }, "image")).toBeNull();
  });

  it("derivativeHeight：优先 height 字段，否则从 transcodekey 解析", () => {
    expect(derivativeHeight({ height: 480 })).toBe(480);
    expect(derivativeHeight({ transcodekey: "480p.vp9.webm" })).toBe(480);
    expect(derivativeHeight({ type: "video/ogg" })).toBe(0);
  });

  it("pickWikimediaVideoSrc：选 ≤720p 最高的 webm 转码（240p+480p → 480p）", () => {
    const src = pickWikimediaVideoSrc(
      [
        { transcodekey: "video/ogg", type: "video/ogg", src: "orig.ogv", height: 1080 }, // 原始非 webm
        { transcodekey: "240p.vp9.webm", src: "v240.webm" },
        { transcodekey: "480p.vp9.webm", src: "v480.webm" },
      ],
      "orig.ogv",
    );
    expect(src).toBe("v480.webm");
  });

  it("pickWikimediaVideoSrc：全部 >720 → 取最小的 webm", () => {
    const src = pickWikimediaVideoSrc(
      [
        { transcodekey: "1080p.vp9.webm", src: "v1080.webm" },
        { transcodekey: "2160p.vp9.webm", src: "v2160.webm" },
      ],
      "orig.ogv",
    );
    expect(src).toBe("v1080.webm");
  });

  it("pickWikimediaVideoSrc：无 webm 转码 → 回退原始直链", () => {
    expect(pickWikimediaVideoSrc([{ transcodekey: "144p.mjpeg.mov", src: "x.mov" }], "orig.ogv")).toBe("orig.ogv");
    expect(pickWikimediaVideoSrc(undefined, "orig.ogv")).toBe("orig.ogv");
  });

  it("toWikimediaCandidate：视频带 derivatives → downloadUrl 取 480p webm 转码", () => {
    const page: CommonsPage = {
      pageid: 9,
      title: "File:Clip.ogv",
      videoinfo: [
        {
          url: "https://upload.wikimedia.org/x/Clip.ogv",
          mime: "application/ogg",
          duration: 10,
          extmetadata: { LicenseShortName: { value: "CC0" } },
          derivatives: [
            { transcodekey: "240p.vp9.webm", src: "https://up/Clip.240p.webm" },
            { transcodekey: "480p.vp9.webm", src: "https://up/Clip.480p.webm" },
          ],
        },
      ],
    };
    const c = toWikimediaCandidate(page, "video")!;
    expect(c.mediaType).toBe("video");
    expect(c.downloadUrl).toBe("https://up/Clip.480p.webm"); // 取转码版而非 .ogv 原始
    expect(c.requiresAttribution).toBe(false); // CC0
  });
});

describe("多源注册表", () => {
  it("STOCK_SOURCES 含 openverse(keyless)/wikimedia(keyless,视频)/pexels/pixabay", () => {
    const ids = STOCK_SOURCES.map((s) => s.id);
    expect(ids).toContain("openverse");
    expect(ids).toContain("pexels");
    expect(ids).toContain("pixabay");
    expect(ids).toContain("wikimedia");
    expect(STOCK_SOURCES.find((s) => s.id === "openverse")?.keyless).toBe(true);
    const wm = STOCK_SOURCES.find((s) => s.id === "wikimedia")!;
    expect(wm.keyless).toBe(true); // 免 Key
    expect(wm.mediaTypes).toContain("video"); // 唯一免 Key 视频源
  });

  it("wikimedia 无 key 也可用(keyless)", () => {
    const wm = STOCK_SOURCES.find((s) => s.id === "wikimedia")!;
    expect(isSourceAvailable(wm, {})).toBe(true);
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

// ==================== 审查修复回归 ====================

const cand = (over: Partial<StockCandidate>): StockCandidate => ({
  source: "openverse",
  mediaType: "image",
  id: "1",
  downloadUrl: "u",
  pageUrl: "p",
  author: "a",
  authorUrl: "au",
  license: "cc0",
  ...over,
});

describe("rankStockCandidates（聚合排序）", () => {
  it("请求视频时：真视频排在高分辨率 Openverse 图片之前（修『要视频却拿到静态图』）", () => {
    const ranked = rankStockCandidates(
      [
        cand({ source: "openverse", mediaType: "image", id: "img", width: 4000, height: 6000 }),
        cand({ source: "pexels", mediaType: "video", id: "vid", width: 720, height: 1280 }),
      ],
      "video",
      "portrait",
    );
    expect(ranked[0].id).toBe("vid");
  });

  it("请求图片时：竖向素材优先于横向（朝向匹配，减少竖屏裁切/黑边）", () => {
    const ranked = rankStockCandidates(
      [
        cand({ id: "land", width: 1920, height: 1080 }),
        cand({ id: "port", width: 1080, height: 1920 }),
      ],
      "image",
      "portrait",
    );
    expect(ranked[0].id).toBe("port");
  });
});

describe("Wikimedia 跳过无 webm 转码的视频", () => {
  it("视频回退到 .ogv（无 webm 转码）→ 返回 null（不可播素材不入选）", () => {
    const page: CommonsPage = {
      pageid: 5,
      title: "File:Old.ogv",
      videoinfo: [
        {
          url: "https://up/Old.ogv",
          mime: "application/ogg",
          derivatives: [{ transcodekey: "144p.mjpeg.mov", src: "https://up/Old.144p.mov" }],
        },
      ],
    };
    expect(toWikimediaCandidate(page, "video")).toBeNull();
  });
});

describe("inferExtension 无扩展名按媒体类型给默认", () => {
  it("content-type 优先，其次 URL 扩展名", () => {
    expect(inferExtension("https://x/file", "image/png")).toBe("png");
    expect(inferExtension("https://x/a.webm?v=1")).toBe("webm");
  });
  it("都识别不出 → 图片 jpg / 音频 mp3 / 视频 mp4（不再一律 mp4）", () => {
    expect(inferExtension("https://x/noext", null, "image")).toBe("jpg");
    expect(inferExtension("https://x/noext", null, "audio")).toBe("mp3");
    expect(inferExtension("https://x/noext", null, "video")).toBe("mp4");
  });
});

describe("Openverse 无直链返回 null", () => {
  it("图片/音频缺 url → null（被搜索结果过滤，不会 undefined 下载崩分镜）", () => {
    expect(toOpenverseImageCandidate({ id: "x", url: "", license: "cc0" } as OpenverseImage)).toBeNull();
    expect(toOpenverseAudioCandidate({ id: "x", url: "", license: "cc0" } as OpenverseAudio)).toBeNull();
  });
});
