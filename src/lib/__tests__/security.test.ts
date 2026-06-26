import { describe, it, expect } from "vitest";
import { resolveUploadFilePath } from "@/lib/remote-image";
import { escapeSsml } from "@/lib/edge-tts";

// ==================== 路径穿越防护（/api/ai/image|video 的 toRemoteUsableImage）====================

describe("resolveUploadFilePath 路径穿越防护", () => {
  it("正常 /api/files 路径解析到 uploads 目录内", () => {
    const p = resolveUploadFilePath("/api/files/abc.png");
    expect(p).toBeTruthy();
    expect(p!.includes("uploads")).toBe(true);
    expect(p!.endsWith(`abc.png`)).toBe(true);
  });

  it("含 ../ 的路径穿越被拒绝（返回 null，不读盘外泄）", () => {
    expect(resolveUploadFilePath("/api/files/../../../../etc/passwd")).toBeNull();
    expect(resolveUploadFilePath("/api/files/../config")).toBeNull();
    expect(resolveUploadFilePath("/api/files/sub/../../../secret")).toBeNull();
  });

  it("非 /api/files 路径返回 null（交由调用方原样透传）", () => {
    expect(resolveUploadFilePath("https://example.com/x.png")).toBeNull();
    expect(resolveUploadFilePath("random-string")).toBeNull();
  });
});

// ==================== SSML 属性注入防护（edge-tts voice/pitch/rate 兜底转义）====================

describe("escapeSsml 防 SSML 属性注入", () => {
  it("转义单引号/尖括号——voice/rate 落在单引号属性里靠它兜底，未转义的 ' 可越界注入", () => {
    const out = escapeSsml("x' /><voice name='evil");
    expect(out).not.toContain("'"); // 单引号必须被转义，否则可终止属性、注入新元素
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toContain("&apos;");
    expect(out).toContain("&lt;");
  });

  it("合法音色名无副作用（转义是无害的兜底）", () => {
    expect(escapeSsml("en-US-AriaNeural")).toBe("en-US-AriaNeural");
    expect(escapeSsml("+10%")).toBe("+10%");
  });
});
