import { describe, it, expect } from "vitest";
import {
  broadenQuery,
  shotQuery,
  scoreCandidate,
  pickBestCandidate,
  authorKeyOf,
  entityTermsOf,
  continuityGroups,
} from "@/lib/stock-matcher";

describe("broadenQuery（永远有素材兜底）", () => {
  it("多词：由具体到宽泛，含末两词/末词 + 万能兜底", () => {
    const r = broadenQuery("quantum entanglement physics");
    expect(r[0]).toBe("entanglement physics");
    expect(r[1]).toBe("physics");
    expect(r).toContain("abstract background");
    expect(r).toContain("lifestyle");
    expect(r).toContain("nature");
  });

  it("单词：只剩万能兜底（不含原词）", () => {
    const r = broadenQuery("coffee");
    expect(r).not.toContain("coffee");
    expect(r).toEqual(["abstract background", "lifestyle", "nature", "light"]);
  });

  it("去重且排除与原词相同", () => {
    const r = broadenQuery("nature");
    expect(r).not.toContain("nature"); // original word is excluded
    // remaining fallbacks are still present
    expect(r).toContain("lifestyle");
    expect(new Set(r).size).toBe(r.length); // no duplicates
  });

  it("空串：返回万能兜底", () => {
    expect(broadenQuery("")).toEqual(["abstract background", "lifestyle", "nature", "light"]);
    expect(broadenQuery("   ")).toEqual(["abstract background", "lifestyle", "nature", "light"]);
  });
});

describe("shotQuery（拼分镜检索词）", () => {
  it("优先 stockKeywords（空格连接）", () => {
    expect(shotQuery({ stockKeywords: ["coffee morning", "cafe"], description: "中文描述" })).toBe("coffee morning cafe");
  });
  it("无 stockKeywords 时回退到描述，再回退到配音", () => {
    expect(shotQuery({ description: "客厅茶几" })).toBe("客厅茶几");
    expect(shotQuery({ voiceover: "你还在用" })).toBe("你还在用");
    expect(shotQuery({})).toBe("");
  });
});

describe("scoreCandidate / pickBestCandidate（候选择优）", () => {
  const shot = { stockKeywords: ["tissue", "home", "living room"] };

  it("关键词重合 + 竖屏 比 不相关+横屏 分高", () => {
    const good = { id: "a", tags: ["tissue", "home"], orientation: "portrait" as const };
    const bad = { id: "b", tags: ["car", "city"], orientation: "landscape" as const };
    expect(scoreCandidate(shot, good)).toBeGreaterThan(scoreCandidate(shot, bad));
  });

  it("pickBestCandidate 选最高分", () => {
    const cands = [
      { id: "a", tags: ["car"], orientation: "landscape" as const },
      { id: "b", tags: ["tissue", "home", "living"], orientation: "portrait" as const },
    ];
    expect(pickBestCandidate(shot, cands)?.id).toBe("b");
  });

  it("已用过的候选被去重惩罚", () => {
    const cand = { id: "a", tags: ["tissue"], orientation: "portrait" as const };
    expect(scoreCandidate(shot, cand, { usedIds: new Set(["a"]) })).toBeLessThan(scoreCandidate(shot, cand));
  });

  it("preferVideo 时视频加分", () => {
    const img = { id: "a", tags: ["tissue"], type: "image" as const };
    const vid = { id: "b", tags: ["tissue"], type: "video" as const };
    expect(scoreCandidate(shot, vid, { preferVideo: true })).toBeGreaterThan(scoreCandidate(shot, img, { preferVideo: true }));
  });

  it("空候选 → undefined", () => {
    expect(pickBestCandidate(shot, [])).toBeUndefined();
  });
});

describe("authorKeyOf（同源作者键）", () => {
  it("provider + 归一化作者名（去空格/小写）", () => {
    expect(authorKeyOf({ source: "pexels", author: " Anna Lee " })).toBe("pexels:anna lee");
    expect(authorKeyOf({ source: "Pixabay", author: "BOB" })).toBe("pixabay:bob");
  });
  it("无作者 → null，不参与连贯性", () => {
    expect(authorKeyOf({ source: "local", author: "" })).toBeNull();
    expect(authorKeyOf({ source: "pexels" })).toBeNull();
    expect(authorKeyOf({ source: "pexels", author: "   " })).toBeNull();
  });
  it("占位作者名（Unknown/供应商名）→ null：两个无主素材不是同一来源", () => {
    expect(authorKeyOf({ source: "openverse", author: "Unknown" })).toBeNull();
    expect(authorKeyOf({ source: "pexels", author: "Pexels" })).toBeNull();
    expect(authorKeyOf({ source: "pixabay", author: "Pixabay" })).toBeNull();
    expect(authorKeyOf({ source: "nasa", author: "NASA" })).toBeNull();
    expect(authorKeyOf({ source: "archive", author: "Internet Archive" })).toBeNull();
    // real NASA center IS a valid grouping signal (same center = coherent archival footage)
    expect(authorKeyOf({ source: "nasa", author: "NASA / JSC" })).toBe("nasa:nasa / jsc");
    // the user's local material pool genuinely is one source — valid key by design
    expect(authorKeyOf({ source: "local", author: "本地素材" })).toBe("local:本地素材");
  });
});

describe("entityTermsOf（实体词提取）", () => {
  it("剔除镜头/兜底泛化词，保留实体词", () => {
    const t = entityTermsOf({ stockKeywords: ["tissue paper closeup", "slow motion"] });
    expect(t.has("tissue")).toBe(true);
    expect(t.has("paper")).toBe(true);
    expect(t.has("closeup")).toBe(false);
    expect(t.has("slow")).toBe(false);
    expect(t.has("motion")).toBe(false);
  });
  it("拉丁词须 ≥3 字符，中文须 ≥2 字符", () => {
    const t = entityTermsOf({ description: "an ox 咖啡 茶" });
    expect(t.has("an")).toBe(false);
    expect(t.has("ox")).toBe(false);
    expect(t.has("咖啡")).toBe(true);
    expect(t.has("茶")).toBe(false);
  });
});

describe("continuityGroups（同实体镜头连通分组）", () => {
  it("共享实体词的镜头进同一组，且可传递（A-B 共 tissue，B-C 共 paper → 一组）", () => {
    const groups = continuityGroups([
      { shotId: 1, stockKeywords: ["tissue home"] },
      { shotId: 2, stockKeywords: ["tissue paper"] },
      { shotId: 3, stockKeywords: ["paper texture"] },
      { shotId: 4, stockKeywords: ["city night"] },
    ]);
    expect(groups).toContainEqual([1, 2, 3]);
    expect(groups).toContainEqual([4]);
  });

  it("只共享泛化镜头词（closeup/slow motion）不成组", () => {
    const groups = continuityGroups([
      { shotId: 1, stockKeywords: ["coffee closeup slow motion"] },
      { shotId: 2, stockKeywords: ["ocean closeup slow motion"] },
    ]);
    expect(groups).toContainEqual([1]);
    expect(groups).toContainEqual([2]);
  });

  it("组与组员保持输入顺序，单镜组也返回", () => {
    const groups = continuityGroups([
      { shotId: 10, stockKeywords: ["cat"] },
      { shotId: 20, stockKeywords: ["dog"] },
      { shotId: 30, stockKeywords: ["cat playing"] },
    ]);
    expect(groups).toEqual([[10, 30], [20]]);
  });

  it("空输入 → 空数组", () => {
    expect(continuityGroups([])).toEqual([]);
  });
});

describe("同源连贯加分（sameSourceAuthors）", () => {
  const shot = { stockKeywords: ["tissue"] };

  it("同组已选作者的候选分更高", () => {
    const cand = { id: "a", tags: ["tissue"], source: "pexels", author: "Anna" };
    const base = scoreCandidate(shot, cand);
    const boosted = scoreCandidate(shot, cand, { sameSourceAuthors: new Set(["pexels:anna"]) });
    expect(boosted).toBe(base + 6);
  });

  it("相关性仍然优先：多一个关键词命中（+10）胜过同源加分（+6）", () => {
    const relevant = { id: "a", tags: ["tissue", "home"], source: "pexels", author: "Other" };
    const sameAuthor = { id: "b", tags: ["tissue"], source: "pexels", author: "Anna" };
    const opts = { sameSourceAuthors: new Set(["pexels:anna"]) };
    expect(
      pickBestCandidate({ stockKeywords: ["tissue", "home"] }, [relevant, sameAuthor], opts)?.id
    ).toBe("a");
  });

  it("旗鼓相当时同源胜出；同一素材去重（-8）仍压过同源（+6）", () => {
    const sameAuthor = { id: "a", tags: ["tissue"], source: "pexels", author: "Anna" };
    const other = { id: "b", tags: ["tissue"], source: "pixabay", author: "Bob" };
    const opts = { sameSourceAuthors: new Set(["pexels:anna"]) };
    expect(pickBestCandidate(shot, [other, sameAuthor], opts)?.id).toBe("a");
    // the same-author candidate was already USED → dedup penalty flips the pick
    expect(pickBestCandidate(shot, [other, sameAuthor], { ...opts, usedIds: new Set(["a"]) })?.id).toBe("b");
  });

  it("空集合不加分", () => {
    const cand = { id: "a", tags: ["tissue"], source: "pexels", author: "Anna" };
    expect(scoreCandidate(shot, cand, { sameSourceAuthors: new Set() })).toBe(scoreCandidate(shot, cand));
  });
});
