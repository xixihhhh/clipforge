// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DUB_LANGUAGES } from "@/lib/tts-voices";
import { buildSubtitleTimeline } from "@/lib/video-composer/timeline";
import { type Shot } from "@/lib/db/schema";
import { translateShots, buildTranslatePrompt, parseTranslations, langName, defaultVoiceForLang } from "@/lib/script-engine/translate";

describe("langName / defaultVoiceForLang", () => {
  it("code → 语种名（带区域 code 退化到主码）", () => {
    expect(langName("en")).toBe("English");
    expect(langName("ja-JP")).toBe("Japanese");
    expect(langName("xx")).toBe("xx");
  });
  it("目标语种 → 免费音色（lang 前缀匹配 FREE_TTS_VOICES）", () => {
    expect(defaultVoiceForLang("en")).toBe("en-US-AriaNeural");
    expect(defaultVoiceForLang("ja")).toBe("ja-JP-NanamiNeural");
    expect(defaultVoiceForLang("ko")).toBe("ko-KR-SunHiNeural");
    expect(defaultVoiceForLang("zh")).toBe("zh-CN-XiaoxiaoNeural");
    expect(defaultVoiceForLang("xx")).toBeNull();
  });
});

describe("buildTranslatePrompt", () => {
  it("含目标语种名、条数、JSON 要求、逐条编号", () => {
    const p = buildTranslatePrompt(["你好", "买它"], "en");
    expect(p).toContain("English");
    expect(p).toContain("2");
    expect(p).toContain("JSON array");
    expect(p).toContain("1. 你好");
    expect(p).toContain("2. 买它");
  });
});

describe("parseTranslations", () => {
  it("原始 JSON 数组", () => {
    expect(parseTranslations('["Hi","Buy it"]', 2)).toEqual(["Hi", "Buy it"]);
  });
  it("```json 围栏 + 周围文字", () => {
    expect(parseTranslations('Sure:\n```json\n["a","b","c"]\n```', 3)).toEqual(["a", "b", "c"]);
  });
  it("数量不符 → null", () => {
    expect(parseTranslations('["a"]', 2)).toBeNull();
  });
  it("非字符串数组 → null", () => {
    expect(parseTranslations("[1,2]", 2)).toBeNull();
  });
  it("非法文本 → null", () => {
    expect(parseTranslations("not json", 1)).toBeNull();
  });
});

describe("localized video scripts", () => {
  const source: Shot = {
    shotId: 1, type: "hook", duration: 3, description: "same product", camera: "static",
    visualSource: "user_upload", transition: "direct_concat", voiceover: "十二欧元",
  };
  it.each([
    ["de", "German", "de-DE-KatjaNeural", "Zwölf Euro."],
    ["fr", "French", "fr-FR-DeniseNeural", "Douze euros."],
  ])("exposes %s, saves the target for the voice and captions the translated line", async (code, language, voice, line) => {
    expect(DUB_LANGUAGES).toContain(code);
    const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify([line]) } }] }));
    vi.stubGlobal("fetch", fetch);
    try {
      const [shot] = await translateShots([source], code, { model: "translation", apiKey: "", baseUrl: "http://localhost:11434/v1" });
      expect(fetch).toHaveBeenCalledOnce();
      expect(buildTranslatePrompt([source.voiceover], code)).toContain(language);
      expect(shot).toMatchObject({ description: source.description, voiceover: line, dubLanguage: code });
      expect(defaultVoiceForLang(shot.dubLanguage!)).toBe(voice);
      expect(buildSubtitleTimeline([shot]).cues.map((cue) => cue.text).join(" ")).toContain(line);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
