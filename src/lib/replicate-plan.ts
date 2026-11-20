/**
 * Viral-replication planning: parse a reference commerce video, keep its pacing,
 * camera, and framing, then substitute the user's product through ordinal media references.
 *
 * Two replication tiers share this module:
 *  - RHYTHM tier (free, any LLM): scene-cut times from the reference video become a
 *    shot-duration skeleton, injected into script generation as referenceStructure —
 *    the generated script matches the reference's shot count and pacing.
 *  - MODEL tier (Seedance 2.0 reference-to-video): the reference video (≤15s) plus
 *    product images go straight into one multimodal generation call; the prompt uses
 *    the official "video 1 / image 1" ordinal references.
 *
 * Pure functions, no I/O — the analyze route feeds in cut times from detectSceneTimes.
 */

export interface ReplicateShot {
  /** 1-based shot index */
  index: number;
  /** Segment start time in seconds */
  start: number;
  /** Segment duration in seconds (0.1s precision) */
  duration: number;
}

/** Every measured cut survives on the edit timeline, including frame-length inserts. */
export function sourceCutPlan(cuts: number[], duration: number): ReplicateShot[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const inner = [...new Set(cuts.filter((t) => Number.isFinite(t) && t > 0 && t < duration))].sort((a, b) => a - b);
  const boundaries = [0, ...inner, duration];
  return boundaries.slice(0, -1).map((start, index) => ({
    index: index + 1, start, duration: boundaries[index + 1] - start,
  }));
}

/** Segments shorter than this get merged into their predecessor (flash frames, cut jitter). */
const MIN_SHOT_SEC = 1.0;
/** Skeleton cap — scripts beyond ~12 shots degrade (Seedance docs: >10 shots turn chaotic). */
const MAX_SHOTS = 12;
/** Seedance 2.0 reference_videos hard limit: total reference duration ≤ 15s. */
export const REPLICATE_MAX_REF_SEC = 15;

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Turn detected scene-cut timestamps into a shot skeleton:
 * segments = [0, ...cuts, total]; sub-second fragments merge into the previous
 * segment; when over MAX_SHOTS, the shortest segment repeatedly merges into its
 * shorter neighbor until capped. Returns [] when the duration is unusable.
 */
export function shotPlanFromCuts(
  cuts: number[],
  totalDuration: number,
  opts?: { minShotSec?: number; maxShots?: number },
): ReplicateShot[] {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return [];
  const minSec = opts?.minShotSec ?? MIN_SHOT_SEC;
  const maxShots = Math.max(1, opts?.maxShots ?? MAX_SHOTS);

  // clean cut times: inside (0, total), deduped, ascending
  const inner = [...new Set(cuts.filter((t) => Number.isFinite(t) && t > 0 && t < totalDuration))].sort((a, b) => a - b);
  const bounds = [0, ...inner, totalDuration];
  let durations: number[] = [];
  for (let i = 1; i < bounds.length; i++) durations.push(bounds[i] - bounds[i - 1]);

  // merge sub-minimum fragments into the previous segment (the first merges forward)
  const merged: number[] = [];
  for (const d of durations) {
    if (d < minSec && merged.length > 0) merged[merged.length - 1] += d;
    else merged.push(d);
  }
  if (merged.length > 1 && merged[0] < minSec) {
    merged[1] += merged[0];
    merged.shift();
  }
  durations = merged;

  // cap the shot count: repeatedly merge the shortest segment into its shorter neighbor
  while (durations.length > maxShots) {
    let idx = 0;
    for (let i = 1; i < durations.length; i++) if (durations[i] < durations[idx]) idx = i;
    if (idx === 0) {
      durations[1] += durations[0];
      durations.splice(0, 1);
    } else if (idx === durations.length - 1 || durations[idx - 1] <= durations[idx + 1]) {
      durations[idx - 1] += durations[idx];
      durations.splice(idx, 1);
    } else {
      durations[idx + 1] += durations[idx];
      durations.splice(idx, 1);
    }
  }

  let start = 0;
  return durations.map((d, i) => {
    const shot: ReplicateShot = { index: i + 1, start: round1(start), duration: round1(d) };
    start += d;
    return shot;
  });
}

/**
 * The rhythm skeleton as a referenceStructure block for script generation
 * (injected under the existing 【参考爆款结构】 prompt header). Chinese only —
 * the commerce script prompt is Chinese with a language-override for EN products.
 */
export function replicateReferenceStructure(shots: ReplicateShot[], totalDuration: number): string {
  if (shots.length === 0) return "";
  const beats = shots.map((s) => `第${s.index}镜 ${s.duration}s`).join("、");
  return [
    `以下节奏骨架来自一条参考爆款视频的真实镜头切分（共 ${shots.length} 镜、全长约 ${round1(totalDuration)}s）：${beats}。`,
    `请生成相同数量的分镜，每个分镜的 duration 逐一对应上述时长（允许 ±1s 微调），镜头节奏快慢跟随参考：短镜头配紧凑有冲击力的画面与文案，长镜头承载演示或情绪铺垫。`,
    `不要照搬参考内容，只复刻节奏与结构。`,
  ].join("\n");
}

/**
 * Prompt for the model-tier one-shot replication (Seedance reference-to-video):
 * ordinal references per the official syntax — video 1 = the reference clip,
 * image 1..N = product photos. Product fidelity wording mirrors PRODUCT_CONSTRAINT.
 */
export function buildReplicatePrompt(input: { productName: string; sellingPoints?: string; imageCount: number }): string {
  const parts = [
    `参考 视频1 的运镜、节奏、景别与转场，复刻一条同样风格的带货短视频`,
    input.imageCount > 0
      ? `把画面中的商品替换为 图1${input.imageCount > 1 ? `~图${input.imageCount}` : ""} 中的「${input.productName}」，商品的外观、包装、颜色、logo 与文字必须与参考图完全一致，不得扭曲变形`
      : `商品为「${input.productName}」`,
  ];
  const points = input.sellingPoints?.trim();
  if (points) parts.push(`商品卖点：${points.slice(0, 100)}`);
  parts.push("无人声说话，自然环境音与动作音效贴合画面");
  return parts.join("。") + "。";
}

/**
 * Map a configured video model to its reference-to-video sibling. Families with a
 * reference variant on Atlas: Seedance 2.0 (incl. fast/mini), MiniMax H3, Wan 2.7,
 * Kling Video O3. Returns undefined when the model family can't replicate — the UI
 * disables the model-tier button with a hint.
 */
const REFERENCE_FAMILY_PATTERN =
  /^(bytedance\/seedance-2\.0(?:-fast|-mini)?|minimax\/h3|alibaba\/wan-2\.7|kwaivgi\/kling-video-o3-(?:std|pro))\//;

export function referenceModelFor(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const family = modelId.match(REFERENCE_FAMILY_PATTERN)?.[1];
  if (!family) return undefined;
  if (modelId === `${family}/reference-to-video`) return modelId;
  if (/\/(?:text|image)-to-video$/.test(modelId)) return `${family}/reference-to-video`;
  return undefined;
}
