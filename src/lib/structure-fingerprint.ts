/**
 * Structure fingerprint — measures how template-alike recent videos are, before the platform does.
 *
 * Why (2026 survey): repetitive structure across an account's uploads now triggers policy-level
 * suppression (YouTube "Inauthentic Content", Douyin duplication downranking); the danger is that
 * each video looks fine alone, and only the SERIES reveals the template. This module fingerprints
 * script structure and reports pairwise similarity across recent projects so the batch/publish flow
 * can warn "your last N videos are one template" while it's still cheap to vary.
 *
 * Pure functions over script rows — no LLM, no network.
 */

export interface FingerprintInput {
  projectId?: string;
  projectName?: string;
  styleType?: string | null;
  shots?: Array<{ duration?: number; type?: string } | null> | null;
}

export interface StructureFingerprint {
  projectId?: string;
  projectName?: string;
  styleType?: string;
  /** first shot's type — a proxy for the opening-hook mechanism */
  hookType?: string;
  shotCount: number;
  avgShotSec: number;
  totalSec: number;
}

export interface SimilarPair {
  a: StructureFingerprint;
  b: StructureFingerprint;
  score: number;
}

export interface HomogeneityReport {
  total: number;
  /** pairs at or above the similarity threshold, most similar first */
  similarPairs: SimilarPair[];
  /** share of all pairs that crossed the threshold (0..1) */
  similarShare: number;
  verdict: "ok" | "warn" | "risk";
  message: { zh: string; en: string };
}

/** pairs at/above this score count as "same template" */
export const SIMILARITY_THRESHOLD = 0.75;

/** Reduce a script row to its structural skeleton. Pure function. */
export function fingerprintOf(input: FingerprintInput): StructureFingerprint {
  const shots = (input.shots ?? []).filter((s): s is { duration?: number; type?: string } => !!s);
  const totalSec = shots.reduce((sum, s) => sum + (typeof s.duration === "number" ? s.duration : 0), 0);
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    styleType: input.styleType ?? undefined,
    hookType: shots[0]?.type,
    shotCount: shots.length,
    avgShotSec: shots.length > 0 ? totalSec / shots.length : 0,
    totalSec,
  };
}

const near = (a: number, b: number, ratio: number) =>
  a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= ratio;

/**
 * Weighted structural similarity (0..1): style 0.35, opening type 0.25, shot count 0.15,
 * average shot length 0.15, total length 0.10 — the dimensions a platform-side template
 * detector (or a bored viewer) keys on.
 */
export function pairSimilarity(a: StructureFingerprint, b: StructureFingerprint): number {
  let score = 0;
  if (a.styleType && b.styleType && a.styleType === b.styleType) score += 0.35;
  if (a.hookType && b.hookType && a.hookType === b.hookType) score += 0.25;
  if (a.shotCount > 0 && a.shotCount === b.shotCount) score += 0.15;
  else if (Math.abs(a.shotCount - b.shotCount) === 1) score += 0.08;
  if (near(a.avgShotSec, b.avgShotSec, 0.15)) score += 0.15;
  if (near(a.totalSec, b.totalSec, 0.1)) score += 0.1;
  return Math.round(score * 100) / 100;
}

/** Pairwise scan → verdict. ok: healthy variety · warn: >25% of pairs template-alike · risk: >50%. */
export function homogeneityReport(items: StructureFingerprint[]): HomogeneityReport {
  const pairs: SimilarPair[] = [];
  let totalPairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      totalPairs++;
      const score = pairSimilarity(items[i], items[j]);
      if (score >= SIMILARITY_THRESHOLD) pairs.push({ a: items[i], b: items[j], score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const similarShare = totalPairs > 0 ? pairs.length / totalPairs : 0;
  const verdict: HomogeneityReport["verdict"] = similarShare > 0.5 ? "risk" : similarShare > 0.25 ? "warn" : "ok";
  const message =
    verdict === "risk"
      ? {
          zh: `最近 ${items.length} 条视频里超过一半结构高度相似——平台会把这识别为模板化搬运并限流，强烈建议开启防同质化变体或手动换结构`,
          en: `Over half of your last ${items.length} videos share one structure — platforms flag this as templated output and suppress reach; enable variation or change the structure`,
        }
      : verdict === "warn"
        ? {
            zh: `最近 ${items.length} 条视频有 ${pairs.length} 对结构相近，建议下一批换钩子/风格/节奏`,
            en: `${pairs.length} pair(s) of your last ${items.length} videos are structurally alike — vary hooks/styles/pacing in the next batch`,
          }
        : {
            zh: `最近 ${items.length} 条视频结构差异健康`,
            en: `Structure variety across your last ${items.length} videos looks healthy`,
          };
  return { total: items.length, similarPairs: pairs, similarShare: Math.round(similarShare * 100) / 100, verdict, message };
}
