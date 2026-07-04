import { describe, it, expect } from "vitest";
import { buildUserPrompt, buildBatchPrompt } from "@/lib/script-engine/prompts";

// Data flywheel (write side): the commerce prompt must carry the pre-rendered performance hint
// through to the LLM so newly generated scripts lean toward what historically converts.
describe("buildUserPrompt × performanceHint（数据飞轮·回流注入）", () => {
  const base = { productName: "云柔纸巾", category: "home" as const, styleType: "pain_point" as const };

  it("提供 performanceHint 时，原样注入到 prompt 中（在钩子指南之前）", () => {
    const hint = "【历史转化数据反馈（来自你已发布视频的真实成效，务必参考）】\n- 转化最高的脚本风格是「对比测评」";
    const p = buildUserPrompt({ ...base, performanceHint: hint });
    expect(p).toContain("历史转化数据反馈");
    expect(p).toContain("对比测评");
    // must appear before the golden-3-second hook guidance block (so it can bias hook choice)
    expect(p.indexOf("历史转化数据反馈")).toBeLessThan(p.indexOf("黄金3秒钩子"));
  });

  it("未提供 performanceHint（冷启动）时，不出现反馈段落", () => {
    const p = buildUserPrompt(base);
    expect(p).not.toContain("历史转化数据反馈");
  });

  it("空串 performanceHint 视为无数据，不注入", () => {
    const p = buildUserPrompt({ ...base, performanceHint: "" });
    expect(p).not.toContain("历史转化数据反馈");
  });

  it("批量生成 prompt 同样携带反馈（buildBatchPrompt 基于 buildUserPrompt）", () => {
    const hint = "【历史转化数据反馈（来自你已发布视频的真实成效，务必参考）】\n- 转化最高的开场钩子机制是「视觉冲击」";
    const p = buildBatchPrompt({ ...base, performanceHint: hint }, 3);
    expect(p).toContain("历史转化数据反馈");
    expect(p).toContain("视觉冲击");
  });
});
