/**
 * Cover / thumbnail generation — extract a frame from the composed video and overlay a bold
 * title to produce a click-worthy cover image (thumbnails drive click-through on short-video platforms).
 * Reuses the composer's battle-tested drawtext escaping so the overlay can't break the filtergraph.
 */

import { dirname } from "path";
import { mkdir } from "fs/promises";
import { ffmpegBin, ffprobeBin } from "@/lib/ffmpeg-path";
import { buildDrawtext, wrapCaption, resolveChineseFontFile, unshellFilter } from "./composer";

export interface CoverVfOpts {
  title: string;
  /** frame width in px (used to size the font/box) */
  width: number;
  fontFile?: string;
  /** vertical placement of the title */
  position?: "center" | "lower" | "upper";
}

/**
 * Build the -vf drawtext filter that overlays a big, boxed, centered title.
 * Long titles (common for e-commerce hooks) are wrapped to the frame width and rendered as
 * per-line horizontally-centered boxed drawtexts, stacked as a positioned block — a single
 * drawtext would overflow the frame edges and get clipped at this large cover font size.
 * Pure; reuses wrapCaption + buildDrawtext escaping.
 *
 * generateCover runs ffmpeg shell-free (execFile, with this filter as a raw -vf argv element), so no shell
 * halves buildDrawtext's pre-shell double-backslash escaping (colon → \\:, etc.). unshellFilter applies that
 * halving here to yield the ffmpeg-direct form (\:), otherwise an ASCII colon/bracket/backslash in the title
 * (e.g. "A:B") breaks the filtergraph parse or renders a stray backslash. Chinese titles lack these chars,
 * which is why this went unnoticed.
 */
export function buildCoverVf(o: CoverVfOpts): string {
  const fontSize = Math.round(o.width * 0.09);
  const lines = wrapCaption(o.title, fontSize, o.width).split("\n");
  const lineH = Math.round(fontSize * 1.5);
  const blockH = lines.length * lineH;
  // Block top: center by default; upper/lower anchor the block around ~20% / ~78% of frame height.
  const base =
    o.position === "lower"
      ? `h*0.78-${Math.round(blockH / 2)}`
      : o.position === "upper"
        ? `h*0.2-${Math.round(blockH / 2)}`
        : `(h-${blockH})/2`;
  return unshellFilter(
    lines
      .map((line, i) =>
        buildDrawtext({
          fontFile: o.fontFile,
          text: line || " ",
          fontSize,
          fontColor: "white",
          borderW: Math.max(2, Math.round(o.width * 0.006)),
          box: { color: "black@0.5", borderW: Math.round(o.width * 0.015) },
          x: "(w-text_w)/2",
          y: `${base}+${i * lineH}`,
        }),
      )
      .join(","),
  );
}

/** Probe the video's pixel width via ffprobe (falls back to 1080 on failure). */
async function probeWidth(videoPath: string): Promise<number> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(ffprobeBin(), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width",
      "-of",
      "default=nw=1:nk=1",
      videoPath,
    ]);
    const w = parseInt(String(stdout).trim(), 10);
    return Number.isFinite(w) && w > 0 ? w : 1080;
  } catch {
    return 1080;
  }
}

/** Extract a frame at frameAtSec and overlay the title → a cover PNG written to outPath. */
export async function generateCover(opts: {
  videoPath: string;
  title: string;
  outPath: string;
  frameAtSec?: number;
  position?: CoverVfOpts["position"];
}): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const width = await probeWidth(opts.videoPath);
  const t = Math.max(0, opts.frameAtSec ?? 1);
  const vf = buildCoverVf({ title: opts.title, width, fontFile: resolveChineseFontFile(), position: opts.position });
  await mkdir(dirname(opts.outPath), { recursive: true });
  // -ss before -i seeks fast; -frames:v 1 grabs a single frame; -vf applies the title overlay
  await run(ffmpegBin(), ["-y", "-ss", String(t), "-i", opts.videoPath, "-frames:v", "1", "-vf", vf, opts.outPath]);
}
