/**
 * Caption style presets — named subtitle looks applied at compose time.
 *
 * The 2026 agent-skill video-editing wave converged on a small set of named caption
 * styles (punchy high-impact / standard boxed / minimal) as the single most-used
 * option; this module brings the same triad to ClipForge, plus our existing
 * word-by-word karaoke burn-in as a fourth preset.
 *
 * Pure data + pure functions: the compose route validates the id and merges the
 * overrides into ComposeConfig.subtitle; the composer consumes fontSizeRatio/box
 * without knowing presets exist.
 */

export type CaptionPresetId = "standard" | "bold" | "minimal" | "karaoke";

export interface CaptionPresetSpec {
  id: CaptionPresetId;
  /** font size as a ratio of frame width (composer default is 0.05) */
  fontSizeRatio: number;
  /** drawtext font colour */
  color: string;
  /** outline stroke width in px */
  strokeWidth: number;
  /** background box: false = no box, or a boxcolor string like "black@0.45" */
  box: false | { color: string };
  /** true → render via the karaoke ASS path (per-character highlight) instead of drawtext */
  karaoke?: boolean;
}

export const CAPTION_PRESETS: Record<CaptionPresetId, CaptionPresetSpec> = {
  // byte-equivalent to the composer's historical defaults — selecting it changes nothing
  standard: { id: "standard", fontSizeRatio: 0.05, color: "white", strokeWidth: 3, box: { color: "black@0.45" } },
  // punch style: bigger type, heavy outline, no box — the high-retention "creator caption" look
  bold: { id: "bold", fontSizeRatio: 0.062, color: "white", strokeWidth: 6, box: false },
  // minimal: smaller, thin stroke, no box — clean documentary/lifestyle look
  minimal: { id: "minimal", fontSizeRatio: 0.042, color: "white", strokeWidth: 2, box: false },
  // karaoke: delegates to the existing ASS per-character highlight path (price/number accent built in)
  karaoke: { id: "karaoke", fontSizeRatio: 0.05, color: "white", strokeWidth: 3, box: { color: "black@0.45" }, karaoke: true },
};

export const CAPTION_PRESET_IDS = Object.keys(CAPTION_PRESETS) as CaptionPresetId[];

export function isCaptionPreset(v: unknown): v is CaptionPresetId {
  return typeof v === "string" && v in CAPTION_PRESETS;
}

/**
 * Subtitle-config overrides for a drawtext preset (karaoke presets are handled by
 * the route switching to the ASS path instead). Returns {} for unknown/absent ids
 * so callers can spread it unconditionally.
 */
export function captionPresetOverrides(
  id: string | undefined
): { fontSizeRatio?: number; color?: string; strokeWidth?: number; box?: false | { color: string } } {
  if (!id || !isCaptionPreset(id)) return {};
  const p = CAPTION_PRESETS[id];
  if (p.karaoke) return {};
  return { fontSizeRatio: p.fontSizeRatio, color: p.color, strokeWidth: p.strokeWidth, box: p.box };
}
