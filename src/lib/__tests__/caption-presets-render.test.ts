/**
 * Real-render regression for caption style presets (standard / bold / minimal).
 *
 * String assertions can't prove a preset actually changes the drawn frame (the box could be
 * silently dropped, the ratio misapplied after rounding, etc.), so this renders the same caption
 * through the real compose graph (buildComposeInvocation → real ffmpeg) with each preset and
 * compares objective pixel metrics:
 *   - standard has a translucent box → far more dark pixels in the frame than the box-less presets;
 *   - bold (bigger glyphs, heavier stroke) → more bright "ink" pixels than minimal.
 *
 * Set CAPTION_PRESET_DUMP=/some/dir to additionally write one PNG per preset for eyeballing.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { mkdtemp, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildComposeInvocation, type ComposeConfig } from "@/lib/video-composer/composer";
import { captionPresetOverrides } from "@/lib/caption-presets";

const run = promisify(execFile);

/** Probe for a drawtext-capable ffmpeg (ffmpeg-static 7.x linux builds lack harfbuzz/drawtext). */
async function hasDrawtext(bin: string): Promise<boolean> {
  try {
    const { stdout } = await run(bin, ["-hide_banner", "-filters"], { maxBuffer: 1e7 });
    return String(stdout).includes(" drawtext ");
  } catch {
    return false;
  }
}

async function resolveFfmpeg(): Promise<string | null> {
  try {
    const mod: unknown = await import("ffmpeg-static");
    const p = (mod as { default?: string }).default ?? (mod as unknown as string);
    if (typeof p === "string" && existsSync(p) && (await hasDrawtext(p))) return p;
  } catch {
    /* fall through to system ffmpeg */
  }
  if (await hasDrawtext("ffmpeg")) return "ffmpeg";
  return null;
}

let FF: string | null = null;
let dir = "";
let bg = "";

beforeAll(async () => {
  FF = await resolveFfmpeg();
  if (!FF) return;
  dir = await mkdtemp(join(tmpdir(), "caption-preset-"));
  // solid mid-grey-blue portrait background (Y ≈ 65): dark box pixels and white text both stand out
  bg = join(dir, "bg.png");
  await run(FF, ["-y", "-f", "lavfi", "-i", "color=c=0x334455:s=720x1280", "-frames:v", "1", bg]);
});

/** Render frame 0 of the real compose graph and return {ink, dark} pixel counts. */
async function renderSubtitle(
  overrides: ReturnType<typeof captionPresetOverrides>,
  dumpName?: string
): Promise<{ ink: number; dark: number }> {
  const config: ComposeConfig = {
    projectId: "caption-preset-test",
    clips: [{ type: "image", filePath: bg, duration: 2, transition: "direct_concat", motion: "static" }],
    output: { resolution: "720p", aspectRatio: "9:16" },
    subtitle: {
      texts: [{ text: "限时5折 今天最后一天", startTime: 0, endTime: 2 }],
      position: "bottom",
      ...overrides,
    },
  };
  const inv = buildComposeInvocation(config);
  const filterFile = join(dir, `${dumpName ?? "case"}-${Math.abs(JSON.stringify(overrides).length)}.filter.txt`);
  await writeFile(filterFile, inv.filterComplex, "utf8");
  // outputArgs[0..1] are ["-map", "[vN]"]; swap the encode+file tail for a single raw gray frame on stdout
  const { stdout } = await run(
    FF as string,
    [...inv.inputArgs, "-filter_complex_script", filterFile, inv.outputArgs[0], inv.outputArgs[1], "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 1e8 },
  );
  if (process.env.CAPTION_PRESET_DUMP && dumpName) {
    await mkdir(process.env.CAPTION_PRESET_DUMP, { recursive: true });
    await run(FF as string, [...inv.inputArgs, "-filter_complex_script", filterFile, inv.outputArgs[0], inv.outputArgs[1], "-frames:v", "1", "-y", join(process.env.CAPTION_PRESET_DUMP, `${dumpName}.png`)]);
  }
  let ink = 0; // bright pixels: white caption glyphs
  let dark = 0; // dark pixels: translucent box / black stroke (background Y≈65 counts as neither)
  for (const b of stdout as Buffer) {
    if (b > 200) ink++;
    else if (b < 45) dark++;
  }
  return { ink, dark };
}

describe("字幕预设真渲染（standard/bold/minimal 画面客观差异）", () => {
  it("三预设都真的画出了字，且 box/字号/描边差异反映在像素上", async () => {
    if (!FF) return; // no drawtext-capable ffmpeg: skip gracefully
    const standard = await renderSubtitle(captionPresetOverrides("standard"), "standard");
    const bold = await renderSubtitle(captionPresetOverrides("bold"), "bold");
    const minimal = await renderSubtitle(captionPresetOverrides("minimal"), "minimal");
    // control: identical to standard except the box is disabled — isolates the box's contribution
    const standardNoBox = await renderSubtitle({ ...captionPresetOverrides("standard"), box: false });

    // every preset actually drew text
    for (const m of [standard, bold, minimal]) expect(m.ink).toBeGreaterThan(500);

    // the translucent box darkens a whole caption band beyond what glyph strokes alone produce
    expect(standard.dark).toBeGreaterThan(standardNoBox.dark * 1.5);

    // bold's bigger glyphs put down measurably more ink than minimal's smaller type,
    // and its heavier stroke leaves more dark pixels too
    expect(bold.ink).toBeGreaterThan(minimal.ink * 1.3);
    expect(bold.dark).toBeGreaterThan(minimal.dark * 1.3);
  }, 90000);
});
