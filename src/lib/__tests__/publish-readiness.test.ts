import { describe, it, expect } from "vitest";
import { checkPublishReadiness } from "@/lib/publish-readiness";
import type { Shot } from "@/lib/db/schema";

const mk = (o: Partial<Shot>): Shot => ({
  shotId: 1,
  type: "demo",
  duration: 5,
  description: "",
  camera: "",
  visualSource: "ai_generate",
  transition: "direct_concat",
  voiceover: "",
  ...o,
});

const item = (r: ReturnType<typeof checkPublishReadiness>, key: string) => r.items.find((i) => i.key === key);

describe("checkPublishReadiness", () => {
  const good: Shot[] = [
    mk({ shotId: 1, type: "hook", duration: 3, voiceover: "你还在为脸出油发愁吗" }),
    mk({ shotId: 2, type: "product_reveal", duration: 12, voiceover: "这款氨基酸洁面温和不刺激" }),
    mk({ shotId: 3, type: "cta", duration: 6, voiceover: "点下方小黄车带走它" }),
  ];

  it("健康脚本 → ready，无 warn/fail", () => {
    const r = checkPublishReadiness(good, 30, { aigcLabel: true });
    expect(r.overall).toBe("ready");
    expect(r.fail).toBe(0);
    expect(r.warn).toBe(0);
    expect(item(r, "aigc")?.status).toBe("pass");
  });

  it("广告法风险词 → compliance fail → needsWork（含命中词）", () => {
    const r = checkPublishReadiness([mk({ type: "hook", duration: 3, voiceover: "这是最好的面膜全网最低" })], 20);
    expect(item(r, "compliance")?.status).toBe("fail");
    expect(item(r, "compliance")?.message).toContain("最好");
    expect(r.overall).toBe("needsWork");
  });

  it("开场钩子偏长(>4s) → hook warn", () => {
    const r = checkPublishReadiness([mk({ type: "hook", duration: 6, voiceover: "你还在发愁吗" }), ...good.slice(1)], 30);
    expect(item(r, "hook")?.status).toBe("warn");
  });

  it("开场钩子偏平(无疑问/数字/痛点) → hook warn", () => {
    const r = checkPublishReadiness([mk({ type: "hook", duration: 3, voiceover: "今天给大家介绍一款面膜" }), ...good.slice(1)], 30);
    expect(item(r, "hook")?.status).toBe("warn");
  });

  it("钩子含「还在」痛点信号 → hook pass", () => {
    const r = checkPublishReadiness(good, 30);
    expect(item(r, "hook")?.status).toBe("pass");
  });

  it("时长太短/太长 → duration warn", () => {
    expect(item(checkPublishReadiness(good, 10), "duration")?.status).toBe("warn");
    expect(item(checkPublishReadiness(good, 70), "duration")?.status).toBe("warn");
    expect(item(checkPublishReadiness(good, 30), "duration")?.status).toBe("pass");
  });

  it("字幕过密(字/秒超阈值) → caption warn，点名分镜", () => {
    const dense = mk({ shotId: 2, type: "demo", duration: 2, voiceover: "这是一段非常非常长的字幕根本读不完真的真的" });
    const r = checkPublishReadiness([good[0], dense, good[2]], 30);
    expect(item(r, "caption")?.status).toBe("warn");
    expect(item(r, "caption")?.message).toContain("2");
  });

  it("无行动号召 → cta warn", () => {
    const r = checkPublishReadiness([mk({ type: "hook", voiceover: "还在发愁" }), mk({ type: "demo", voiceover: "产品很好用" })], 25);
    expect(item(r, "cta")?.status).toBe("warn");
  });

  it("结构缺段(只有 hook) → structure warn", () => {
    const r = checkPublishReadiness([mk({ type: "hook", voiceover: "还在发愁" })], 25);
    expect(item(r, "structure")?.status).toBe("warn");
  });

  it("AIGC 标签：false→warn，true→pass，未传→不出该项", () => {
    expect(item(checkPublishReadiness(good, 30, { aigcLabel: false }), "aigc")?.status).toBe("warn");
    expect(item(checkPublishReadiness(good, 30, { aigcLabel: true }), "aigc")?.status).toBe("pass");
    expect(item(checkPublishReadiness(good, 30, {}), "aigc")).toBeUndefined();
  });

  it("locale=en → 英文文案", () => {
    const r = checkPublishReadiness([mk({ type: "hook", voiceover: "最好" })], 30, { locale: "en" });
    expect(item(r, "compliance")?.message).toMatch(/ad-law/);
  });

  it("overall 优先级：有 fail 即 needsWork（即便也有 pass）", () => {
    const r = checkPublishReadiness([mk({ type: "hook", duration: 3, voiceover: "最好的产品还在等什么" }), ...good.slice(1)], 30, { aigcLabel: true });
    expect(r.fail).toBeGreaterThan(0);
    expect(r.overall).toBe("needsWork");
  });
});

describe("前3秒露商品硬规则 (productEarly)", () => {
  const name = "氨基酸洁面";
  // story-first template: 3 shots of scene-setting, product only appears at ~11s
  const storyFirst: Shot[] = [
    mk({ shotId: 1, type: "hook", duration: 3, voiceover: "你还在为出油发愁吗" }),
    mk({ shotId: 2, type: "pain_point", duration: 4, voiceover: "每天洗完脸紧绷刺痛" }),
    mk({ shotId: 3, type: "social_proof", duration: 4, voiceover: "换季更是雪上加霜" }),
    mk({ shotId: 4, type: "product_reveal", duration: 8, voiceover: `${name}温和不刺激` }),
    mk({ shotId: 5, type: "cta", duration: 5, voiceover: "点下方小黄车" }),
  ];
  const item = (r: ReturnType<typeof checkPublishReadiness>, key: string) => r.items.find((i) => i.key === key);

  it("未传 productName（主题视频）→ 不出该项", () => {
    expect(item(checkPublishReadiness(storyFirst, 24, {}), "productEarly")).toBeUndefined();
  });

  it("首镜含商品（product_image 素材或提及商品名）→ pass", () => {
    const early = [mk({ shotId: 1, type: "hook", duration: 3, visualSource: "product_image", voiceover: "还在乱选洁面吗" }), ...storyFirst.slice(3)];
    expect(item(checkPublishReadiness(early, 16, { productName: name }), "productEarly")?.status).toBe("pass");
    const mention = [mk({ shotId: 1, type: "hook", duration: 3, voiceover: `${name}凭什么卖爆` }), ...storyFirst.slice(3)];
    expect(item(checkPublishReadiness(mention, 16, { productName: name }), "productEarly")?.status).toBe("pass");
  });

  it("商品 3-7 秒才出现 → warn；晚于 7 秒 → fail 且给出限流理由", () => {
    // 3s hook + 2s scene → product first appears at 5s (the 3s boundary itself passes: a 3s hook then the product is the standard healthy shape)
    const mid = [
      storyFirst[0],
      mk({ shotId: 2, type: "social_proof", duration: 2, voiceover: "换季更难受" }),
      mk({ shotId: 3, type: "product_reveal", duration: 8, voiceover: `${name}好用` }),
      storyFirst[4],
    ];
    expect(item(checkPublishReadiness(mid, 18, { productName: name }), "productEarly")?.status).toBe("warn");
    const late = checkPublishReadiness(storyFirst, 24, { productName: name });
    expect(item(late, "productEarly")?.status).toBe("fail");
    expect(item(late, "productEarly")?.message).toContain("骗完播");
    expect(late.overall).toBe("needsWork");
  });

  it("全程无商品 → fail（never appears 分支），英文文案生效", () => {
    const none: Shot[] = [
      mk({ shotId: 1, type: "hook", duration: 3, voiceover: "还在发愁吗" }),
      mk({ shotId: 2, type: "social_proof", duration: 10, voiceover: "生活就是这样" }),
    ];
    const zh = item(checkPublishReadiness(none, 13, { productName: name }), "productEarly");
    expect(zh?.status).toBe("fail");
    expect(zh?.message).toContain("全程没有明确出现");
    const en = item(checkPublishReadiness(none, 13, { productName: name, locale: "en" }), "productEarly");
    expect(en?.message).toMatch(/never clearly appears/);
  });

  it("textOverlay 提及商品名也算露出", () => {
    const overlay = [
      mk({ shotId: 1, type: "hook", duration: 3, voiceover: "还在乱选吗", textOverlay: { text: `${name}实测`, style: "title" } as Shot["textOverlay"] }),
      ...storyFirst.slice(3),
    ];
    expect(item(checkPublishReadiness(overlay, 16, { productName: name }), "productEarly")?.status).toBe("pass");
  });
});
