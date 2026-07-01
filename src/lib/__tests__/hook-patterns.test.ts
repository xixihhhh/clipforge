import { describe, it, expect } from "vitest";
import { selectHookPatterns, buildHookGuidance, HOOK_PATTERNS } from "@/lib/script-engine/hook-patterns";
import { buildUserPrompt, platformTargetLabel } from "@/lib/script-engine/prompts";

describe("selectHookPatterns", () => {
  it("命中品类的卡片优先（美妆 → 第一张命中 beauty，且含 before_after）", () => {
    const sel = selectHookPatterns("beauty", 5);
    expect(sel.length).toBeLessThanOrEqual(5);
    expect(sel[0].categories?.includes("beauty")).toBe(true);
    expect(sel.map((p) => p.id)).toContain("before_after");
  });

  it("不足 n 时补通用卡、去重", () => {
    const sel = selectHookPatterns("tech", 8);
    expect(new Set(sel.map((p) => p.id)).size).toBe(sel.length); // no duplicates
    // generic cards (no categories) will be filled in
    expect(sel.some((p) => !p.categories)).toBe(true);
  });

  it("n 限制生效", () => {
    expect(selectHookPatterns("food", 3).length).toBe(3);
  });

  it("每张卡都有完整三拍 + 示例", () => {
    for (const p of HOOK_PATTERNS) {
      expect(p.stop && p.prove && p.bridge && p.example).toBeTruthy();
    }
  });
});

describe("buildHookGuidance", () => {
  it("含三拍结构 + 品类名 + 多脚本差异化提示", () => {
    const g = buildHookGuidance("beauty");
    expect(g).toContain("三拍结构");
    expect(g).toContain("截停拇指");
    expect(g).toContain("证明相关");
    expect(g).toContain("接到产品");
    expect(g).toContain("美妆护肤"); // category name injected
    expect(g).toContain("A/B"); // each script uses a different hook mechanism
  });
});

describe("buildUserPrompt 已接入钩子指引（集成锁）", () => {
  it("带货脚本提示词含三拍结构钩子指引", () => {
    const prompt = buildUserPrompt({ productName: "测试面膜", category: "beauty", styleType: "pain_point", targetDuration: 25 });
    expect(prompt).toContain("三拍结构");
    expect(prompt).toContain("截停拇指");
  });
});

describe("platformTargetLabel（目标平台标签，随投放平台变化）", () => {
  it("未指定 → 默认抖音/快手（保持既有行为）", () => {
    expect(platformTargetLabel()).toBe("抖音/快手");
    expect(platformTargetLabel("")).toBe("抖音/快手");
  });

  it("识别海外/国内各平台码", () => {
    expect(platformTargetLabel("tiktok")).toBe("TikTok");
    expect(platformTargetLabel("xiaohongshu")).toBe("小红书");
    expect(platformTargetLabel("reels")).toBe("Instagram Reels");
  });

  it("多平台去重、大小写与空格容错、以 / 连接", () => {
    expect(platformTargetLabel("TikTok, reels , shorts")).toBe("TikTok / Instagram Reels / YouTube Shorts");
    expect(platformTargetLabel("douyin,douyin,kuaishou")).toBe("抖音 / 快手");
  });

  it("全部无法识别 → 回退默认，不产出空标签", () => {
    expect(platformTargetLabel("unknown,foo")).toBe("抖音/快手");
  });
});

describe("buildUserPrompt 目标平台随 platforms 变化（不再硬编码抖音/快手）", () => {
  it("投放 TikTok 时，目标平台行写 TikTok 而非抖音/快手", () => {
    const prompt = buildUserPrompt({ productName: "test serum", category: "beauty", styleType: "pain_point", platforms: "tiktok" });
    expect(prompt).toContain("目标平台：TikTok");
    expect(prompt).not.toContain("目标平台：抖音/快手");
  });

  it("未指定平台时仍默认抖音/快手", () => {
    const prompt = buildUserPrompt({ productName: "测试面膜", category: "beauty", styleType: "pain_point" });
    expect(prompt).toContain("目标平台：抖音/快手");
  });

  it("投放 Reels / Shorts 时注入对应平台算法指令", () => {
    const reels = buildUserPrompt({ productName: "serum", category: "beauty", styleType: "scene", platforms: "reels" });
    expect(reels).toContain("Instagram Reels 算法优化策略");
    const shorts = buildUserPrompt({ productName: "serum", category: "beauty", styleType: "scene", platforms: "shorts" });
    expect(shorts).toContain("YouTube Shorts 算法优化策略");
  });

  it("投放视频号时注入视频号（微信）算法指令，目标平台标签为视频号", () => {
    const p = buildUserPrompt({ productName: "云柔抽纸", category: "home", styleType: "pain_point", platforms: "shipinhao" });
    expect(p).toContain("视频号（微信）算法优化策略");
    expect(p).toContain("目标平台：视频号");
  });
});
