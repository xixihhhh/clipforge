import type { Shot } from "@/lib/db/schema";
import type { GenerationControlSummary } from "@/lib/video-repair-plan";

/**
 * Asset page view row: derived from "shots of the selected script" + "persisted assets".
 * Pure data, no React dependency — shared between initial asset-page load and post-fill refresh (unit-testable).
 */
export interface AssetItem {
  referenceCut?: Shot["referenceCut"];
  mediaUrl?: string;
  assetId?: string;
  shotId: number;
  type: Shot["type"];
  duration: number;
  description: string;
  prompt: string;
  /** Script camera movement description — feeds the i2v motion prompt (see motion-prompt.ts) */
  camera?: string;
  /** Speaking cast character bound to this shot (dialogue styles) — triggers the real-face constraint */
  characterId?: string;
  /** The shot's voiceover line — with characterId present it marks a talking shot for the i2v motion prompt */
  voiceover?: string;
  visualSource: Shot["visualSource"];
  status: "pending" | "generating" | "done" | "failed";
  thumbnailUrl?: string;
  error?: string;
  /** Whether the asset is a video (animated shot / image-to-video) */
  isVideo?: boolean;
  /** Actual type of the persisted asset (e.g. stock_footage = automatically matched free-library footage) */
  assetType?: string;
  assetProvider?: string;
  /**
   * The static keyframe an i2v video was generated FROM (persisted as thumbnailPath). Enables the
   * per-shot fallback loop — re-run just the i2v while keeping the keyframe — and lets a preceding
   * shot chain into this clip's first frame even after the shot has become a video.
   */
  keyframeUrl?: string;
  /** Persisted final-frame reference for continuity after refresh/restart. */
  lastFrameUrl?: string;
  /** Non-sensitive summary of the conditions actually sent for this take. */
  generationPlan?: GenerationControlSummary;
}

/** Video asset file extensions (used to distinguish video vs. static image, determining thumbnail display and the "animate" entry point) */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/** Subset of fields from GET /api/project/[id]/assets response rows that this module cares about */
export interface SavedAssetRow {
  id?: string;
  shotId: number;
  filePath?: string | null;
  status?: string | null;
  type?: string | null;
  provider?: string | null;
  /** Static preview image for video assets (free-library videos populate this column); used as <img> thumbnail to avoid rendering an mp4 as an image */
  thumbnailPath?: string | null;
  selected?: boolean | null;
  createdAt?: Date | string | number | null;
  lastFrameUrl?: string | null;
  generationPlan?: GenerationControlSummary | null;
}

/**
 * Combines "shots of the selected script + persisted assets" into asset-page view rows.
 * - Persisted and ready assets (filePath is an accessible /api/files path) → status "done" with thumbnail;
 * - Product-image shots (product_image) → resolved using the first product image;
 * - All other shots → pending generation.
 * Pure function, shared between initial load and post "auto-fill" refresh to guarantee consistent behavior on both paths.
 */
export function buildAssetRows(
  shots: Shot[],
  savedAssets: SavedAssetRow[],
  productImages: string[],
): AssetItem[] {
  // Index the active persisted take by shotId. Older databases/fixtures without the
  // selected field fall back to the newest row, preserving the previous single-take behavior.
  const savedByShot = new Map<number, SavedAssetRow>();
  for (const a of savedAssets) {
    if (!a || a.selected === false) continue;
    const current = savedByShot.get(a.shotId);
    if (!current || (a.selected === true && current.selected !== true)) {
      savedByShot.set(a.shotId, a);
      continue;
    }
    if (a.selected === current.selected) {
      const nextTime = new Date(a.createdAt ?? 0).getTime();
      const currentTime = new Date(current.createdAt ?? 0).getTime();
      if (nextTime >= currentTime) savedByShot.set(a.shotId, a);
    }
  }
  const firstProduct = productImages[0];

  return shots.map((s) => {
    const saved = savedByShot.get(s.shotId);
    const reference = s.referenceCut ? { referenceCut: s.referenceCut } : {};
    if (saved?.filePath && saved.status === "done") {
      // Video asset: use the static preview image as thumbnail (rendering an mp4 as <img> breaks), and mark isVideo to correctly hide the "animate" entry point
      const isVideo = VIDEO_EXT.test(saved.filePath);
      return {
        ...reference,
        mediaUrl: saved.filePath,
        assetId: saved.id,
        shotId: s.shotId,
        type: s.type,
        duration: s.duration,
        description: s.description,
        prompt: s.prompt ?? "",
        camera: s.camera || undefined,
        characterId: s.characterId || undefined,
        voiceover: s.voiceover || undefined,
        visualSource: s.visualSource,
        status: "done" as const,
        thumbnailUrl: isVideo && saved.thumbnailPath ? saved.thumbnailPath : saved.filePath,
        isVideo: isVideo || undefined,
        assetType: saved.type ?? undefined,
        assetProvider: saved.provider ?? undefined,
        keyframeUrl: isVideo && saved.thumbnailPath ? saved.thumbnailPath : undefined,
        lastFrameUrl: isVideo && saved.lastFrameUrl ? saved.lastFrameUrl : undefined,
        generationPlan: saved.generationPlan ?? undefined,
      };
    }
    return {
      ...reference,
      shotId: s.shotId,
      type: s.type,
      duration: s.duration,
      description: s.description,
      prompt: s.prompt ?? "",
      camera: s.camera || undefined,
      characterId: s.characterId || undefined,
      voiceover: s.voiceover || undefined,
      visualSource: s.visualSource,
      status: s.visualSource === "product_image" ? "done" : saved?.status === "failed" || saved?.status === "generating" ? saved.status : "pending",
      thumbnailUrl: s.referenceCut?.productImage ?? (s.visualSource === "product_image" ? firstProduct : undefined),
    };
  });
}

/**
 * Keyframe chaining: find the next shot's static keyframe so an
 * image-to-video call can pin its last frame to it — the clip then ends by flowing into the next
 * scene, and the composer's hard concat becomes a seamless AI-generated transition.
 * A next shot that is ALREADY a video still chains via its recorded source keyframe (its first
 * frame). Returns undefined when no usable static frame exists.
 */
export function nextChainKeyframe(rows: AssetItem[], shotId: number): string | undefined {
  const idx = rows.findIndex((r) => r.shotId === shotId);
  if (idx < 0 || idx + 1 >= rows.length) return undefined;
  const next = rows[idx + 1];
  if (next.status !== "done") return undefined;
  if (!next.isVideo && next.thumbnailUrl) return next.thumbnailUrl;
  if (next.isVideo && next.keyframeUrl) return next.keyframeUrl;
  return undefined;
}

/**
 * Shot types whose PATH is the content: the demonstration's own ending is the payload, so
 * chaining (which replaces the clip's ending with a transition into the next scene) eats
 * exactly the frames that sell. These types skip keyframe chaining by default; an explicit
 * lastFrame override still wins (transition-driven shots keep chaining).
 */
const CHAIN_SKIP_TYPES = new Set(["demo"]);

/** Whether a shot type participates in keyframe chaining when no explicit choice was made. */
export function chainByDefault(shotType: string | undefined): boolean {
  return !CHAIN_SKIP_TYPES.has(String(shotType ?? ""));
}

/** Number of shots still awaiting an asset (pending) */
export function pendingShotCount(rows: AssetItem[]): number {
  return rows.filter((r) => r.status === "pending").length;
}

/** Number of shots still pending that are not product-image shots (product-image shots should not be overwritten by free-library assets) */
export function pendingNonProductShotCount(rows: AssetItem[]): number {
  return rows.filter((r) => r.status === "pending" && r.visualSource !== "product_image").length;
}

/**
 * Whether to show the "auto-fill with free stock assets" entry point (free-library = keyless Openverse images, zero image-gen key required):
 * - topic (one-liner video without a product) projects: always show — this is their primary render path;
 * - Other projects (including e-commerce): show when **no image-gen model is configured** yet there are still
 *   pending non-product shots — lets users without an AI key still fill hook / social-proof B-roll shots
 *   (product-image shots are unaffected).
 */
export function shouldOfferStockFill(
  rows: AssetItem[],
  contentType: string | undefined,
  hasImageModel: boolean,
): boolean {
  if (rows.length === 0) return false;
  if (contentType === "topic") return true;
  return !hasImageModel && pendingNonProductShotCount(rows) > 0;
}

/**
 * Whether to display a "no default image-gen model configured" warning:
 * Only shown when no model is configured AND there are still AI-generate shots not yet done;
 * suppressed once all AI shots are done — avoids contradicting the "N/N assets ready" message
 * and confusing beginners into thinking something went wrong.
 */
export function needsImageModelWarning(rows: AssetItem[], hasImageModel: boolean): boolean {
  if (hasImageModel) return false;
  return rows.some((r) => r.visualSource === "ai_generate" && r.status !== "done");
}
