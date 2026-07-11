/**
 * Anti-homogenization variation plan — assigns each item in a batch a deliberately different
 * structural mix (opening hook mechanism / script style / voice / BGM mood / caption style /
 * duration jitter) so a batch doesn't ship N near-identical videos.
 *
 * Why (2026 survey): platforms now suppress template-repetitive output at the account level
 * (YouTube "Inauthentic Content" purges, Douyin low-quality duplication downranking); "same
 * structure 5-7 posts in a row" is a policy-level risk, not a taste issue.
 *
 * Deterministic: dimension pools are walked with coprime strides from a seeded start, so plans
 * are reproducible in tests and adjacent items differ in almost every dimension. Explicit user
 * choices are respected — a locked style/voice is never overridden, rotation fills the rest.
 */
import { FREE_TTS_VOICES } from "@/lib/tts-voices";
import { selectHookPatterns } from "@/lib/script-engine/hook-patterns";
import type { ProductCategory } from "@/lib/script-engine/templates";

export interface VariationSlot {
  index: number;
  /** opening hook mechanism id (HOOK_PATTERNS), pinned into the script prompt */
  hookId: string;
  hookName: string;
  /** script style override — only set when the user chose "auto" (an explicit style is respected) */
  styleType?: string;
  /** free Edge TTS voice — only set when voice rotation is enabled */
  voice?: string;
  voiceLabel?: string;
  /** free BGM on + mood (BGM is a strong differentiator; one slot per cycle stays BGM-free) */
  bgm: boolean;
  bgmMood?: "upbeat" | "chill" | "energetic" | "emotional";
  /** caption style alternation: karaoke word-highlight vs rapid short-sentence cards */
  karaoke: boolean;
  /** seconds added to the base duration (small jitter so videos don't all share one length) */
  durationOffset: number;
}

const STYLE_POOL = ["pain_point", "scene", "comparison", "story"] as const;
const MOOD_POOL = ["upbeat", "chill", "energetic", "emotional"] as const;
const DURATION_OFFSETS = [0, 3, -3, 5] as const;

/** deterministic tiny PRNG (mulberry32) — reproducible plans for tests and reruns */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface VariationPlanOpts {
  count: number;
  category: ProductCategory;
  /** user's style choice; "auto" lets the plan rotate styles, anything else is locked */
  styleType?: string;
  /** rotate the free zh voices (default true; set false to keep one brand voice) */
  rotateVoice?: boolean;
  /** plan seed — different batches get different starting offsets (default 1) */
  seed?: number;
}

/** Build the rotation plan: index-aligned slots for the batch items. Pure function. */
export function buildVariationPlan(opts: VariationPlanOpts): VariationSlot[] {
  const { count, category } = opts;
  if (count <= 0) return [];
  const rand = mulberry32(opts.seed ?? 1);
  const hooks = selectHookPatterns(category, 5);
  const zhVoices = FREE_TTS_VOICES.filter((v) => v.lang === "zh-CN");
  const styleLocked = opts.styleType && opts.styleType !== "auto";

  // random starting offset per dimension + coprime strides so adjacent slots differ almost everywhere
  const start = (n: number) => Math.floor(rand() * n);
  const hookStart = start(hooks.length);
  const styleStart = start(STYLE_POOL.length);
  const voiceStart = start(Math.max(1, zhVoices.length));
  const moodStart = start(MOOD_POOL.length);

  return Array.from({ length: count }, (_, i) => {
    const hook = hooks[(hookStart + i) % hooks.length];
    const voice = zhVoices.length > 0 ? zhVoices[(voiceStart + i) % zhVoices.length] : undefined;
    // one slot per 4-cycle goes BGM-free (silence/original-pace is itself a variation dimension)
    const bgm = (moodStart + i) % 4 !== 3;
    const slot: VariationSlot = {
      index: i,
      hookId: hook.id,
      hookName: hook.name,
      bgm,
      ...(bgm ? { bgmMood: MOOD_POOL[(moodStart + i) % MOOD_POOL.length] } : {}),
      karaoke: i % 2 === 1,
      durationOffset: DURATION_OFFSETS[i % DURATION_OFFSETS.length],
    };
    if (!styleLocked) slot.styleType = STYLE_POOL[(styleStart + i) % STYLE_POOL.length];
    if (opts.rotateVoice !== false && voice) {
      slot.voice = voice.value;
      slot.voiceLabel = voice.label;
    }
    return slot;
  });
}

/** Human-readable one-liner for a slot (shown next to each batch task so the rotation is visible). */
export function describeSlot(slot: VariationSlot, styleNames: Record<string, string> = {}, locale: "zh" | "en" = "zh"): string {
  const zh = locale === "zh";
  const bits = [`${zh ? "钩子" : "Hook"}:${slot.hookName}`];
  if (slot.styleType) bits.push(`${zh ? "风格" : "Style"}:${styleNames[slot.styleType] ?? slot.styleType}`);
  if (slot.voiceLabel) bits.push(`${zh ? "音色" : "Voice"}:${slot.voiceLabel.split(" ·")[0]}`);
  bits.push(slot.bgm ? `BGM:${slot.bgmMood}` : zh ? "无BGM" : "no BGM");
  bits.push(slot.karaoke ? (zh ? "卡拉OK字幕" : "karaoke captions") : zh ? "短句卡字幕" : "card captions");
  if (slot.durationOffset !== 0) bits.push(`${zh ? "时长" : "len"}${slot.durationOffset > 0 ? "+" : ""}${slot.durationOffset}s`);
  return bits.join(" · ");
}
