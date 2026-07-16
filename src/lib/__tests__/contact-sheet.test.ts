import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveContactSheetLayout, buildContactSheetFilter, generateContactSheet } from "../video-composer/contact-sheet";
import { ffmpegBin } from "../ffmpeg-path";

const run = promisify(execFile);

describe("contact sheet layout + filter (pure)", () => {
  it("clamps knobs and derives sheet width", () => {
    expect(resolveContactSheetLayout({ hasAudio: true })).toEqual({ frames: 8, thumbWidth: 180, waveHeight: 120, sheetWidth: 1440 });
    expect(resolveContactSheetLayout({ frames: 100, thumbWidth: 9999, waveHeight: 1, hasAudio: true })).toEqual({ frames: 12, thumbWidth: 320, waveHeight: 80, sheetWidth: 3840 });
    expect(resolveContactSheetLayout({ frames: 1, thumbWidth: 10, hasAudio: false }).frames).toBe(4);
    // no audio → no waveform band
    expect(resolveContactSheetLayout({ hasAudio: false }).waveHeight).toBe(0);
  });

  it("builds a strip+wave vstack graph, and a strip-only graph without audio", () => {
    const layout = resolveContactSheetLayout({ hasAudio: true });
    const withAudio = buildContactSheetFilter(layout, 16);
    expect(withAudio.filter).toContain(`fps=${(8 / 16).toFixed(6)}`);
    expect(withAudio.filter).toContain("tile=8x1");
    expect(withAudio.filter).toContain("showwavespic=s=1440x120");
    expect(withAudio.filter).toContain("vstack=inputs=2[sheet]");
    expect(withAudio.outLabel).toBe("sheet");

    const silent = buildContactSheetFilter(resolveContactSheetLayout({ hasAudio: false }), 16);
    expect(silent.filter).not.toContain("showwavespic");
    expect(silent.outLabel).toBe("strip");
  });

  it("guards a zero/unknown duration (no Infinity fps)", () => {
    const { filter } = buildContactSheetFilter(resolveContactSheetLayout({ hasAudio: false }), 0);
    expect(filter).toContain("fps=0.500000");
    expect(filter).not.toContain("Infinity");
  });
});

describe("contact sheet real render", () => {
  it("renders a PNG whose dimensions match the layout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contact-sheet-"));
    const video = join(dir, "in.mp4");
    // 2s 360x640 solid clip with a 440Hz sine track — small and fast to synthesize
    await run(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=0x336699:s=360x640:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      video,
    ]);
    const out = join(dir, "sheet.png");
    const layout = await generateContactSheet({ videoPath: video, outPath: out, frames: 6, thumbWidth: 160 });
    expect(layout).toEqual({ frames: 6, thumbWidth: 160, waveHeight: 120, sheetWidth: 960 });

    const png = await readFile(out);
    // PNG signature + IHDR width/height (big-endian at offsets 16/20)
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(960);
    // thumb height: 640 × (160/360) ≈ 284 (scale=-2 rounds to even) + 120 waveform
    expect(height).toBe(Math.round((640 * (160 / 360)) / 2) * 2 + 120);
  }, 60000);
});
