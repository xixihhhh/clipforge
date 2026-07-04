/**
 * Performance feedback loop: aggregates manually-entered post-publish metrics into insights
 * that feed back into content generation —
 * shows "which script style sells best" (by style) and "which hook mechanism sells best"
 * (by hookId, paired with hook A/B testing).
 * E-commerce cares most about conversion (orders/views), then engagement (likes+comments+shares/views).
 * Pure functions, unit-testable; DB/UI live in outer layers.
 */

/** Single campaign record (minimal subset of a DB row; only these fields are needed for aggregation) */
export interface MetricInput {
  /** Script style key (pain_point/scene/comparison/story/custom), locked at entry time */
  style: string;
  /** Hook mechanism id (= HookPattern.id), locked at entry time; used for hook A/B feedback, nullable */
  hookId?: string;
  views: number;
  likes?: number;
  comments?: number;
  shares?: number;
  /** Number of orders (conversions) */
  orders?: number;
}

interface GroupStats {
  /** Number of samples (posts published) */
  samples: number;
  avgViews: number;
  /** Engagement rate: (likes + comments + shares) / views, 0..1 */
  engagementRate: number;
  /** Conversion rate: orders / views, 0..1 */
  conversionRate: number;
  totalOrders: number;
}

export interface StyleInsight extends GroupStats {
  style: string;
}

export interface HookInsight extends GroupStats {
  hookId: string;
}

const sum = (rs: MetricInput[], f: (r: MetricInput) => number) => rs.reduce((a, r) => a + (f(r) || 0), 0);

/** Group and aggregate by a given key, sorted by conversion rate descending (e-commerce prioritizes "can it sell"), ties broken by sample count; records with empty key are skipped */
function aggregateBy(
  records: MetricInput[],
  getKey: (r: MetricInput) => string | undefined
): Array<GroupStats & { key: string }> {
  const groups = new Map<string, MetricInput[]>();
  for (const r of records) {
    const k = getKey(r);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: Array<GroupStats & { key: string }> = [];
  for (const [key, rs] of groups) {
    const samples = rs.length;
    const totalViews = sum(rs, (r) => r.views);
    const totalEng = sum(rs, (r) => (r.likes || 0) + (r.comments || 0) + (r.shares || 0));
    const totalOrders = sum(rs, (r) => r.orders || 0);
    out.push({
      key,
      samples,
      avgViews: Math.round(totalViews / samples),
      engagementRate: totalViews > 0 ? totalEng / totalViews : 0,
      conversionRate: totalViews > 0 ? totalOrders / totalViews : 0,
      totalOrders,
    });
  }
  return out.sort((a, b) => b.conversionRate - a.conversionRate || b.samples - a.samples);
}

/** Aggregate by script style */
export function aggregateByStyle(records: MetricInput[]): StyleInsight[] {
  return aggregateBy(records, (r) => r.style).map(({ key, ...rest }) => ({ style: key, ...rest }));
}

/** Aggregate by hook mechanism (hook A/B: which mechanism sells better); records without hookId are excluded */
export function aggregateByHook(records: MetricInput[]): HookInsight[] {
  return aggregateBy(records, (r) => r.hookId).map(({ key, ...rest }) => ({ hookId: key, ...rest }));
}

/** Returns the top-converting style: requires minimum sample count (default 2, to avoid single-post flukes) and conversion rate > 0; returns null when insufficient data to avoid misleading results */
export function topConvertingStyle(records: MetricInput[], minSamples = 2): StyleInsight | null {
  const ranked = aggregateByStyle(records).filter((i) => i.samples >= minSamples && i.conversionRate > 0);
  return ranked[0] ?? null;
}

/** Returns the top-converting hook mechanism (same requirements: sufficient samples and conversion rate > 0) */
export function topConvertingHook(records: MetricInput[], minSamples = 2): HookInsight | null {
  const ranked = aggregateByHook(records).filter((i) => i.samples >= minSamples && i.conversionRate > 0);
  return ranked[0] ?? null;
}

/** Optional display-name resolvers so the feedback hint reads with human labels instead of raw keys */
export interface PerformanceHintLabels {
  /** style key → display name (e.g. pain_point → 痛点种草) */
  styleLabel?: (style: string) => string;
  /** hookId → display name (e.g. visual_shock → 视觉冲击) */
  hookLabel?: (hookId: string) => string;
}

/**
 * The last mile of the data flywheel: turn the top-converting style/hook (from real published-video
 * metrics) into a prompt-injectable Chinese directive so newly generated scripts lean toward what
 * actually sells. Returns "" when there is insufficient data (cold start) — callers inject nothing.
 * Pure function (no DB/label deps beyond the optional resolvers), so it is fully unit-testable.
 */
export function buildPerformanceHint(
  topStyle: StyleInsight | null,
  topHook: HookInsight | null,
  labels: PerformanceHintLabels = {}
): string {
  const styleLabel = labels.styleLabel ?? ((s) => s);
  const hookLabel = labels.hookLabel ?? ((h) => h);
  const asPct = (rate: number) => Math.round(rate * 1000) / 10;
  const lines: string[] = [];
  if (topStyle) {
    lines.push(
      `- 转化最高的脚本风格是「${styleLabel(topStyle.style)}」（近 ${topStyle.samples} 条实测，转化率约 ${asPct(topStyle.conversionRate)}%）——本次优先采用或明显倾斜该风格。`
    );
  }
  if (topHook) {
    lines.push(
      `- 转化最高的开场钩子机制是「${hookLabel(topHook.hookId)}」（近 ${topHook.samples} 条实测，转化率约 ${asPct(topHook.conversionRate)}%）——开场三秒优先采用该机制。`
    );
  }
  if (lines.length === 0) return "";
  return `【历史转化数据反馈（来自你已发布视频的真实成效，务必参考）】\n${lines.join("\n")}`;
}
