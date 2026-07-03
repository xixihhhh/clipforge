import { describe, it, expect } from "vitest";
import { parseRangeHeader } from "@/lib/http-range";

describe("parseRangeHeader（HTTP Range 头解析）", () => {
  const SIZE = 1000;

  it("无 Range 头 → null（整文件 200）", () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull();
    expect(parseRangeHeader(undefined, SIZE)).toBeNull();
    expect(parseRangeHeader("", SIZE)).toBeNull();
  });

  it("bytes=0-99 → 起止闭区间", () => {
    expect(parseRangeHeader("bytes=0-99", SIZE)).toEqual({ start: 0, end: 99 });
  });

  it("开区间 bytes=100- → 到文件末尾", () => {
    expect(parseRangeHeader("bytes=100-", SIZE)).toEqual({ start: 100, end: SIZE - 1 });
  });

  it("后缀 bytes=-500 → 最后 500 字节", () => {
    expect(parseRangeHeader("bytes=-500", SIZE)).toEqual({ start: 500, end: SIZE - 1 });
  });

  it("后缀长度超过文件大小 → start 钳到 0", () => {
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual({ start: 0, end: SIZE - 1 });
  });

  it("start > end → 非法（416）", () => {
    expect(parseRangeHeader("bytes=200-100", SIZE)).toBe("unsatisfiable");
  });

  it("start >= size → 不可满足（416）", () => {
    expect(parseRangeHeader("bytes=1000-", SIZE)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=1500-2000", SIZE)).toBe("unsatisfiable");
  });

  it("end 超过文件大小 → 钳到 size-1", () => {
    expect(parseRangeHeader("bytes=900-9999", SIZE)).toEqual({ start: 900, end: SIZE - 1 });
  });

  it("畸形头 → 非法（416）", () => {
    expect(parseRangeHeader("bytes=-", SIZE)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=abc-def", SIZE)).toBe("unsatisfiable");
    expect(parseRangeHeader("items=0-100", SIZE)).toBe("unsatisfiable");
    // Multi-range is not supported by this parser
    expect(parseRangeHeader("bytes=0-99,200-299", SIZE)).toBe("unsatisfiable");
  });

  it("零字节文件 → 任何范围都不可满足", () => {
    expect(parseRangeHeader("bytes=0-", 0)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=-100", 0)).toBe("unsatisfiable");
  });

  it("后缀 bytes=-0 → 不可满足（416）", () => {
    expect(parseRangeHeader("bytes=-0", SIZE)).toBe("unsatisfiable");
  });
});
