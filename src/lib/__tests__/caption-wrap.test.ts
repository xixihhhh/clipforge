import { describe, it, expect } from "vitest";
import { wrapCaption, chunkCaption } from "@/lib/video-composer/composer";

// width estimation consistent with component: CJK≈fontSize, Latin≈fontSize×0.55; max frameWidth×0.86
const fits = (line: string, fontSize: number, frameWidth: number) => {
  const w = Array.from(line).reduce(
    (s, c) => s + (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(c) ? fontSize : fontSize * 0.55),
    0
  );
  return w <= frameWidth * 0.86 + 0.01;
};

describe("wrapCaption（字幕自动换行）", () => {
  it("长英文折成多行，且每行都不超宽", () => {
    const text = "Still using tissues that tear at one wipe in your living room today";
    const out = wrapCaption(text, 36, 720);
    expect(out).toContain("\n"); // actually wrapped
    for (const line of out.split("\n")) expect(fits(line, 36, 720)).toBe(true);
    // no characters lost (word order unchanged after removing newlines)
    expect(out.replace(/\n/g, " ")).toBe(text);
  });

  it("拉丁按单词断行，不拆开单词", () => {
    const out = wrapCaption("hello wonderful beautiful morning sunshine coffee", 40, 480);
    for (const line of out.split("\n")) {
      // each line is a complete word combination (no split words)
      expect(line.trim().split(" ").every((w) => w.length > 0)).toBe(true);
    }
  });

  it("短文案不换行", () => {
    expect(wrapCaption("你好世界", 36, 720)).toBe("你好世界");
    expect(wrapCaption("Hi there", 36, 720)).toBe("Hi there");
  });

  it("长中文（无空格）按字断行且不超宽", () => {
    const text = "这是一句非常非常非常非常非常非常非常非常长的中文字幕用来测试自动换行是否生效";
    const out = wrapCaption(text, 48, 720);
    expect(out).toContain("\n");
    for (const line of out.split("\n")) expect(fits(line, 48, 720)).toBe(true);
    expect(out.replace(/\n/g, "")).toBe(text); // Chinese has no spaces, removing newlines should restore original
  });

  it("空串返回空串", () => {
    expect(wrapCaption("", 36, 720)).toBe("");
    expect(wrapCaption("   ", 36, 720)).toBe("");
  });
});

describe("chunkCaption（rapid 短句卡切分）", () => {
  it("短文案/短时长 → 单块（整句一镜到底）", () => {
    expect(chunkCaption("你好", 0, 1)).toEqual([{ text: "你好", startTime: 0, endTime: 1 }]);
    expect(chunkCaption("Hi there", 0, 1).length).toBe(1);
  });

  it("空串 → 空数组", () => {
    expect(chunkCaption("", 0, 3)).toEqual([]);
    expect(chunkCaption("   ", 0, 3)).toEqual([]);
  });

  it("长中文按字切多块：顺序不重叠、首块起于 start、末块止于 end、合起来还原原文", () => {
    const txt = "清晨的海浪轻轻拍打着柔软的沙滩";
    const out = chunkCaption(txt, 0, 6);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].startTime).toBe(0);
    expect(out[out.length - 1].endTime).toBe(6);
    // ordered, non-overlapping
    for (let i = 1; i < out.length; i++) expect(out[i].startTime).toBeCloseTo(out[i - 1].endTime, 3);
    // rejoined text equals original (Chinese has no spaces)
    expect(out.map((c) => c.text).join("")).toBe(txt);
  });

  it("英文按词切块（不拆词）", () => {
    const out = chunkCaption("the quick brown fox jumps over the lazy dog now", 0, 6);
    expect(out.length).toBeGreaterThan(1);
    expect(out.map((c) => c.text).join(" ")).toBe("the quick brown fox jumps over the lazy dog now");
  });

  it("块数随时长增加（更长的镜头切更多块），且封顶 8", () => {
    const txt = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
    expect(chunkCaption(txt, 0, 2).length).toBeLessThan(chunkCaption(txt, 0, 10).length);
    expect(chunkCaption(txt, 0, 60).length).toBeLessThanOrEqual(8);
  });

  // issue #14 regression: caption cards must cut at punctuation, never mid-phrase
  it("带标点文案按标点断句：不从短语中间截断、不丢字、块首无标点（issue #14）", () => {
    const txt =
      "百事可乐，冰爽加倍！气足劲爽，一口下去透心凉；经典可乐味，配饭配串配火锅，越喝越过瘾；聚会囤一箱，追剧开黑小烧烤，随手一罐,快乐即刻开盖！";
    const out = chunkCaption(txt, 0, 20);
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThanOrEqual(8);
    // no characters lost or reordered
    expect(out.map((c) => c.text).join("")).toBe(txt);
    // every card boundary sits on punctuation: non-final cards end with a mark, no card starts with one
    const punct = /[。！？；，、：…!?;,.]/;
    for (let i = 0; i < out.length; i++) {
      const chars = Array.from(out[i].text);
      expect(punct.test(chars[0])).toBe(false);
      if (i < out.length - 1) expect(punct.test(chars[chars.length - 1])).toBe(true);
    }
    // ordered, non-overlapping, exact endpoints
    expect(out[0].startTime).toBe(0);
    expect(out[out.length - 1].endTime).toBe(20);
    for (let i = 1; i < out.length; i++) expect(out[i].startTime).toBeCloseTo(out[i - 1].endTime, 3);
  });

  it("小数点不拆（9.9 元不被切成 9/.9）", () => {
    const out = chunkCaption("现价9.9元，限时秒杀！", 0, 4);
    expect(out.map((c) => c.text).join("")).toBe("现价9.9元，限时秒杀！");
    expect(out.some((c) => c.text.includes("9.9"))).toBe(true);
  });

  it("时长太短时合并到能读完为止（每卡 ≥0.6s）", () => {
    const txt = "先囤一箱，追剧开黑，随手一罐，快乐开盖！";
    const out = chunkCaption(txt, 0, 1.5);
    // 1.5s window → at most 2 cards
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.map((c) => c.text).join("")).toBe(txt);
  });

  it("零碎短语（哇！等）并入邻卡，不单独闪一帧", () => {
    const out = chunkCaption("哇！这也太好喝了吧，必须回购！", 0, 6);
    for (const c of out) expect(Array.from(c.text).length).toBeGreaterThanOrEqual(3);
    expect(out.map((c) => c.text).join("")).toBe("哇！这也太好喝了吧，必须回购！");
  });
});
