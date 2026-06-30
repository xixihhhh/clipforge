import { describe, it, expect } from "vitest";
import { pickNasaVideoUrl, pickNasaImageUrl } from "@/lib/providers/nasa";
import { pickArchiveFile, archiveDownloadUrl } from "@/lib/providers/archive";

describe("pickNasaVideoUrl", () => {
  const urls = [
    "http://images-assets.nasa.gov/video/X/X~orig.mov",
    "http://images-assets.nasa.gov/video/X/X.vtt",
    "http://images-assets.nasa.gov/video/X/X~medium.mp4",
    "http://images-assets.nasa.gov/video/X/X~mobile.mp4",
  ];
  it("挑 ~medium.mp4 并升级到 https，跳过 .mov/.vtt", () => {
    expect(pickNasaVideoUrl(urls)).toBe("https://images-assets.nasa.gov/video/X/X~medium.mp4");
  });
  it("无 medium 时退到 mobile", () => {
    expect(pickNasaVideoUrl(["http://h/X~mobile.mp4"])).toBe("https://h/X~mobile.mp4");
  });
  it("无 mp4 → null", () => {
    expect(pickNasaVideoUrl(["http://h/X~orig.mov"])).toBeNull();
  });
});

describe("pickNasaImageUrl", () => {
  it("优先 ~large 图并升级 https", () => {
    expect(pickNasaImageUrl(["http://h/X~thumb.jpg", "http://h/X~large.jpg"])).toBe("https://h/X~large.jpg");
  });
});

describe("pickArchiveFile", () => {
  const files = [
    { name: "X.mp4", format: "h.264", width: 640, height: 480 },
    { name: "X.gif", format: "Animated GIF" },
    { name: "__ia_thumb.jpg", format: "Thumbnail" },
    { name: "X.jpg", format: "JPEG", width: 800, height: 600 },
  ];
  it("视频挑带宽高的 mp4", () => {
    expect(pickArchiveFile(files, "video")?.name).toBe("X.mp4");
  });
  it("图片跳过缩略、挑真图", () => {
    expect(pickArchiveFile(files, "image")?.name).toBe("X.jpg");
  });
  it("无匹配 → null", () => {
    expect(pickArchiveFile([{ name: "X.txt" }], "video")).toBeNull();
  });
});

describe("archiveDownloadUrl", () => {
  it("文件名按段编码、保留路径分隔", () => {
    expect(archiveDownloadUrl("my item", "a b/c.mp4")).toBe("https://archive.org/download/my%20item/a%20b/c.mp4");
  });
});
