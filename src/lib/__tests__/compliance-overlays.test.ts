import { describe, it, expect } from "vitest";
import { buildComplianceOverlays } from "@/lib/compliance-overlays";

describe("buildComplianceOverlays", () => {
  it("默认全关 → 空数组", () => {
    expect(buildComplianceOverlays({}, 10)).toEqual([]);
  });

  it("aiDisclosure → 全程顶部「AI 生成」标识", () => {
    const out = buildComplianceOverlays({ aiDisclosure: true }, 12);
    expect(out).toEqual([{ text: "AI 生成 · 广告", style: "title", startTime: 0, endTime: 12 }]);
  });

  it("自定义标识文案", () => {
    expect(buildComplianceOverlays({ aiDisclosure: true, disclosureText: "AI 合成" }, 8)[0].text).toBe("AI 合成");
  });

  it("ctaText → 片尾最后 2.5s 的 highlight CTA", () => {
    const out = buildComplianceOverlays({ ctaText: "👇 点击下方小黄车" }, 10);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "👇 点击下方小黄车", style: "highlight", startTime: 7.5, endTime: 10 });
  });

  it("短视频 CTA 尾时长不会为负（夹取到总时长）", () => {
    const out = buildComplianceOverlays({ ctaText: "买它" }, 1.5);
    expect(out[0].startTime).toBe(0);
    expect(out[0].endTime).toBe(1.5);
  });

  it("两个都开 → 标识(全程) + CTA(片尾) 两条", () => {
    const out = buildComplianceOverlays({ aiDisclosure: true, ctaText: "下单" }, 20);
    expect(out.map((o) => o.style)).toEqual(["title", "highlight"]);
    expect(out[0].endTime).toBe(20);
    expect(out[1].startTime).toBe(17.5);
  });

  it("空 ctaText / 空白 → 不加 CTA", () => {
    expect(buildComplianceOverlays({ ctaText: "   " }, 10)).toEqual([]);
  });
});
