import { describe, it, expect } from "vitest";
import { buildPublishPack, buildPublishPrompt, pickTitles } from "@/lib/publish-pack";

describe("pickTitles (varied title hooks)", () => {
  it("3 distinct titles, all contain the name, deterministic per product", () => {
    const t = pickTitles("云柔抽纸", "超柔亲肤", false);
    expect(t).toHaveLength(3);
    expect(new Set(t).size).toBe(3);
    t.forEach((x) => expect(x).toContain("云柔抽纸"));
    expect(pickTitles("云柔抽纸", "超柔亲肤", false)).toEqual(t); // same product → same titles
  });
  it("hooks vary across products (a pool, not one fixed template)", () => {
    const names = ["红", "绿", "蓝", "黄", "紫"];
    const shells = new Set(names.map((n) => pickTitles(n, "", false)[0].split(n).join("·")));
    expect(shells.size).toBeGreaterThan(1); // multiple distinct hook templates in rotation
  });
  it("drops point-requiring templates when no selling point (no dangling separators)", () => {
    pickTitles("测试品", "", false).forEach((x) => {
      expect(x.endsWith("｜")).toBe(false);
      expect(x).not.toContain("｜，");
    });
  });
  it("en: no CJK leakage, contains the name", () => {
    pickTitles("Glow Serum", "hydrating", true).forEach((x) => {
      expect(/[一-鿿]/.test(x)).toBe(false);
      expect(x).toContain("Glow Serum");
    });
  });
});

describe("buildPublishPack（免 Key 发布文案包）", () => {
  it("产出 3 条标题，均含商品名", () => {
    const p = buildPublishPack({ productName: "云柔抽纸", category: "home" });
    expect(p.titles).toHaveLength(3);
    for (const t of p.titles) expect(t).toContain("云柔抽纸");
  });

  it("话题按品类映射、带 # 前缀、去重", () => {
    const p = buildPublishPack({ productName: "精华液", category: "beauty" });
    expect(p.hashtags).toContain("#美妆");
    expect(p.hashtags.every((h) => h.startsWith("#"))).toBe(true);
    expect(new Set(p.hashtags).size).toBe(p.hashtags.length); // no duplicates
    expect(p.hashtags.length).toBeLessThanOrEqual(10);
  });

  it("平台话题追加（抖音→#抖音好物）", () => {
    const p = buildPublishPack({ productName: "x", category: "food", platform: "douyin" });
    expect(p.hashtags).toContain("#抖音好物");
  });

  it("视频号话题追加（域内平台）", () => {
    const p = buildPublishPack({ productName: "拖把", category: "home", platform: "shipinhao" });
    expect(p.hashtags).toContain("#视频号");
  });

  it("海外平台话题追加（Reels / Shorts）", () => {
    const r = buildPublishPack({ productName: "Serum", category: "beauty", platform: "reels", locale: "en" });
    expect(r.hashtags).toContain("#InstagramReels");
    const s = buildPublishPack({ productName: "Serum", category: "beauty", platform: "shorts", locale: "en" });
    expect(s.hashtags).toContain("#YouTubeShorts");
  });

  it("未知品类回退到通用话题", () => {
    const p = buildPublishPack({ productName: "x", category: "不存在的品类" });
    expect(p.hashtags).toContain("#好物推荐");
  });

  it("种草文案含商品名与挂车号召", () => {
    const p = buildPublishPack({ productName: "神奇拖把", category: "home" });
    expect(p.caption).toContain("神奇拖把");
    expect(p.caption).toContain("小黄车");
  });

  it("卖点会被带进标题/文案", () => {
    const p = buildPublishPack({ productName: "面膜", category: "beauty", sellingPoints: "熬夜急救，第二天满血复活" });
    expect(p.titles.join("") + p.caption).toContain("熬夜急救");
  });

  it("空商品名回退占位、不抛错", () => {
    const p = buildPublishPack({});
    expect(p.titles).toHaveLength(3);
    expect(p.titles[0]).toContain("这款好物");
    expect(p.caption.length).toBeGreaterThan(0);
  });

  it("长商品名+卖点不裁断挂车号召（CTA 尾巴保留）", () => {
    const p = buildPublishPack({
      productName: "这是一个名字特别特别长的商品超出限制了",
      category: "beauty",
      sellingPoints: "卖点也写得非常非常非常长超出限制了哦哦哦",
    });
    expect(p.caption).toContain("小黄车带走它～"); // CTA tail must not be cut off entirely
  });

  it("确定性：同输入同输出", () => {
    const a = buildPublishPack({ productName: "耳机", category: "digital", platform: "kuaishou" });
    const b = buildPublishPack({ productName: "耳机", category: "digital", platform: "kuaishou" });
    expect(a).toEqual(b);
  });

  it("标题做长度裁剪（不会过长）", () => {
    const p = buildPublishPack({ productName: "这是一个名字特别特别特别长的商品超出限制了", category: "other" });
    for (const t of p.titles) expect(Array.from(t).length).toBeLessThanOrEqual(22);
  });
});

describe("buildPublishPack 英文 locale（出海，避免英文用户拿到中文文案）", () => {
  it("locale=en 产出英文标题/话题/CTA，正文无中文", () => {
    const p = buildPublishPack({ productName: "Glow Serum", category: "beauty", platform: "tiktok", locale: "en" });
    const all = p.titles.join(" ") + " " + p.hashtags.join(" ") + " " + p.caption;
    expect(/[一-鿿]/.test(all)).toBe(false); // no CJK leakage
    for (const t of p.titles) expect(t).toContain("Glow Serum");
    expect(p.caption).toContain("Glow Serum");
    expect(p.caption.toLowerCase()).toContain("tap the link below");
  });

  it("英文话题按品类映射（beauty→#BeautyTok）、带 #、去重", () => {
    const p = buildPublishPack({ productName: "x", category: "beauty", locale: "en" });
    expect(p.hashtags).toContain("#BeautyTok");
    expect(p.hashtags.every((h) => h.startsWith("#"))).toBe(true);
    expect(new Set(p.hashtags).size).toBe(p.hashtags.length);
  });

  it("英文卖点带进标题/文案", () => {
    const p = buildPublishPack({ productName: "Magic Mop", category: "home", sellingPoints: "cleans in one swipe", locale: "en" });
    expect(p.titles.join(" ") + p.caption).toContain("cleans in one swipe");
  });

  it("不传 locale 仍走中文（向后兼容）", () => {
    expect(buildPublishPack({ productName: "抽纸", category: "home" }).caption).toContain("小黄车");
  });
});

describe("buildPublishPrompt（LLM 发布文案提示词，跟随 locale）", () => {
  it("en：要求英文输出 + 含商品名/平台，不含中文指令", () => {
    const p = buildPublishPrompt({ productName: "Glow Serum", category: "beauty", platform: "tiktok" }, "en");
    expect(p).toContain("ENGLISH");
    expect(p).toContain("Glow Serum");
    expect(p).toContain("tiktok");
    expect(p).not.toContain("商品名称"); // no longer using the Chinese template
  });
  it("zh（默认）：中文带货提示词", () => {
    const p = buildPublishPrompt({ productName: "云柔抽纸", category: "home" });
    expect(p).toContain("商品名称");
    expect(p).toContain("云柔抽纸");
    expect(p).toContain("种草文案");
  });
  it("caption 要求关键词前置（2026 搜索发现度：抖音/TikTok 前几字权重高）", () => {
    expect(buildPublishPrompt({ productName: "Glow Serum", category: "beauty" }, "en")).toContain("first ~30 characters for search discoverability");
    expect(buildPublishPrompt({ productName: "云柔抽纸", category: "home" })).toContain("开头先点出商品核心关键词");
  });
  it("hashtags 要求首个为商品专属/品牌标签（2026 商品词搜索发现）", () => {
    expect(buildPublishPrompt({ productName: "云柔抽纸", category: "home" })).toContain("商品专属");
    expect(buildPublishPrompt({ productName: "Glow Serum", category: "beauty" }, "en")).toContain("product-specific/branded hashtag");
  });
});

describe("buildPublishPack 商品专属话题标签（2026 商品词搜索发现）", () => {
  it("商品名标签排在话题首位、去空格/标点", () => {
    const p = buildPublishPack({ productName: "云柔 加厚抽纸", category: "home" });
    expect(p.hashtags[0]).toBe("#云柔加厚抽纸");
  });
  it("英文商品名标签去空格（Glow Serum→#GlowSerum）", () => {
    const p = buildPublishPack({ productName: "Glow Serum", category: "beauty", locale: "en" });
    expect(p.hashtags[0]).toBe("#GlowSerum");
    expect(p.hashtags[0]).not.toContain(" ");
  });
  it("空商品名不产出空标签(#)、首位回退到品类标签", () => {
    const p = buildPublishPack({ category: "home" });
    expect(p.hashtags).not.toContain("#");
    expect((p.hashtags[0] || "").length).toBeGreaterThan(1);
  });
  it("商品标签是追加而非替换品类标签", () => {
    const p = buildPublishPack({ productName: "精华液", category: "beauty" });
    expect(p.hashtags[0]).toBe("#精华液");
    expect(p.hashtags).toContain("#美妆");
  });
});

describe("buildAiDeclaration / pack aiDeclaration", () => {
  it("双语声明齐全且随 locale 切换", async () => {
    const { buildAiDeclaration, buildPublishPack } = await import("@/lib/publish-pack");
    const zh = buildAiDeclaration("zh");
    expect(zh.notice).toContain("AI 生成");
    expect(zh.line).toBe("本视频含 AI 生成内容");
    const en = buildAiDeclaration("en");
    expect(en.line).toBe("Contains AI-generated content");
    expect(en.notice).toMatch(/C2PA/);
    // pack 内嵌同一声明
    expect(buildPublishPack({ productName: "榨汁杯" }).aiDeclaration.line).toBe(zh.line);
    expect(buildPublishPack({ productName: "juicer", locale: "en" }).aiDeclaration.line).toBe(en.line);
  });
});
