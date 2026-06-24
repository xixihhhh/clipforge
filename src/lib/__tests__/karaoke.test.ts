import { describe, it, expect } from "vitest";
import { toAssTime, assEscapeText, splitKaraokeUnits, buildKaraokeAss } from "@/lib/video-composer/karaoke";

describe("toAssTime", () => {
  it("秒 → H:MM:SS.cc", () => {
    expect(toAssTime(0)).toBe("0:00:00.00");
    expect(toAssTime(1.5)).toBe("0:00:01.50");
    expect(toAssTime(65.25)).toBe("0:01:05.25");
  });
  it("负数夹到 0、厘秒进位不越界", () => {
    expect(toAssTime(-3)).toBe("0:00:00.00");
    expect(toAssTime(2.999)).toBe("0:00:02.99");
  });
});

describe("assEscapeText", () => {
  it("转义 { } \\ 与换行", () => {
    expect(assEscapeText("a{b}c")).toBe("a\\{b\\}c");
    expect(assEscapeText("x\\y")).toBe("x\\\\y");
    expect(assEscapeText("行1\n行2")).toBe("行1\\N行2");
  });
});

describe("splitKaraokeUnits", () => {
  it("CJK 按字切", () => {
    expect(splitKaraokeUnits("立省五折")).toEqual(["立", "省", "五", "折"]);
  });
  it("拉丁按词切（空格并入词尾）", () => {
    expect(splitKaraokeUnits("buy it now")).toEqual(["buy ", "it ", "now"]);
  });
  it("中英混排", () => {
    expect(splitKaraokeUnits("立省50% off")).toEqual(["立", "省", "50% ", "off"]);
  });
  it("空串 → 空数组", () => {
    expect(splitKaraokeUnits("")).toEqual([]);
    expect(splitKaraokeUnits("   ")).toEqual([]);
  });
});

describe("buildKaraokeAss", () => {
  const lines = [{ text: "立省五折闭眼入", startTime: 0, endTime: 3 }];

  it("含 ASS 头/样式/逐字 \\k 事件", () => {
    const ass = buildKaraokeAss(lines);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("Style: K,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:03.00,K,");
    expect(ass).toContain("{\\k"); // 逐字卡拉OK标签
    expect(ass).toContain("立");
  });

  it("一行内各 \\k 之和等于行时长（厘秒）", () => {
    const ass = buildKaraokeAss([{ text: "立省五折闭眼入", startTime: 0, endTime: 3 }]);
    const dialogue = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
    const ks = [...dialogue.matchAll(/\\k(\d+)/g)].map((m) => Number(m[1]));
    expect(ks.length).toBe(7); // 7 个字
    expect(ks.reduce((a, b) => a + b, 0)).toBe(300); // 3s = 300cs
  });

  it("自定义样式生效", () => {
    const ass = buildKaraokeAss(lines, { fontName: "Noto Sans CJK SC", primaryColour: "&H0000FF00" });
    expect(ass).toContain("Noto Sans CJK SC");
    expect(ass).toContain("&H0000FF00");
  });

  it("含数字单位自动强调：放大字号 + 热色 \\1c（价格/折扣突出）", () => {
    const d = buildKaraokeAss([{ text: "立省50%闭眼入", startTime: 0, endTime: 3 }])
      .split("\n")
      .find((l) => l.startsWith("Dialogue:"))!;
    const fsVals = [...d.matchAll(/\\fs(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(fsVals).size).toBeGreaterThan(1); // 强调字号 ≠ 普通字号
    expect(Math.max(...fsVals)).toBeGreaterThan(Math.min(...fsVals)); // 数字被放大
    expect(d).toContain("&H0050FF&"); // 橙红强调色出现
  });

  it("emphasizeNumbers:false 关闭数字强调", () => {
    const d = buildKaraokeAss([{ text: "立省50%", startTime: 0, endTime: 2 }], { emphasizeNumbers: false })
      .split("\n")
      .find((l) => l.startsWith("Dialogue:"))!;
    const fsVals = [...d.matchAll(/\\fs(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(fsVals).size).toBe(1); // 全同字号
    expect(d).not.toContain("&H0050FF&"); // 无强调色
  });

  it("过滤非法行（endTime<=startTime / 空文本）", () => {
    const ass = buildKaraokeAss([
      { text: "好物", startTime: 0, endTime: 2 },
      { text: "", startTime: 2, endTime: 4 },
      { text: "坏行", startTime: 5, endTime: 5 },
    ]);
    expect((ass.match(/Dialogue:/g) || []).length).toBe(1);
  });
});
