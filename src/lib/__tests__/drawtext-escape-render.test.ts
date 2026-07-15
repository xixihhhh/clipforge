/**
 * Real-render regression for the shell-free overlay composers (cover / carousel / end-card).
 *
 * These composers run ffmpeg via execFile (no shell), passing the filtergraph as a raw argv element.
 * buildDrawtext emits a "pre-shell" escaping (colon → \\:, backslash → \\\\, [ ] → \\[ \\]) that assumes a
 * shell will halve the doubled backslashes; without a shell, unshellFilter must do that halving. If it is
 * missing, an ASCII colon in a title makes ffmpeg fail to parse the filtergraph (blank/errored output), and
 * an ASCII bracket/backslash renders a stray extra backslash. Chinese titles lack these chars, so the bug
 * stayed invisible — hence a real render (not just a "contains escaping" string assertion) here.
 *
 * Strategy: build each filter via the real (fixed) builder, then reconstruct the old buggy pre-shell form by
 * re-doubling its backslashes, render BOTH with a real ffmpeg binary, and compare the drawn frames.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { buildCardVf } from "@/lib/video-composer/carousel";
import { buildCoverVf } from "@/lib/video-composer/cover";
import { buildEndCardFilter } from "@/lib/video-composer/end-card";

const run = promisify(execFile);

/** Inverse of unshellFilter: re-double every backslash to reconstruct the old pre-shell (unhalved) form. */
const reshell = (filter: string): string => filter.replace(/\\/g, "\\\\");

/**
 * Probe whether a candidate ffmpeg binary actually has the drawtext filter compiled in.
 * Binary existence is NOT enough: johnvansickle's Linux static builds of FFmpeg 7.x (shipped by
 * ffmpeg-static on linux-x64) are built without harfbuzz, and FFmpeg >= 7.0 drops drawtext entirely
 * when harfbuzz is absent — so on CI the bundled binary exists but "No such filter: 'drawtext'".
 * The macOS static build does include drawtext, which is why this only bites on Linux.
 */
async function hasDrawtext(bin: string): Promise<boolean> {
  try {
    const { stdout } = await run(bin, ["-hide_banner", "-filters"], { maxBuffer: 1e7 });
    return String(stdout).includes(" drawtext ");
  } catch {
    return false;
  }
}

/** Resolve an ffmpeg binary that supports drawtext: prefer the bundled ffmpeg-static, fall back to a system ffmpeg. */
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
beforeAll(async () => {
  FF = await resolveFfmpeg();
});

const W = 720;
const H = 240;

/**
 * Render a single-input -vf filter onto a black frame and return the count of "inked" (bright) pixels.
 * Throws if ffmpeg fails to parse/execute the filtergraph (the failure mode of the unescaped colon bug).
 */
async function vfInk(vf: string): Promise<number> {
  const { stdout } = await run(
    FF as string,
    ["-y", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}`, "-frames:v", "1", "-vf", vf, "-pix_fmt", "gray", "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 1e8 },
  );
  let n = 0;
  for (const b of stdout as Buffer) if (b > 128) n++;
  return n;
}

/**
 * Assert the old pre-shell form is broken relative to the fixed one. Depending on the ffmpeg version, an
 * unhalved colon either fails to parse (older/8.0: the colon becomes an option separator → hard error) or
 * renders with a stray backslash glyph (extra ink) — both mean the shipped fix changed the drawn output.
 */
async function oldFormBroken(fixedInk: number, buggyFilter: string, inkFn: (f: string) => Promise<number>): Promise<boolean> {
  try {
    const buggyInk = await inkFn(buggyFilter);
    return buggyInk !== fixedInk; // rendered, but differently from the clean fixed frame (stray backslash / garbled)
  } catch {
    return true; // ffmpeg rejected the old pre-shell filtergraph outright
  }
}

/**
 * Same as vfInk but for a two-input -filter_complex that ends in [vout] (the end-card shape). Uses a
 * realistic portrait base (720x1280): the end-card centers the QR vertically in the frame height and places
 * the CTA just above it, so a short/wide canvas would push the CTA off-screen (never drawn) and hide the bug.
 */
async function fcInk(fc: string): Promise<number> {
  const { stdout } = await run(
    FF as string,
    [
      "-y",
      "-f", "lavfi", "-i", `color=c=black:s=${W}x1280`,
      "-f", "lavfi", "-i", `color=c=white:s=120x120`,
      "-filter_complex", fc,
      "-map", "[vout]",
      "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-",
    ],
    { encoding: "buffer", maxBuffer: 1e8 },
  );
  let n = 0;
  for (const b of stdout as Buffer) if (b > 128) n++;
  return n;
}

describe("drawtext 转义真渲染回归（execFile 无 shell 路径：cover/carousel/end-card）", () => {
  const FONT = "/System/Library/Fonts/PingFang.ttc";
  // Only the ASCII path is affected; a font isn't required to draw ASCII, but include one if present for realism.
  const fontFile = existsSync(FONT) ? FONT : undefined;

  it("修复形态输出直连转义（\\:）、不再残留 pre-shell 双反斜杠（\\\\:）", () => {
    const vf = buildCardVf({ text: "A:B[C]", width: 1080, fontFile });
    expect(vf).toContain("\\:"); // ffmpeg-direct colon escape
    expect(vf).not.toContain("\\\\:"); // no leftover pre-shell doubling
    expect(vf).toContain("\\["); // ffmpeg-direct bracket escape
    expect(vf).not.toContain("\\\\["); // cover.ts / end-card.ts share this builder path
  });

  it("carousel：含 ASCII 冒号的标题——修复形态渲染成功，旧 buggy 形态直接解析失败（整帧空白）", async () => {
    if (!FF) return; // no ffmpeg available: skip gracefully
    const vfFixed = buildCardVf({ text: "A:B 限时", width: W, fontFile });
    const inkFixed = await vfInk(vfFixed);
    expect(inkFixed).toBeGreaterThan(0); // text actually drew
    // Old form: re-doubled backslashes → ffmpeg either errors on the colon or draws a stray backslash.
    expect(await oldFormBroken(inkFixed, reshell(vfFixed), vfInk)).toBe(true);
  }, 30000);

  it("carousel：含方括号/反斜杠的标题——旧 buggy 形态会多渲一根反斜杠（墨水更多），修复后消失", async () => {
    if (!FF) return;
    const vfFixed = buildCardVf({ text: "X[Y]\\Z", width: W, fontFile });
    const inkFixed = await vfInk(vfFixed);
    const inkBuggy = await vfInk(reshell(vfFixed));
    expect(inkFixed).toBeGreaterThan(0);
    // The stray backslash glyph in the old form adds ink; the fix removes it.
    expect(inkBuggy).toBeGreaterThan(inkFixed);
  }, 30000);

  it("cover：含 ASCII 冒号+方括号的标题——修复形态渲染成功，旧 buggy 形态失败", async () => {
    if (!FF) return;
    const vfFixed = buildCoverVf({ title: "A:B[1]", width: W, fontFile });
    const inkFixed = await vfInk(vfFixed);
    expect(inkFixed).toBeGreaterThan(0);
    expect(await oldFormBroken(inkFixed, reshell(vfFixed), vfInk)).toBe(true);
  }, 30000);

  it("end-card：CTA 文案含 ASCII 冒号——修复形态渲染成功，旧 buggy 形态失败", async () => {
    if (!FF) return;
    // ASCII CTA (colon + brackets) so the stray-backslash difference is detectable regardless of the ffmpeg
    // build's CJK font support. totalDuration=3 with default seconds=3 → trailing window starts at t=0, so
    // the CTA is visible on frame 0.
    const fcFixed = buildEndCardFilter({ width: W, totalDuration: 3, ctaText: "SCAN:BUY[1]", fontFile });
    const inkFixed = await fcInk(fcFixed);
    expect(inkFixed).toBeGreaterThan(0);
    expect(await oldFormBroken(inkFixed, reshell(fcFixed), fcInk)).toBe(true);
  }, 30000);
});
