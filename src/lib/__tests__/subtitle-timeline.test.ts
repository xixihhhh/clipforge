import { describe, it, expect } from "vitest";
import { buildSubtitleTimeline, padDurationsForFade } from "@/lib/video-composer/timeline";
import { FADE_DURATION } from "@/lib/video-composer/composer";
import { estimateSpeechSeconds } from "@/lib/tts";

describe("padDurationsForFade（acrossfade 吃尾巴的垫长）", () => {
  it("后接 ffmpeg_fade 的带人声片段补垫 FADE_DURATION", () => {
    const out = padDurationsForFade([
      { duration: 4, transition: "direct_concat", hasVoice: true },
      { duration: 5, transition: "ffmpeg_fade", hasVoice: true },
      { duration: 3, transition: "direct_concat", hasVoice: true },
    ]);
    expect(out).toEqual([4 + FADE_DURATION, 5, 3]);
  });

  it("无人声片段不垫（画面冻结无意义）；末段永不垫", () => {
    const out = padDurationsForFade([
      { duration: 4, transition: "direct_concat", hasVoice: false },
      { duration: 5, transition: "ffmpeg_fade", hasVoice: true },
    ]);
    expect(out).toEqual([4, 5]);
  });
});

describe("buildSubtitleTimeline（字幕/贴片时间轴）", () => {
  it("直拼接：段间无缝、总时长为各段之和", () => {
    const { cues, total } = buildSubtitleTimeline([
      { duration: 4, transition: "direct_concat", voiceover: "第一段的旁白，测试用。" },
      { duration: 4, transition: "direct_concat", voiceover: "第二段的旁白，测试用。" },
    ]);
    expect(total).toBe(8);
    expect(cues[0].startTime).toBe(0);
    expect(cues[cues.length - 1].endTime).toBe(8);
    // no overlap anywhere
    for (let i = 1; i < cues.length; i++)
      expect(cues[i].startTime).toBeGreaterThanOrEqual(cues[i - 1].endTime - 0.001);
  });

  it("ffmpeg_fade：时间轴前移 FADE_DURATION，且跨段字幕卡不叠印（issue #14 隐藏 bug）", () => {
    const { cues, karaokeLines, total } = buildSubtitleTimeline([
      { duration: 4, transition: "direct_concat", voiceover: "上一段还没说完的旁白。" },
      { duration: 4, transition: "ffmpeg_fade", voiceover: "下一段抢进来的旁白。" },
    ]);
    expect(total).toBeCloseTo(8 - FADE_DURATION, 3);
    // second segment starts at 4 - FADE_DURATION; first segment's cards must not spill past it
    const boundary = 4 - FADE_DURATION;
    const firstSegCards = cues.filter((c) => c.startTime < boundary);
    for (const c of firstSegCards) expect(c.endTime).toBeLessThanOrEqual(boundary + 0.001);
    // global invariant: at any moment at most one caption card is visible
    const sorted = [...cues].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i].startTime).toBeGreaterThanOrEqual(sorted[i - 1].endTime - 0.001);
    // karaoke lines follow the same clamp
    expect(karaokeLines[0].endTime).toBeLessThanOrEqual(boundary + 0.001);
  });

  it("字幕卡按语音实际时长分布，末卡保持到片段结束（气口不空屏）", () => {
    const { cues } = buildSubtitleTimeline([
      {
        duration: 6,
        transition: "direct_concat",
        voiceover: "气足劲爽，一口下去透心凉；经典可乐味，越喝越过瘾。",
        voiceSec: 5, // 5s of speech + 1s padded tail
      },
    ]);
    // all cards except the held last one live inside the speech window (5 + 0.15 rounding)
    for (const c of cues.slice(0, -1)) expect(c.endTime).toBeLessThanOrEqual(5.15 + 0.001);
    // last card holds through the breathing gap to the segment end
    expect(cues[cues.length - 1].endTime).toBe(6);
  });

  it("贴片走时间轴累计（含 fade 前移），不受配音影响", () => {
    const { overlays } = buildSubtitleTimeline([
      { duration: 4, transition: "direct_concat", overlay: { text: "冰爽加倍", style: "title" } },
      { duration: 4, transition: "ffmpeg_fade", overlay: { text: "¥9.9", style: "price" } },
    ]);
    expect(overlays).toHaveLength(2);
    expect(overlays[0]).toMatchObject({ startTime: 0, endTime: 4 });
    expect(overlays[1].startTime).toBeCloseTo(4 - FADE_DURATION, 3);
  });
});

describe("estimateSpeechSeconds（ffprobe 失败时的文本估时兜底）", () => {
  it("空文本为 0；非空至少 1s", () => {
    expect(estimateSpeechSeconds("")).toBe(0);
    expect(estimateSpeechSeconds("好")).toBeGreaterThanOrEqual(1);
  });

  it("估时随文本变长单调增加，且中文语速在合理区间", () => {
    const short = estimateSpeechSeconds("百事可乐，冰爽加倍！");
    const long = estimateSpeechSeconds(
      "百事可乐，冰爽加倍！气足劲爽，一口下去透心凉；经典可乐味，配饭配串配火锅，越喝越过瘾。"
    );
    expect(long).toBeGreaterThan(short);
    // ~8 CJK chars ≈ 2-4s; full sentence (~38 chars) ≈ 9-14s — sanity band, not exact
    expect(short).toBeGreaterThan(1.5);
    expect(short).toBeLessThan(5);
    expect(long).toBeGreaterThan(8);
    expect(long).toBeLessThan(16);
  });

  it("宁长勿短：估时略高于常规语速（欠估会剪断语音）", () => {
    // 10 CJK chars at ~4.2 chars/s ≈ 2.38s raw; the 1.15 safety factor must push it above that
    expect(estimateSpeechSeconds("一二三四五六七八九十")).toBeGreaterThan(10 / 4.2);
  });
});
