import { describe, it, expect } from "vitest";
import { buildCoverVf } from "@/lib/video-composer/cover";

describe("buildCoverVf", () => {
  it("centered big boxed title; reuses the drawtext builder (expansion=none, box, centered)", () => {
    const vf = buildCoverVf({ title: "测试封面", width: 1080 });
    expect(vf).toContain("drawtext=");
    expect(vf).toContain("expansion=none");
    expect(vf).toContain("fontsize=97"); // round(1080 * 0.09)
    expect(vf).toContain("box=1");
    expect(vf).toContain("x=(w-text_w)/2");
    expect(vf).toContain("(h-text_h)/2"); // centered by default
  });
  it("escapes colon/bracket in the title (raw separators would break the filter)", () => {
    const vf = buildCoverVf({ title: "A:B[1]", width: 1080 });
    expect(vf).not.toContain("text='A:B[1]'"); // must be escaped, not raw
  });
  it("position lower/upper change the y expression", () => {
    expect(buildCoverVf({ title: "x", width: 1080, position: "lower" })).toContain("h*0.7");
    expect(buildCoverVf({ title: "x", width: 1080, position: "upper" })).toContain("h*0.12");
  });
});
