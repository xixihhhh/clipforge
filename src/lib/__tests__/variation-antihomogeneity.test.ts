import { describe, it, expect } from "vitest";
import { buildVariationPlan, describeSlot } from "@/lib/variation-plan";
import { fingerprintOf, pairSimilarity, homogeneityReport, SIMILARITY_THRESHOLD } from "@/lib/structure-fingerprint";
import { buildHookGuidance } from "@/lib/script-engine/hook-patterns";
import { buildUserPrompt } from "@/lib/script-engine/prompts";

describe("buildVariationPlan", () => {
  it("is deterministic for the same seed and varies with the seed", () => {
    const a = buildVariationPlan({ count: 4, category: "beauty", seed: 7 });
    const b = buildVariationPlan({ count: 4, category: "beauty", seed: 7 });
    expect(a).toEqual(b);
    const c = buildVariationPlan({ count: 4, category: "beauty", seed: 8 });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it("adjacent slots differ in hook, style, voice and caption style", () => {
    const plan = buildVariationPlan({ count: 5, category: "food", styleType: "auto", seed: 3 });
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].hookId).not.toBe(plan[i - 1].hookId);
      expect(plan[i].styleType).not.toBe(plan[i - 1].styleType);
      expect(plan[i].voice).not.toBe(plan[i - 1].voice);
      expect(plan[i].karaoke).not.toBe(plan[i - 1].karaoke);
    }
  });

  it("respects an explicitly locked style and can keep one brand voice", () => {
    const plan = buildVariationPlan({ count: 4, category: "tech", styleType: "story", rotateVoice: false, seed: 1 });
    expect(plan.every((s) => s.styleType === undefined)).toBe(true);
    expect(plan.every((s) => s.voice === undefined)).toBe(true);
    // rotation still applies to the other dimensions
    expect(new Set(plan.map((s) => s.hookId)).size).toBeGreaterThan(1);
  });

  it("one slot per 4-cycle goes BGM-free and BGM slots carry a mood", () => {
    const plan = buildVariationPlan({ count: 8, category: "home", seed: 2 });
    expect(plan.filter((s) => !s.bgm)).toHaveLength(2);
    expect(plan.filter((s) => s.bgm).every((s) => !!s.bgmMood)).toBe(true);
  });

  it("describeSlot renders a readable one-liner", () => {
    const [slot] = buildVariationPlan({ count: 1, category: "beauty", styleType: "auto", seed: 1 });
    const text = describeSlot(slot, { pain_point: "痛点式" });
    expect(text).toContain("钩子:");
    expect(text).toContain("字幕");
  });
});

describe("pinned hook guidance flows into the script prompt", () => {
  it("buildHookGuidance pins to a single mandatory mechanism", () => {
    const pinned = buildHookGuidance("beauty", 5, "suspense_question");
    expect(pinned).toContain("必须");
    expect((pinned.match(/\d+\.【/g) ?? []).length).toBe(1);
    const free = buildHookGuidance("beauty", 5);
    expect((free.match(/\d+\.【/g) ?? []).length).toBeGreaterThan(1);
    // unknown id falls back to the normal multi-pattern guidance
    expect((buildHookGuidance("beauty", 5, "nope").match(/\d+\.【/g) ?? []).length).toBeGreaterThan(1);
  });

  it("buildUserPrompt carries the pinned mechanism", () => {
    const prompt = buildUserPrompt({
      productName: "便携榨汁杯",
      category: "home",
      styleType: "pain_point",
      preferredHookId: "before_after",
    });
    expect(prompt).toContain("本次开场【必须】使用以下钩子机制");
    expect((prompt.match(/1\.【/g) ?? []).length).toBe(1);
  });
});

describe("structure fingerprint + homogeneity report", () => {
  const tpl = (over: Partial<Parameters<typeof fingerprintOf>[0]> = {}) =>
    fingerprintOf({
      styleType: "pain_point",
      shots: [
        { duration: 3, type: "hook" },
        { duration: 5, type: "pain_point" },
        { duration: 5, type: "product_intro" },
        { duration: 4, type: "cta" },
      ],
      ...over,
    });

  it("fingerprints shot structure", () => {
    const f = tpl();
    expect(f).toMatchObject({ styleType: "pain_point", hookType: "hook", shotCount: 4, totalSec: 17 });
    expect(f.avgShotSec).toBeCloseTo(4.25);
  });

  it("identical structures score ~1, different ones score low", () => {
    expect(pairSimilarity(tpl(), tpl())).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    const different = fingerprintOf({
      styleType: "story",
      shots: [
        { duration: 6, type: "scene" },
        { duration: 12, type: "story" },
      ],
    });
    expect(pairSimilarity(tpl(), different)).toBeLessThan(0.3);
  });

  it("verdicts scale with the share of template-alike pairs", () => {
    const risk = homogeneityReport([tpl(), tpl(), tpl()]);
    expect(risk.verdict).toBe("risk");
    expect(risk.similarPairs.length).toBe(3);
    expect(risk.message.zh).toContain("限流");
    const varied = homogeneityReport([
      tpl(),
      fingerprintOf({ styleType: "story", shots: [{ duration: 6, type: "scene" }, { duration: 12, type: "story" }] }),
      fingerprintOf({ styleType: "comparison", shots: [{ duration: 2, type: "hook" }, { duration: 4, type: "compare" }, { duration: 4, type: "cta" }] }),
    ]);
    expect(varied.verdict).toBe("ok");
    const empty = homogeneityReport([]);
    expect(empty.verdict).toBe("ok");
  });
});
