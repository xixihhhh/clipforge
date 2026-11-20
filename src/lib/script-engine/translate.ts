/**
 * Dubbing & localization — translate the voiceover of an already-generated script into another language,
 * then re-voice and recompose it (for overseas distribution: publish the same clip across different markets).
 *
 * Because we are "re-languaging a video we generated ourselves", the script and timeline are already known —
 * **no transcription needed**: existing voiceover → LLM translation → target-language Edge TTS → recompose.
 * Visual search fields (description/stockKeywords) are kept as-is so the dubbed version reuses the same footage;
 * only audio and subtitles change. Pure prompt/parse logic is unit-testable; LLM calls reuse the same path as script generation.
 */

import OpenAI from "openai";
export { defaultVoiceForLang } from "@/lib/tts-voices";
import { estimateDurationSec } from "@/lib/script-import";
import { reasoningParams } from "@/lib/script-engine/generator";
import { createLLMClient, withLLMErrors } from "@/lib/llm-error";
import { stripThinkBlocks } from "@/lib/llm-clean";
import type { Shot } from "@/lib/db/schema";

export interface DubLLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Target language code → human-readable name (used as the translation target passed to the LLM) */
export const LANG_NAMES: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  zh: "Chinese (Simplified)",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese",
  ar: "Arabic",
};

export function langName(code: string): string {
  const c = (code || "").toLowerCase();
  return LANG_NAMES[c] || LANG_NAMES[c.split("-")[0]] || code;
}

/** Builds the translation prompt: translates N voiceover lines into the target language one-by-one; expects a same-length JSON string array in return. Pure function. */
export function buildTranslatePrompt(voiceovers: string[], targetLang: string): string {
  const target = langName(targetLang);
  const numbered = voiceovers.map((v, i) => `${i + 1}. ${v}`).join("\n");
  return [
    `Translate the following ${voiceovers.length} short-video narration lines into ${target}.`,
    `Keep each line punchy and natural for spoken voiceover. Do NOT merge or split lines; keep the same order and count.`,
    `Return ONLY a JSON array of ${voiceovers.length} strings — no numbering, no markdown, no extra text.`,
    "",
    numbered,
  ].join("\n");
}

/** Parses a same-length translated string array from LLM output; returns null if the count mismatches or the format is invalid. Pure function. */
export function parseTranslations(text: string, expectedCount: number): string[] | null {
  if (!text) return null;
  // Reasoning models may prepend a <think> trace whose brackets would fool the slicing below
  text = stripThinkBlocks(text);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== expectedCount) return null;
  if (!arr.every((x) => typeof x === "string")) return null;
  return arr.map((s) => (s as string).trim());
}

function createClient(cfg: DubLLMConfig): OpenAI {
  // Shared factory: keyless endpoints get a placeholder key, plus SDK retries + free-pool 402 retry
  return createLLMClient(cfg);
}

/** Calls the LLM to batch-translate voiceovers into the target language; returns a same-length translated array (throws on parse failure). */
export async function translateVoiceovers(voiceovers: string[], targetLang: string, cfg: DubLLMConfig): Promise<string[]> {
  if (!voiceovers.length) return [];
  const client = createClient(cfg);
  const res = await withLLMErrors(
    () =>
      client.chat.completions.create({
        model: cfg.model,
        messages: [{ role: "user", content: buildTranslatePrompt(voiceovers, targetLang) }],
        temperature: 0.3,
        ...reasoningParams(cfg.baseUrl),
      }),
    cfg,
  );
  const text = res.choices?.[0]?.message?.content ?? "";
  const out = parseTranslations(text, voiceovers.length);
  if (!out) throw new Error("翻译结果解析失败（LLM 未返回等长 JSON 数组），可换模型或重试");
  return out;
}

/**
 * Translates an entire script into the target language: replaces each shot's voiceover and re-estimates
 * duration based on the translated text.
 * **Keeps visual search fields such as description/stockKeywords unchanged** so the dubbed version
 * reuses the same footage and only swaps audio/subtitles.
 */
export async function translateShots(shots: Shot[], targetLang: string, cfg: DubLLMConfig): Promise<Shot[]> {
  const voiceovers = shots.map((s) => s.voiceover || "");
  const translated = await translateVoiceovers(voiceovers, targetLang, cfg);
  return shots.map((s, i) => {
    const vo = translated[i];
    if (s.voiceover?.trim() && !vo) throw new Error("Translation returned an empty narration line");
    return { ...s, voiceover: vo, dubLanguage: targetLang, duration: estimateDurationSec(vo) };
  });
}
