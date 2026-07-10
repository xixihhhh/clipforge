import { describe, it, expect } from "vitest";
import {
  classifyLicense,
  buildAttributionLine,
  buildCreditsManifest,
  renderCreditsMarkdown,
} from "@/lib/asset-credits";

describe("classifyLicense", () => {
  it("flags NC/ND variants and unknown licenses for manual review", () => {
    expect(classifyLicense("by-nc-2.0").risk).toBe("review");
    expect(classifyLicense("CC BY-NC-SA 4.0").risk).toBe("review");
    expect(classifyLicense("by-nd-3.0").risk).toBe("review");
    expect(classifyLicense("").risk).toBe("review");
    expect(classifyLicense(null).risk).toBe("review");
    expect(classifyLicense("Unknown").risk).toBe("review");
    expect(classifyLicense("GFDL").risk).toBe("review");
  });

  it("passes public-domain and platform licenses without attribution", () => {
    for (const l of ["cc0-1.0", "CC0", "pdm", "Public Domain (NASA)", "Pexels", "Pixabay"]) {
      const r = classifyLicense(l);
      expect(r.risk).toBe("ok");
      expect(r.requiresAttribution).toBe(false);
    }
  });

  it("requires attribution for CC BY family (openverse + wikimedia spellings)", () => {
    for (const l of ["by-2.0", "by-sa-4.0", "CC BY-SA 4.0", "CC BY 3.0"]) {
      const r = classifyLicense(l);
      expect(r.risk).toBe("attribution");
      expect(r.requiresAttribution).toBe(true);
    }
    // "by" inside a word must not match (e.g. hypothetical "derby license")
    expect(classifyLicense("derby").risk).toBe("review");
  });
});

describe("buildCreditsManifest", () => {
  const stockBy = { shotId: 0, type: "stock_footage", provider: "openverse", filePath: "a.jpg", sourceUrl: "https://x/1", author: "Alice", license: "by-2.0" };
  const stockPd = { shotId: 1, type: "stock_footage", provider: "nasa", filePath: "b.mp4", sourceUrl: "https://x/2", author: "NASA", license: "Public Domain (NASA)" };
  const own = { shotId: 2, type: "user_upload", provider: "local", filePath: "c.png" };
  const ai = { shotId: 3, type: "ai_generated", provider: "atlas", filePath: "d.png" };
  const nc = { shotId: 4, type: "stock_footage", provider: "openverse", filePath: "e.jpg", sourceUrl: "https://x/3", author: "Bob", license: "by-nc-4.0" };

  it("classifies origins, kinds and risks; summary counts add up", () => {
    const m = buildCreditsManifest("测试项目", [stockBy, stockPd, own, ai, nc]);
    expect(m.items).toHaveLength(5);
    expect(m.items[0]).toMatchObject({ origin: "stock", kind: "image", risk: "attribution", requiresAttribution: true });
    expect(m.items[0].attributionLine).toBe("Alice · by-2.0 · https://x/1");
    expect(m.items[1]).toMatchObject({ kind: "video", risk: "ok" });
    expect(m.items[2]).toMatchObject({ origin: "own", risk: "ok" });
    expect(m.items[3]).toMatchObject({ origin: "ai", risk: "ok" });
    expect(m.items[4].risk).toBe("review");
    expect(m.summary).toEqual({ total: 5, needsAttribution: 1, needsReview: 1, commercialSafe: false });
  });

  it("includes the BGM sidecar credit and counts it in the summary", () => {
    const m = buildCreditsManifest("p", [stockPd], { author: "Muse", license: "CC BY 4.0", sourceUrl: "https://x/bgm" });
    expect(m.bgm).toMatchObject({ kind: "audio", requiresAttribution: true });
    expect(m.bgm?.attributionLine).toBe("Muse · CC BY 4.0 · https://x/bgm");
    expect(m.summary).toEqual({ total: 2, needsAttribution: 1, needsReview: 0, commercialSafe: true });
  });

  it("is commercially safe when nothing needs review", () => {
    const m = buildCreditsManifest("p", [stockBy, stockPd, own]);
    expect(m.summary.commercialSafe).toBe(true);
  });
});

describe("renderCreditsMarkdown", () => {
  const m = buildCreditsManifest(
    "咖啡好物",
    [
      { shotId: 0, type: "stock_footage", provider: "openverse", filePath: "a.jpg", sourceUrl: "https://x/1", author: "Alice", license: "by-2.0" },
      { shotId: 1, type: "stock_footage", provider: "openverse", filePath: "b.jpg", sourceUrl: "https://x/2", author: "Bob", license: "by-nc-4.0" },
    ],
    { author: "Muse", license: "cc0", sourceUrl: "https://x/bgm" }
  );

  it("renders bilingual reports with attribution + review sections", () => {
    const zh = renderCreditsMarkdown(m, "zh");
    expect(zh).toContain("# 素材授权清单 — 咖啡好物");
    expect(zh).toContain("需附署名");
    expect(zh).toContain("Alice · by-2.0 · https://x/1");
    expect(zh).toContain("需人工复核");
    expect(zh).toContain("分镜 2");
    expect(zh).toContain("⚠️");
    const en = renderCreditsMarkdown(m, "en");
    expect(en).toContain("Asset license manifest");
    expect(en).toContain("Required attributions");
    expect(en).toContain("Shot 2");
  });

  it("shows the all-clear verdict when nothing needs review", () => {
    const clean = buildCreditsManifest("p", [
      { shotId: 0, type: "stock_footage", provider: "nasa", filePath: "a.mp4", sourceUrl: "https://x", author: "NASA", license: "Public Domain (NASA)" },
    ]);
    expect(renderCreditsMarkdown(clean, "zh")).toContain("✅");
    expect(renderCreditsMarkdown(clean, "en")).toContain("✅");
  });

  it("attribution line falls back gracefully on missing fields", () => {
    expect(buildAttributionLine({ author: null, license: "by-2.0", sourceUrl: null })).toBe("Unknown author · by-2.0");
  });
});
