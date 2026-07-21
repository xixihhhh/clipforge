/**
 * Contact sheet — one PNG that lets a human or an agent "see" a composed video at a glance:
 * a filmstrip of sampled frames on top and the audio waveform underneath. Complements the
 * automated QC pass (qc.ts) as the eyeball layer: black frames, missing captions, overlay
 * collisions and audio spikes/dead air all show up in a single image an agent can Read.
 *
 * v2 ("smart" mode, default): instead of purely even sampling, frames are picked from real
 * scene changes (the splice points where broken transitions/mismatched clips live), deduped
 * by a minimum time gap, then evenly back-filled. Sampled cut frames get a red outline and
 * every detected cut is marked as a red tick on the waveform timeline, so a reader can tell
 * "this is where clip 2 meets clip 3" without scrubbing the video. An optional review proxy
 * (short side ≤720, burned-in timecode) supports frame-accurate human feedback.
 * FFmpeg-only, no extra dependencies. "even" mode keeps the v1 single-pass behaviour.
 */

import { dirname } from "path";
import { mkdir } from "fs/promises";
import { ffmpegBin, ffprobeBin } from "@/lib/ffmpeg-path";
import { buildDrawtext, resolveChineseFontFile, unshellFilter } from "./composer";

export interface ContactSheetLayout {
  /** number of thumbnails in the strip */
  frames: number;
  /** width of one thumbnail in px */
  thumbWidth: number;
  /** waveform band height in px (0 when the video has no audio) */
  waveHeight: number;
  /** total sheet width = frames × thumbWidth */
  sheetWidth: number;
}

/** Clamp the layout knobs to sane bounds (agents pass arbitrary numbers). */
export function resolveContactSheetLayout(opts: { frames?: number; thumbWidth?: number; waveHeight?: number; hasAudio: boolean }): ContactSheetLayout {
  const frames = Math.min(12, Math.max(4, Math.round(opts.frames ?? 8)));
  const thumbWidth = Math.min(320, Math.max(120, Math.round(opts.thumbWidth ?? 180)));
  const waveHeight = opts.hasAudio ? Math.min(200, Math.max(80, Math.round(opts.waveHeight ?? 120))) : 0;
  return { frames, thumbWidth, waveHeight, sheetWidth: frames * thumbWidth };
}

/**
 * Build the -filter_complex for the v1 even-sampled sheet. Pure and unit-testable.
 * The strip samples `frames` frames evenly across the duration (fps=frames/duration) and tiles
 * them into one row; the waveform is rendered at exactly the strip's width so vstack lines up.
 * Returns the filtergraph and the output stream label to -map.
 */
export function buildContactSheetFilter(layout: ContactSheetLayout, durationSec: number): { filter: string; outLabel: string } {
  // guard: a zero/unknown duration would make fps=Inf; fall back to 1 frame every 2s
  const rate = durationSec > 0 ? layout.frames / durationSec : 0.5;
  // scale to even height (-2) for codec-friendliness; tile pads a short final row with black
  const strip = `[0:v]fps=${rate.toFixed(6)},scale=${layout.thumbWidth}:-2,tile=${layout.frames}x1[strip]`;
  if (layout.waveHeight <= 0) return { filter: strip, outLabel: "strip" };
  const wave = `[0:a]aformat=channel_layouts=mono,showwavespic=s=${layout.sheetWidth}x${layout.waveHeight}:colors=0x4ade80[wave]`;
  return { filter: `${strip};${wave};[strip][wave]vstack=inputs=2[sheet]`, outLabel: "sheet" };
}

/**
 * Parse scene-change timestamps out of ffmpeg's showinfo log (stderr).
 * Used with `select='gt(scene,T)',showinfo` so only frames past the threshold are logged.
 * Pure; tolerant of surrounding log noise — only showinfo frame lines carry pts_time.
 */
export function parseSceneTimes(showinfoLog: string): number[] {
  const times: number[] = [];
  const re = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g;
  for (const m of showinfoLog.matchAll(re)) {
    const t = parseFloat(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

export interface FramePlan {
  /** sampled timestamps, ascending, seconds */
  times: number[];
  /** parallel to times: true when the frame sits on a detected scene cut */
  cuts: boolean[];
}

/**
 * Decide which timestamps the smart strip samples. Pure.
 * Priority: the opening/hook frame first (sells the first 3 seconds), then scene cuts
 * (deduped by a minimum gap and thinned evenly when there are more cuts than slots),
 * then even back-fill for whatever slots remain. Returns fewer than `frames` entries
 * when the video is too short/uniform to fill them — never pads with duplicates.
 */
export function planFrameTimes(opts: { duration: number; frames: number; sceneTimes: number[] }): FramePlan {
  const { duration, frames } = opts;
  if (!(duration > 0) || frames <= 0) return { times: [], cuts: [] };
  const minGap = duration / frames / 2;
  const clampEnd = duration - 0.15;

  // scene cuts: drop near-edge hits, enforce the minimum gap between kept cuts
  const kept: number[] = [];
  for (const t of [...opts.sceneTimes].sort((a, b) => a - b)) {
    if (t < 0.2 || t > clampEnd) continue;
    if (kept.length && t - kept[kept.length - 1] < minGap) continue;
    kept.push(t);
  }
  // more cuts than slots: thin to an evenly-indexed subset so coverage stays spread out
  const cutSlots = Math.max(0, frames - 1);
  const cuts =
    kept.length > cutSlots
      ? Array.from({ length: cutSlots }, (_, i) => kept[Math.round((i * (kept.length - 1)) / Math.max(1, cutSlots - 1))])
      : kept;

  const entries: { t: number; cut: boolean }[] = [{ t: Math.min(0.15, duration / 2), cut: false }];
  for (const t of cuts) entries.push({ t, cut: true });

  // even back-fill: midpoints of an even grid, skipping anything too close to a picked frame
  for (let k = 0; k < frames && entries.length < frames; k++) {
    const t = ((k + 0.5) * duration) / frames;
    if (t > clampEnd) continue;
    if (entries.some((e) => Math.abs(e.t - t) < minGap)) continue;
    entries.push({ t, cut: false });
  }

  entries.sort((a, b) => a.t - b.t);
  const picked = entries.slice(0, frames);
  return {
    times: picked.map((e) => Math.round(e.t * 1000) / 1000),
    cuts: picked.map((e) => e.cut),
  };
}

/**
 * Build the -filter_complex for the smart sheet. Pure.
 * Inputs 0..N-1 are the same video pre-seeked (-ss) to each planned timestamp; when the video
 * has audio one extra un-seeked input follows for the waveform (index N) so the wave covers the
 * full timeline and cut ticks line up. Each thumb gets a timestamp label; sampled cut frames get
 * a red outline; every detected cut becomes a red tick on the waveform.
 * Output is in pre-shell (buildDrawtext) form — pass through unshellFilter before execFile.
 */
export function buildSmartSheetFilter(
  layout: ContactSheetLayout,
  plan: FramePlan,
  opts: { hasAudio: boolean; duration: number; allCuts: number[]; fontFile?: string }
): { filter: string; outLabel: string; audioInputIndex: number | null } {
  const n = plan.times.length;
  const sheetWidth = n * layout.thumbWidth;
  const fontSize = Math.max(14, Math.round(layout.thumbWidth * 0.11));
  const chains: string[] = [];
  for (let i = 0; i < n; i++) {
    const label = buildDrawtext({
      fontFile: opts.fontFile,
      text: `${plan.times[i].toFixed(1)}s`,
      fontSize,
      fontColor: "white",
      box: { color: "black@0.55", borderW: 4 },
      x: "6",
      y: "6",
    });
    // red outline flags "this thumb sits on a splice point" without relying on glyph coverage
    const outline = plan.cuts[i] ? `,drawbox=x=0:y=0:w=iw:h=ih:color=0xf87171@0.9:t=4` : "";
    chains.push(`[${i}:v]trim=end_frame=1,scale=${layout.thumbWidth}:-2,${label}${outline}[f${i}]`);
  }
  const stripIn = Array.from({ length: n }, (_, i) => `[f${i}]`).join("");
  const strip = n > 1 ? `${stripIn}hstack=inputs=${n}[strip]` : `[f0]copy[strip]`;
  if (layout.waveHeight <= 0 || !opts.hasAudio) {
    return { filter: [...chains, strip].join(";"), outLabel: "strip", audioInputIndex: null };
  }
  const audioIdx = n;
  const ticks = opts.allCuts
    .filter((t) => opts.duration > 0 && t > 0 && t < opts.duration)
    .map((t) => `drawbox=x=${Math.round((t / opts.duration) * sheetWidth)}:y=0:w=2:h=${layout.waveHeight}:color=0xf87171@0.9:t=fill`);
  const wave =
    `[${audioIdx}:a]aformat=channel_layouts=mono,showwavespic=s=${sheetWidth}x${layout.waveHeight}:colors=0x4ade80` +
    (ticks.length ? `,${ticks.join(",")}` : "") +
    `[wave]`;
  return {
    filter: [...chains, strip, wave, `[strip][wave]vstack=inputs=2[sheet]`].join(";"),
    outLabel: "sheet",
    audioInputIndex: audioIdx,
  };
}

/** ffprobe duration + audio-stream presence + frame size (falls back to zeros on failure). */
async function probeVideo(videoPath: string): Promise<{ duration: number; hasAudio: boolean; width: number; height: number }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(ffprobeBin(), [
      "-v", "error",
      "-show_entries", "format=duration",
      "-show_entries", "stream=codec_type,width,height",
      "-of", "json",
      videoPath,
    ]);
    const info = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number }[];
    };
    const v = (info.streams ?? []).find((s) => s.codec_type === "video");
    return {
      duration: parseFloat(info.format?.duration ?? "0") || 0,
      hasAudio: (info.streams ?? []).some((s) => s.codec_type === "audio"),
      width: v?.width ?? 0,
      height: v?.height ?? 0,
    };
  } catch {
    return { duration: 0, hasAudio: false, width: 0, height: 0 };
  }
}

/**
 * One decode pass that logs frames whose scene score exceeds the threshold.
 * Returns [] on any failure — smart mode then degrades to even sampling instead of erroring.
 * Default threshold 0.22: hard cuts score high (>0.4); our xfade transitions spread the change
 * across frames so their peak lands lower — 0.22 catches them without firing on Ken Burns motion
 * (validated on real composed output; see the render test notes).
 */
export async function detectSceneTimes(videoPath: string, threshold = 0.22): Promise<number[]> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const th = Math.min(0.6, Math.max(0.1, threshold));
  try {
    // select runs before showinfo, so only above-threshold frames are logged (small stderr)
    const { stderr } = await run(
      ffmpegBin(),
      ["-i", videoPath, "-vf", `select='gt(scene,${th})',showinfo`, "-an", "-f", "null", "-"],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    return parseSceneTimes(stderr ?? "");
  } catch {
    return [];
  }
}

/**
 * Union of authoritative cut times (the composer's timeline sidecar) and detected scene
 * changes: every known cut survives; a detected time only adds a cut when it is not within
 * `tol` seconds of a known one (it is then a real unplanned jump, e.g. inside a source clip).
 * Pure.
 */
export function mergeCutTimes(known: number[], detected: number[], tol = 0.35): number[] {
  const extra = detected.filter((d) => !known.some((k) => Math.abs(d - k) <= tol));
  return [...known, ...extra].sort((a, b) => a - b);
}

export interface ContactSheetResult {
  layout: ContactSheetLayout;
  mode: "even" | "smart";
  /** sampled timestamps (seconds); [] in even mode where sampling is rate-based */
  frameTimes: number[];
  /** all detected scene-cut timestamps (seconds); [] in even mode / when detection found none */
  cuts: number[];
}

/** Render the contact sheet PNG to outPath; returns the layout and sampling plan actually used. */
export async function generateContactSheet(opts: {
  videoPath: string;
  outPath: string;
  frames?: number;
  thumbWidth?: number;
  waveHeight?: number;
  /** "smart" (default): scene-aware sampling + cut markers; "even": v1 uniform sampling */
  mode?: "even" | "smart";
  sceneThreshold?: number;
  /** authoritative splice times (composer timeline sidecar) — merged with scene detection */
  knownCuts?: number[];
}): Promise<ContactSheetResult> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const { duration, hasAudio } = await probeVideo(opts.videoPath);
  const layout = resolveContactSheetLayout({ ...opts, hasAudio });
  await mkdir(dirname(opts.outPath), { recursive: true });

  if ((opts.mode ?? "smart") === "smart" && duration > 0) {
    const detected = await detectSceneTimes(opts.videoPath, opts.sceneThreshold);
    const sceneTimes = mergeCutTimes(opts.knownCuts ?? [], detected);
    const plan = planFrameTimes({ duration, frames: layout.frames, sceneTimes });
    if (plan.times.length > 0) {
      const { filter, outLabel, audioInputIndex } = buildSmartSheetFilter(layout, plan, {
        hasAudio,
        duration,
        allCuts: sceneTimes,
        fontFile: resolveChineseFontFile(),
      });
      const args: string[] = ["-y"];
      for (const t of plan.times) args.push("-ss", t.toFixed(3), "-i", opts.videoPath);
      if (audioInputIndex != null) args.push("-i", opts.videoPath);
      args.push("-filter_complex", unshellFilter(filter), "-map", `[${outLabel}]`, "-frames:v", "1", opts.outPath);
      await run(ffmpegBin(), args);
      return { layout: { ...layout, frames: plan.times.length, sheetWidth: plan.times.length * layout.thumbWidth }, mode: "smart", frameTimes: plan.times, cuts: sceneTimes };
    }
    // no usable plan (e.g. probe raced) — fall through to the even path below
  }

  const { filter, outLabel } = buildContactSheetFilter(layout, duration);
  await run(ffmpegBin(), ["-y", "-i", opts.videoPath, "-filter_complex", filter, "-map", `[${outLabel}]`, "-frames:v", "1", opts.outPath]);
  return { layout, mode: "even", frameTimes: [], cuts: [] };
}

/**
 * Scale argument for the review proxy: short side capped at 720, aspect preserved.
 * Portrait/square scales width, landscape scales height; null when already small enough. Pure.
 */
export function proxyScaleArg(width: number, height: number): string | null {
  if (!(width > 0) || !(height > 0)) return "scale=-2:720";
  if (Math.min(width, height) <= 720) return null;
  return width <= height ? "scale=720:-2" : "scale=-2:720";
}

/**
 * -vf chain for the review proxy: optional downscale + burned-in timecode (top-left, boxed).
 * The timecode uses drawtext expansion (%{pts:hms}) so it is built here in final execFile form —
 * do NOT pass through unshellFilter. Pure.
 */
export function buildProxyFilter(width: number, height: number, fontFile?: string): string {
  const parts: string[] = [];
  const scale = proxyScaleArg(width, height);
  if (scale) parts.push(scale);
  const font = fontFile ? `fontfile='${fontFile.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}':` : "";
  parts.push(`drawtext=${font}text='%{pts\\:hms}':fontsize=28:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=6:x=10:y=10`);
  return parts.join(",");
}

/**
 * Render a lightweight review proxy next to the contact sheet: short side ≤720, veryfast/CRF 27,
 * timecode burned in so human feedback can reference exact moments ("cut at 00:00:12.4 is jarring").
 */
export async function generateReviewProxy(opts: { videoPath: string; outPath: string }): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const { width, height } = await probeVideo(opts.videoPath);
  await mkdir(dirname(opts.outPath), { recursive: true });
  await run(ffmpegBin(), [
    "-y",
    "-i", opts.videoPath,
    "-vf", buildProxyFilter(width, height, resolveChineseFontFile()),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    opts.outPath,
  ]);
}
