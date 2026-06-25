import { describe, it, expect } from "vitest";
import { buildTopicPrompt, buildTopicBatchPrompt } from "@/lib/script-engine/prompts";

describe("buildTopicPrompt（一句话主题成片，去商品化）", () => {
  it("包含用户输入的主题原文", () => {
    const p = buildTopicPrompt({ topic: "在家如何泡一杯手冲咖啡" });
    expect(p).toContain("在家如何泡一杯手冲咖啡");
  });

  it("强制每个分镜必填英文检索词 searchTerms（自动配画面的关键）", () => {
    const p = buildTopicPrompt({ topic: "城市夜景" });
    expect(p).toContain("searchTerms");
    expect(p).toContain("必填");
  });

  it("英文主题：追加语言指令，要求旁白/标题用英文（避免英文主题出中文旁白）", () => {
    const p = buildTopicPrompt({ topic: "how to brew pour-over coffee at home" });
    expect(p).toContain("LANGUAGE");
    expect(p).toContain("NOT in Chinese");
  });

  it("中文主题：不追加英文语言指令（默认中文不变）", () => {
    const p = buildTopicPrompt({ topic: "在家如何泡手冲咖啡" });
    expect(p).not.toContain("NOT in Chinese");
  });

  it("以主题立框而非商品（不含带货输入字段）", () => {
    const p = buildTopicPrompt({ topic: "雨天适合做的小事" });
    // 围绕「主题」组织，而非带货的「商品信息」输入块
    expect(p).toContain("【主题】");
    expect(p).not.toContain("【商品信息】");
    expect(p).not.toContain("商品名称");
    expect(p).not.toContain("商品品类");
  });

  it("按旁白风格注入对应指令（knowledge=知识科普）", () => {
    const p = buildTopicPrompt({ topic: "黑洞是什么", narrationStyle: "knowledge" });
    expect(p).toContain("知识科普");
  });

  it("情感故事风格注入故事指令", () => {
    const p = buildTopicPrompt({ topic: "童年的夏天", narrationStyle: "story" });
    expect(p).toContain("情感故事");
  });

  it("未指定风格时默认知识科普", () => {
    const p = buildTopicPrompt({ topic: "随便一个主题" });
    expect(p).toContain("知识科普");
  });

  it("尊重目标时长参数", () => {
    const p = buildTopicPrompt({ topic: "主题", targetDuration: 40 });
    expect(p).toContain("40秒");
  });

  it("visualSource 固定 ai_generate（无 product_image）", () => {
    const p = buildTopicPrompt({ topic: "主题" });
    expect(p).toContain('"ai_generate"');
    expect(p).not.toContain("product_image");
  });
});

describe("buildTopicBatchPrompt（多套方案）", () => {
  it("要求生成指定数量的脚本方案", () => {
    const p = buildTopicBatchPrompt({ topic: "手冲咖啡" }, 3);
    expect(p).toContain("生成 3 个");
    expect(p).toContain('"scripts"');
  });

  it("批量提示仍强调每镜带 searchTerms", () => {
    const p = buildTopicBatchPrompt({ topic: "手冲咖啡" }, 2);
    expect(p).toContain("生成 2 个");
    expect(p).toContain("searchTerms");
  });

  it("基底仍包含主题原文", () => {
    const p = buildTopicBatchPrompt({ topic: "极光为什么出现" }, 3);
    expect(p).toContain("极光为什么出现");
  });
});
