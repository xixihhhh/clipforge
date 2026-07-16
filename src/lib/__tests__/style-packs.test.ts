import { describe, it, expect } from "vitest";
import {
  parseStylePack,
  serializeStylePack,
  BUILTIN_STYLE_PACKS,
  STYLE_PACK_FORMAT,
} from "../style-packs";

describe("style packs", () => {
  it("parses a valid pack and keeps whitelisted fields", () => {
    const pack = parseStylePack(
      JSON.stringify({
        format: STYLE_PACK_FORMAT,
        name: "测试配方",
        description: "desc",
        author: "me",
        compose: { captionPreset: "bold", bgm: "upbeat", bgmDuck: true, quality: "hd", aspectRatio: "16:9", ctaText: " 买它 ", productCard: true },
      })
    );
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("测试配方");
    expect(pack!.compose).toEqual({
      captionPreset: "bold",
      bgm: "upbeat",
      bgmDuck: true,
      quality: "hd",
      aspectRatio: "16:9",
      ctaText: "买它",
      productCard: true,
    });
  });

  it("rejects non-packs: bad JSON / wrong format tag / missing name", () => {
    expect(parseStylePack("not json")).toBeNull();
    expect(parseStylePack(JSON.stringify({ name: "x", compose: {} }))).toBeNull();
    expect(parseStylePack(JSON.stringify({ format: "clipforge-style-pack@99", name: "x" }))).toBeNull();
    expect(parseStylePack(JSON.stringify({ format: STYLE_PACK_FORMAT, name: "  " }))).toBeNull();
    expect(parseStylePack("null")).toBeNull();
  });

  it("drops invalid field values instead of failing the whole pack", () => {
    const pack = parseStylePack(
      JSON.stringify({
        format: STYLE_PACK_FORMAT,
        name: "部分坏值",
        compose: { captionPreset: "hormozi", bgm: "metal", quality: "ultra", aspectRatio: "4:3", bgmDuck: "yes", ctaText: "", productCard: 1 },
      })
    );
    expect(pack).not.toBeNull();
    expect(pack!.compose).toEqual({}); // every value was invalid → all dropped, pack still applies as a no-op
  });

  it("ignores unknown fields (forward compatibility) and clamps long strings", () => {
    const pack = parseStylePack(
      JSON.stringify({
        format: STYLE_PACK_FORMAT,
        name: "x".repeat(200),
        futureField: { nested: true },
        compose: { captionPreset: "minimal", futureKnob: 42, ctaText: "y".repeat(200) },
      })
    );
    expect(pack!.name.length).toBe(60);
    expect(pack!.compose.ctaText!.length).toBe(60);
    expect((pack as unknown as Record<string, unknown>).futureField).toBeUndefined();
    expect((pack!.compose as unknown as Record<string, unknown>).futureKnob).toBeUndefined();
  });

  it("serialize → parse roundtrips", () => {
    const json = serializeStylePack({ name: "回环", compose: { captionPreset: "karaoke", bgm: "none" } });
    const back = parseStylePack(json);
    expect(back!.name).toBe("回环");
    expect(back!.compose).toEqual({ captionPreset: "karaoke", bgm: "none" });
  });

  it("every builtin pack validates through the parser unchanged", () => {
    for (const p of BUILTIN_STYLE_PACKS) {
      const back = parseStylePack(JSON.stringify(p));
      expect(back).not.toBeNull();
      expect(back!.name).toBe(p.name);
      expect(back!.compose).toEqual(p.compose);
    }
  });
});
