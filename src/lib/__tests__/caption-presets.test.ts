import { describe, it, expect } from "vitest";
import { CAPTION_PRESETS, CAPTION_PRESET_IDS, isCaptionPreset, captionPresetOverrides } from "../caption-presets";
import { buildComposeCommand, type ComposeConfig } from "../video-composer/composer";

describe("caption presets", () => {
  it("validates known ids and rejects everything else", () => {
    for (const id of CAPTION_PRESET_IDS) expect(isCaptionPreset(id)).toBe(true);
    expect(isCaptionPreset("hormozi")).toBe(false);
    expect(isCaptionPreset("")).toBe(false);
    expect(isCaptionPreset(undefined)).toBe(false);
    expect(isCaptionPreset(42)).toBe(false);
  });

  it("standard preset mirrors the composer's historical defaults", () => {
    const o = captionPresetOverrides("standard");
    expect(o).toEqual({ fontSizeRatio: 0.05, color: "white", strokeWidth: 3, box: { color: "black@0.45" } });
  });

  it("bold and minimal disable the background box", () => {
    expect(captionPresetOverrides("bold").box).toBe(false);
    expect(captionPresetOverrides("minimal").box).toBe(false);
    // bold is bigger with a heavier stroke; minimal is smaller with a thinner stroke
    expect(captionPresetOverrides("bold").fontSizeRatio!).toBeGreaterThan(0.05);
    expect(captionPresetOverrides("bold").strokeWidth!).toBeGreaterThan(3);
    expect(captionPresetOverrides("minimal").fontSizeRatio!).toBeLessThan(0.05);
  });

  it("karaoke preset yields no drawtext overrides (route switches to the ASS path)", () => {
    expect(CAPTION_PRESETS.karaoke.karaoke).toBe(true);
    expect(captionPresetOverrides("karaoke")).toEqual({});
  });

  it("unknown/absent ids yield empty overrides so callers can spread unconditionally", () => {
    expect(captionPresetOverrides(undefined)).toEqual({});
    expect(captionPresetOverrides("nope")).toEqual({});
  });
});

describe("composer subtitle box/size options", () => {
  const baseConfig = (subtitle: ComposeConfig["subtitle"]): ComposeConfig => ({
    projectId: "t",
    clips: [{ type: "image", filePath: "/tmp/a.jpg", duration: 3, transition: "direct_concat", motion: "static" }],
    output: { resolution: "720p", aspectRatio: "9:16" },
    subtitle,
  });
  const texts = [{ text: "限时5折", startTime: 0, endTime: 3 }];

  it("keeps the historical box by default (byte-equivalent)", () => {
    const cmd = buildComposeCommand(baseConfig({ texts }));
    expect(cmd).toContain("box=1");
    expect(cmd).toContain("boxcolor=black@0.45");
  });

  it("box:false removes the background box entirely", () => {
    const cmd = buildComposeCommand(baseConfig({ texts, box: false }));
    expect(cmd).not.toContain("box=1");
    expect(cmd).not.toContain("boxcolor");
  });

  it("custom box colour is passed through", () => {
    const cmd = buildComposeCommand(baseConfig({ texts, box: { color: "0x1e1e1e@0.6" } }));
    expect(cmd).toContain("boxcolor=0x1e1e1e@0.6");
  });

  it("fontSizeRatio scales with frame width; explicit fontSize still wins", () => {
    // 720px wide frame: ratio 0.062 → 45px (bold), default 0.05 → 36px
    const bold = buildComposeCommand(baseConfig({ texts, fontSizeRatio: 0.062 }));
    expect(bold).toContain("fontsize=45");
    const explicit = buildComposeCommand(baseConfig({ texts, fontSizeRatio: 0.062, fontSize: 30 }));
    expect(explicit).toContain("fontsize=30");
  });

  it("preset overrides spread into a subtitle config produce the expected drawtext", () => {
    const cmd = buildComposeCommand(baseConfig({ texts, position: "bottom", ...captionPresetOverrides("bold") }));
    expect(cmd).toContain("fontsize=45"); // 720 * 0.062 rounded
    expect(cmd).toContain("borderw=6");
    expect(cmd).not.toContain("box=1");
  });
});
