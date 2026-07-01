import { describe, it, expect } from "vitest";
import { buildShopLink } from "@/lib/shop-link";

describe("buildShopLink（UTM 追踪链接构造）", () => {
  it("追加 utm 参数 + 平台来源", () => {
    const link = buildShopLink("https://shop.example.com/p/123", { platform: "douyin" });
    const u = new URL(link);
    expect(u.searchParams.get("utm_source")).toBe("douyin");
    expect(u.searchParams.get("utm_medium")).toBe("short_video");
    expect(u.searchParams.get("utm_campaign")).toBe("clipforge");
    expect(u.origin + u.pathname).toBe("https://shop.example.com/p/123");
  });

  it("保留已有 query，不覆盖无关参数", () => {
    const link = buildShopLink("https://shop.example.com/p?spm=abc&color=red", { platform: "tiktok" });
    const u = new URL(link);
    expect(u.searchParams.get("spm")).toBe("abc");
    expect(u.searchParams.get("color")).toBe("red");
    expect(u.searchParams.get("utm_source")).toBe("tiktok");
  });

  it("带分销码 → 追加 aff 参数", () => {
    const link = buildShopLink("https://shop.example.com/p", { platform: "kuaishou", affiliateCode: "AF900" });
    expect(new URL(link).searchParams.get("aff")).toBe("AF900");
  });

  it("空 / 非法 / 非 http(s) → 返回空串（调用方可直接跳过）", () => {
    expect(buildShopLink("")).toBe("");
    expect(buildShopLink(null)).toBe("");
    expect(buildShopLink("not a url")).toBe("");
    expect(buildShopLink("javascript:alert(1)")).toBe("");
    expect(buildShopLink("ftp://x/y")).toBe("");
  });

  it("未指定平台 → 不带 utm_source，但仍有 medium/campaign", () => {
    const u = new URL(buildShopLink("https://shop.example.com/p"));
    expect(u.searchParams.has("utm_source")).toBe(false);
    expect(u.searchParams.get("utm_medium")).toBe("short_video");
  });
});
