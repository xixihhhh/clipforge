/**
 * Contact sheet — one PNG that lets a human or an agent "see" a composed video at a glance:
 * a filmstrip of evenly-sampled frames on top and the audio waveform underneath. Complements
 * the automated QC pass (qc.ts) as the eyeball layer: black frames, missing captions, overlay
 * collisions and audio spikes/dead air all show up in a single image an agent can Read.
 * FFmpeg-only (fps → tile for the strip, showwavespic for the wave), no extra dependencies.
 */

import { dirname } from "path";
import { mkdir } from "fs/promises";
import { ffmpegBin, ffprobeBin } from "@/lib/ffmpeg-path";

export interface ContactSheetLayout {
  /** number of evenly-sampled thumbnails in the strip */
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
 * Build the -filter_complex for the sheet. Pure and unit-testable.
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

/** ffprobe duration + audio-stream presence (falls back to 0 / no-audio on failure). */
async function probeVideo(videoPath: string): Promise<{ duration: number; hasAudio: boolean }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(ffprobeBin(), [
      "-v", "error",
      "-show_entries", "format=duration",
      "-show_entries", "stream=codec_type",
      "-of", "json",
      videoPath,
    ]);
    const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
    return {
      duration: parseFloat(info.format?.duration ?? "0") || 0,
      hasAudio: (info.streams ?? []).some((s) => s.codec_type === "audio"),
    };
  } catch {
    return { duration: 0, hasAudio: false };
  }
}

/** Render the contact sheet PNG to outPath; returns the layout actually used. */
export async function generateContactSheet(opts: {
  videoPath: string;
  outPath: string;
  frames?: number;
  thumbWidth?: number;
  waveHeight?: number;
}): Promise<ContactSheetLayout> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const { duration, hasAudio } = await probeVideo(opts.videoPath);
  const layout = resolveContactSheetLayout({ ...opts, hasAudio });
  const { filter, outLabel } = buildContactSheetFilter(layout, duration);
  await mkdir(dirname(opts.outPath), { recursive: true });
  await run(ffmpegBin(), [
    "-y",
    "-i", opts.videoPath,
    "-filter_complex", filter,
    "-map", `[${outLabel}]`,
    "-frames:v", "1",
    opts.outPath,
  ]);
  return layout;
}
