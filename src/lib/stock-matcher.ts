/**
 * Stock-matching helpers — in service of the goal "produce a video even without a product, and always have footage"
 *
 * broadenQuery: when an English search term returns no results from the stock library,
 * generates a sequence of progressively broader fallback queries until something matches
 * (prevents obscure topics entered by beginners from leaving a shot with no footage at all).
 */

/** Universal fallback queries: every free stock library has plenty of results for these */
const UNIVERSAL_FALLBACKS = ["abstract background", "lifestyle", "nature", "light"];

/**
 * Given an English search query, produces a sequence of fallback queries from specific to broad (original excluded, deduplicated).
 * Example: broadenQuery("quantum entanglement physics")
 *   → ["entanglement physics", "physics", "abstract background", "lifestyle", "nature", "light"]
 * Pure function — easy to unit-test.
 */
export function broadenQuery(query: string): string[] {
  const q = (query || "").trim();
  const words = q.split(/\s+/).filter(Boolean);
  const out: string[] = [];

  if (words.length > 2) out.push(words.slice(-2).join(" ")); // last two words
  if (words.length > 1) out.push(words[words.length - 1]); // last word (typically the main noun)
  out.push(...UNIVERSAL_FALLBACKS);

  const seen = new Set<string>([q.toLowerCase()]);
  return out.filter((t) => {
    const k = t.toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Build a stock search query for a shot: prefers English stockKeywords, falls back to the visual description or voiceover */
export function shotQuery(shot: { stockKeywords?: string[]; description?: string; voiceover?: string }): string {
  if (shot.stockKeywords?.length) return shot.stockKeywords.join(" ");
  return (shot.description || shot.voiceover || "").trim();
}

// ==================== candidate scoring ====================
// Currently only the first search result is used, which often picks the wrong footage or repeats the same image throughout.
// The code below scores multiple candidates by keyword overlap + portrait orientation + cross-shot deduplication to select the best one.
// Pure functions — unit-testable.

type ShotLike = { stockKeywords?: string[]; description?: string; voiceover?: string };

export interface CandidateLike {
  /** Unique identifier, used for cross-shot deduplication */
  id?: string;
  /** Tags provided by the stock asset */
  tags?: string[];
  /** Title or description */
  title?: string;
  orientation?: "portrait" | "landscape" | "square";
  type?: "image" | "video";
  /** Stock provider id (pexels/pixabay/...), part of the same-source continuity key */
  source?: string;
  /** Uploader/photographer name, part of the same-source continuity key */
  author?: string;
}

export interface ScoreOpts {
  /** Prefer portrait (9:16) orientation, default true */
  preferPortrait?: boolean;
  /** Prefer dynamic video B-roll, default false */
  preferVideo?: boolean;
  /** IDs of candidates already used (cross-shot deduplication to avoid the same image repeating) */
  usedIds?: Set<string>;
  /** Author keys (authorKeyOf) already picked by same-entity shots — same-source candidates get a coherence bonus */
  sameSourceAuthors?: Set<string>;
}

const terms = (s: string) =>
  (s || "")
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter(Boolean);

/** Score a single candidate (higher = better fit). Pure function. */
export function scoreCandidate(shot: ShotLike, candidate: CandidateLike, opts: ScoreOpts = {}): number {
  const wantTerms = new Set([...(shot.stockKeywords ?? []), ...terms(shotQuery(shot))].flatMap((t) => terms(t)));
  const candTerms = new Set([...(candidate.tags ?? []), ...terms(candidate.title ?? "")].flatMap((t) => terms(t)));
  let overlap = 0;
  for (const t of candTerms) if (wantTerms.has(t)) overlap++;
  let score = overlap * 10; // keyword match carries the highest weight

  if (opts.preferPortrait !== false) {
    if (candidate.orientation === "portrait") score += 5;
    else if (candidate.orientation === "landscape") score -= 3; // landscape stretched to portrait gets blurry or leaves black bars
  }
  if (opts.preferVideo && candidate.type === "video") score += 4;
  if (candidate.id && opts.usedIds?.has(candidate.id)) score -= 8; // avoid reusing the same asset across the whole video

  // Same-source coherence: below one keyword hit (10) so relevance still wins, above the portrait nudge (5)
  if (opts.sameSourceAuthors?.size) {
    const key = authorKeyOf(candidate);
    if (key && opts.sameSourceAuthors.has(key)) score += 6;
  }

  return score;
}

/** Pick the best candidate from a list (returns undefined when the list is empty). After selecting, the caller can add the winner's id to usedIds for subsequent deduplication. */
export function pickBestCandidate<T extends CandidateLike>(shot: ShotLike, candidates: T[], opts: ScoreOpts = {}): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreCandidate(shot, c, opts);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

// ==================== material continuity (same-source preference) ====================
// Dependency-graph idea applied to stock assembly: shots about the same entity look coherent
// when their footage comes from the same source. In stock libraries the strongest cheap proxy
// for "same source" is same provider + same author — one uploader's clips share location,
// lighting and grading. The fill pipeline schedules same-group shots serially and feeds each
// pick's author key back into scoring, so later shots in the group lean toward that source.
// Complements usedIds dedup: same *asset* is penalized (-8), same *author* is rewarded (+6).

/** Camera/fallback vocabulary that never identifies an entity (would over-connect unrelated shots). */
const NON_ENTITY_TERMS = new Set(
  [
    ...UNIVERSAL_FALLBACKS,
    "closeup close up shot video footage slow motion detail scene view top angle wide macro pan zoom static aerial cinematic",
  ].flatMap((s) => terms(s))
);

/** An entity term must survive the stoplist and be substantial: ≥3 latin chars, or ≥2 CJK chars. */
const isEntityTerm = (t: string) => !NON_ENTITY_TERMS.has(t) && (/[一-鿿]/.test(t) ? t.length >= 2 : t.length >= 3);

/** Entity terms of a shot: its search terms minus generic camera/fallback vocabulary. Exported for tests. */
export function entityTermsOf(shot: ShotLike): Set<string> {
  return new Set(terms(shotQuery(shot)).filter(isEntityTerm));
}

/**
 * Placeholder author names providers emit when the real creator is unknown ("Unknown",
 * "Internet Archive", or the provider's own name) — two authorless items sharing a placeholder
 * are NOT the same source, so these must never form a continuity key.
 * "本地素材" (local uploads) is deliberately NOT a placeholder: the user's material pool genuinely
 * is one source, so same-entity shots leaning toward it is exactly the wanted behavior.
 */
const PLACEHOLDER_AUTHORS = new Set(["unknown", "internet archive"]);

/** Same-source key for continuity scoring: provider + normalized author (null when the author is unknown or a placeholder). */
export function authorKeyOf(c: { source?: unknown; author?: unknown }): string | null {
  const author = typeof c.author === "string" ? c.author.trim().toLowerCase() : "";
  const source = String(c.source ?? "").toLowerCase();
  if (!author || author === source || PLACEHOLDER_AUTHORS.has(author)) return null;
  return `${source}:${author}`;
}

export interface GroupableShot {
  shotId: number;
  stockKeywords?: string[];
  description?: string;
  voiceover?: string;
}

/**
 * Connected components over the "shares ≥1 entity term" relation: shots about the same
 * entity/product end up in one group (singletons included; groups and members keep input order).
 * Callers fill same-group shots serially so earlier picks can bias later ones to the same source.
 */
export function continuityGroups(shots: GroupableShot[]): number[][] {
  // union-find over shot indexes, linked through a term → first-seen-index map
  const parent = shots.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const firstIdxOfTerm = new Map<string, number>();
  shots.forEach((s, i) => {
    for (const t of entityTermsOf(s)) {
      const first = firstIdxOfTerm.get(t);
      if (first === undefined) firstIdxOfTerm.set(t, i);
      else parent[find(i)] = find(first);
    }
  });
  const groups = new Map<number, number[]>();
  shots.forEach((s, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(s.shotId);
    else groups.set(root, [s.shotId]);
  });
  return [...groups.values()];
}
