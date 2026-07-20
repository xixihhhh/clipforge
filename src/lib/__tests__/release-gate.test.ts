import { describe, it, expect } from "vitest";
import {
  buildGateReport,
  gateItemFromCredits,
  gateItemFromQc,
  gateItemFromReadiness,
} from "@/lib/release-gate";
import { buildCreditsManifest } from "@/lib/asset-credits";
import type { ReadinessReport } from "@/lib/publish-readiness";
import type { QcReport } from "@/lib/video-composer/qc";

function readiness(overall: ReadinessReport["overall"], items: Array<[string, "pass" | "warn" | "fail"]>, locale: "zh" | "en"): ReadinessReport {
  const list = items.map(([key, status]) => ({ key: key as never, status, message: `${locale}:${key}` }));
  return {
    items: list,
    pass: list.filter((i) => i.status === "pass").length,
    warn: list.filter((i) => i.status === "warn").length,
    fail: list.filter((i) => i.status === "fail").length,
    overall,
  };
}

function qcReport(status: QcReport["status"]): QcReport {
  const checks: QcReport["checks"] = [
    { id: "video-stream", level: "ok", message: { zh: "视频流正常", en: "Video OK" } },
  ];
  if (status !== "ok") {
    checks.push({ id: "black", level: status === "fail" ? "fail" : "warn", message: { zh: "黑屏", en: "Black frames" } });
  }
  return {
    status,
    checks,
    probe: { hasVideo: true, hasAudio: true, width: 1080, height: 1920, duration: 25 },
    signals: { black: [], silence: [], freeze: [], loudness: -14, truePeak: -2 },
  };
}

describe("gateItemFromReadiness", () => {
  it("fails when there is no script to check", () => {
    const item = gateItemFromReadiness(null, null);
    expect(item.status).toBe("fail");
    expect(item.message.zh).toContain("脚本");
    expect(item.problems).toEqual([]);
  });

  it("maps needsWork → fail and zips bilingual problem lines by index", () => {
    const zh = readiness("needsWork", [["compliance", "fail"], ["hook", "pass"], ["cta", "warn"]], "zh");
    const en = readiness("needsWork", [["compliance", "fail"], ["hook", "pass"], ["cta", "warn"]], "en");
    const item = gateItemFromReadiness(zh, en);
    expect(item.status).toBe("fail");
    // only non-pass items become problems, each carrying both locales
    expect(item.problems).toEqual([
      { zh: "zh:compliance", en: "en:compliance" },
      { zh: "zh:cta", en: "en:cta" },
    ]);
  });

  it("maps risky → warn and ready → pass", () => {
    expect(gateItemFromReadiness(readiness("risky", [["cta", "warn"]], "zh"), readiness("risky", [["cta", "warn"]], "en")).status).toBe("warn");
    const pass = gateItemFromReadiness(readiness("ready", [["hook", "pass"]], "zh"), readiness("ready", [["hook", "pass"]], "en"));
    expect(pass.status).toBe("pass");
    expect(pass.problems).toEqual([]);
  });
});

describe("gateItemFromQc", () => {
  it("fails when nothing was composed yet", () => {
    const item = gateItemFromQc(null);
    expect(item.status).toBe("fail");
    expect(item.message.en).toContain("compose");
  });

  it("forwards non-ok check messages as problems", () => {
    const item = gateItemFromQc(qcReport("fail"));
    expect(item.status).toBe("fail");
    expect(item.problems).toEqual([{ zh: "黑屏", en: "Black frames" }]);
  });

  it("maps warn → warn and ok → pass", () => {
    expect(gateItemFromQc(qcReport("warn")).status).toBe("warn");
    expect(gateItemFromQc(qcReport("ok")).status).toBe("pass");
  });
});

describe("gateItemFromCredits", () => {
  it("warns when there are no asset records to verify", () => {
    expect(gateItemFromCredits(null).status).toBe("warn");
  });

  it("warns on review-needed licenses with per-asset problem lines", () => {
    const m = buildCreditsManifest("测试", [
      { shotId: 0, type: "stock_footage", license: "cc-by-nc-4.0", filePath: "a.jpg" },
      { shotId: 1, type: "stock_footage", license: "pexels", filePath: "b.mp4" },
    ]);
    const item = gateItemFromCredits(m);
    expect(item.status).toBe("warn");
    expect(item.message.zh).toContain("人工复核");
    expect(item.problems.some((p) => p.zh.includes("分镜 1"))).toBe(true);
  });

  it("warns on attribution-only manifests and passes clean ones", () => {
    const attr = buildCreditsManifest("t", [{ shotId: 0, type: "stock_footage", license: "cc-by-4.0", author: "A", filePath: "a.jpg" }]);
    const attrItem = gateItemFromCredits(attr);
    expect(attrItem.status).toBe("warn");
    expect(attrItem.message.zh).toContain("署名");
    const clean = buildCreditsManifest("t", [{ shotId: 0, type: "stock_footage", license: "pexels", filePath: "a.jpg" }]);
    expect(gateItemFromCredits(clean).status).toBe("pass");
  });
});

describe("buildGateReport", () => {
  it("worst status wins and counts are tallied", () => {
    const report = buildGateReport([
      gateItemFromQc(qcReport("ok")),
      gateItemFromCredits(null),
      gateItemFromReadiness(null, null),
    ]);
    expect(report.status).toBe("fail");
    expect(report.summary).toEqual({ pass: 1, warn: 1, fail: 1 });
    expect(report.verdict.zh).toContain("未过");
    expect(report.verdict.en.length).toBeGreaterThan(0);
  });

  it("all pass → pass with a positive verdict", () => {
    const report = buildGateReport([gateItemFromQc(qcReport("ok"))]);
    expect(report.status).toBe("pass");
    expect(report.verdict.zh).toContain("通过");
  });

  it("warn without fail → warn", () => {
    const report = buildGateReport([gateItemFromQc(qcReport("ok")), gateItemFromCredits(null)]);
    expect(report.status).toBe("warn");
  });
});
