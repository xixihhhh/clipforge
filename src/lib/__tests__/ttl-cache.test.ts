import { describe, it, expect } from "vitest";
import { TtlCache } from "@/lib/ttl-cache";
import { stockCacheKey } from "@/lib/providers/stock-registry";

describe("TtlCache", () => {
  it("命中已存的键、未存的键返回 undefined", () => {
    const c = new TtlCache<number>(1000, 8);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.get("missing")).toBeUndefined();
  });

  it("超过 TTL 后过期（注入时钟）", () => {
    let t = 0;
    const c = new TtlCache<number>(1000, 8, () => t);
    c.set("a", 1);
    t = 999;
    expect(c.get("a")).toBe(1); // 未过期
    t = 1001;
    expect(c.get("a")).toBeUndefined(); // 过期
  });

  it("超过容量淘汰最久未用（LRU：get 会刷新）", () => {
    const c = new TtlCache<number>(10000, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a 刷新到末尾，b 变最久未用
    c.set("c", 3); // 超容量 2 → 淘汰 b
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });
});

describe("stockCacheKey", () => {
  it("同参数同源 → 同键；不同 query/mediaType/源 → 不同键", () => {
    const k1 = stockCacheKey("beauty serum", { mediaType: "video" }, ["openverse", "wikimedia"]);
    const k2 = stockCacheKey("BEAUTY SERUM ", { mediaType: "video" }, ["wikimedia", "openverse"]); // 大小写/空格/源序无关
    expect(k1).toBe(k2);
    expect(k1).not.toBe(stockCacheKey("beauty serum", { mediaType: "image" }, ["openverse", "wikimedia"]));
    expect(k1).not.toBe(stockCacheKey("other", { mediaType: "video" }, ["openverse", "wikimedia"]));
    expect(k1).not.toBe(stockCacheKey("beauty serum", { mediaType: "video" }, ["openverse"])); // 有 Key 多一个源 → 不同键
  });
});
