import { describe, it, expect } from "vitest";
import { aggregateByStyle, topConvertingStyle, aggregateByHook, topConvertingHook, buildPerformanceHint, type MetricInput } from "@/lib/performance-insights";

const recs: MetricInput[] = [
  { style: "pain_point", views: 10000, likes: 500, comments: 100, shares: 50, orders: 80 },
  { style: "pain_point", views: 20000, likes: 1000, comments: 200, shares: 100, orders: 200 },
  { style: "comparison", views: 10000, likes: 200, comments: 20, shares: 10, orders: 30 },
];

describe("aggregateByStyle", () => {
  it("按风格分组、算 avg/rates，按转化率降序", () => {
    const agg = aggregateByStyle(recs);
    expect(agg.map((i) => i.style)).toEqual(["pain_point", "comparison"]); // pain_point has higher conversion rate, ranked first
    const pp = agg[0];
    expect(pp.samples).toBe(2);
    expect(pp.avgViews).toBe(15000); // (10000+20000)/2
    expect(pp.totalOrders).toBe(280);
    expect(pp.conversionRate).toBeCloseTo(280 / 30000, 6); // orders / views
    expect(pp.engagementRate).toBeCloseTo(1950 / 30000, 6); // (likes + comments + shares) / views
  });

  it("0 播放不除零（rate=0）", () => {
    const agg = aggregateByStyle([{ style: "x", views: 0, orders: 5 }]);
    expect(agg[0].conversionRate).toBe(0);
    expect(agg[0].engagementRate).toBe(0);
    expect(agg[0].avgViews).toBe(0);
  });

  it("空输入 → 空数组", () => {
    expect(aggregateByStyle([])).toEqual([]);
  });

  it("缺省字段按 0 处理，不抛错", () => {
    const agg = aggregateByStyle([{ style: "y", views: 100 }]);
    expect(agg[0].totalOrders).toBe(0);
    expect(agg[0].conversionRate).toBe(0);
  });
});

describe("topConvertingStyle", () => {
  it("达最小样本数才推荐（默认 2）", () => {
    const top = topConvertingStyle(recs); // pain_point has 2 samples
    expect(top?.style).toBe("pain_point");
  });

  it("样本不足 → null（不给误导建议）", () => {
    expect(topConvertingStyle(recs, 3)).toBeNull(); // no style reaches 3 samples
    expect(topConvertingStyle([{ style: "comparison", views: 10000, orders: 30 }], 2)).toBeNull(); // only 1 sample
  });

  it("全 0 转化 → null", () => {
    expect(topConvertingStyle([
      { style: "a", views: 100, orders: 0 },
      { style: "a", views: 200, orders: 0 },
    ])).toBeNull();
  });
});

describe("aggregateByHook / topConvertingHook（钩子 A/B 回流）", () => {
  const recs: MetricInput[] = [
    { style: "x", hookId: "visual_shock", views: 10000, orders: 100 },
    { style: "x", hookId: "visual_shock", views: 10000, orders: 120 },
    { style: "x", hookId: "suspense", views: 10000, orders: 30 },
    { style: "x", views: 10000, orders: 50 }, // no hookId, skipped
  ];

  it("按 hookId 聚合、无 hookId 跳过、转化率降序", () => {
    const agg = aggregateByHook(recs);
    expect(agg.map((i) => i.hookId)).toEqual(["visual_shock", "suspense"]);
    expect(agg[0].samples).toBe(2);
    expect(agg[0].conversionRate).toBeCloseTo(220 / 20000, 6);
  });

  it("topConvertingHook 需够样本", () => {
    expect(topConvertingHook(recs)?.hookId).toBe("visual_shock");
    expect(topConvertingHook(recs, 3)).toBeNull();
  });

  it("style 聚合不受 hookId 影响（向后兼容，4 条同 style 计入）", () => {
    expect(aggregateByStyle(recs)[0].style).toBe("x");
    expect(aggregateByStyle(recs)[0].samples).toBe(4);
  });
});

describe("buildPerformanceHint（数据飞轮·回流指令）", () => {
  it("有 style + hook → 生成含标题的双行指令，套用 label 解析器", () => {
    const topStyle = topConvertingStyle(recs)!;
    const topHook = topConvertingHook([
      { style: "x", hookId: "visual_shock", views: 10000, orders: 100 },
      { style: "x", hookId: "visual_shock", views: 10000, orders: 120 },
    ])!;
    const hint = buildPerformanceHint(topStyle, topHook, {
      styleLabel: (s) => (s === "pain_point" ? "痛点种草" : s),
      hookLabel: (h) => (h === "visual_shock" ? "视觉冲击" : h),
    });
    expect(hint).toContain("历史转化数据反馈");
    expect(hint).toContain("痛点种草");
    expect(hint).toContain("视觉冲击");
    expect(hint.split("\n").length).toBe(3); // header + 2 bullets
  });

  it("冷启动（都为 null）→ 返回空串，调用方不注入任何内容", () => {
    expect(buildPerformanceHint(null, null)).toBe("");
  });

  it("只有 style → 单行；无 label 解析器时回落到原始 key", () => {
    const topStyle = topConvertingStyle(recs)!;
    const hint = buildPerformanceHint(topStyle, null);
    expect(hint).toContain(topStyle.style); // raw key fallback
    expect(hint).not.toContain("开场钩子机制");
  });

  it("转化率以百分比呈现（一位小数）", () => {
    // 220/20000 = 1.1%
    const hint = buildPerformanceHint(
      { style: "s", samples: 2, avgViews: 10000, engagementRate: 0, conversionRate: 220 / 20000, totalOrders: 220 },
      null
    );
    expect(hint).toContain("1.1%");
  });
});
