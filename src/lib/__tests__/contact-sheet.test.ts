import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveContactSheetLayout,
  buildContactSheetFilter,
  generateContactSheet,
  parseSceneTimes,
  planFrameTimes,
  buildSmartSheetFilter,
  proxyScaleArg,
  buildProxyFilter,
  mergeCutTimes,
} from "../video-composer/contact-sheet";
import { segmentBoundaries } from "../video-composer/timeline";
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
    const res = await generateContactSheet({ videoPath: video, outPath: out, frames: 6, thumbWidth: 160 });
    // uniform clip → no scenes detected, but smart mode still samples hook + even fill
    expect(res.mode).toBe("smart");
    expect(res.cuts).toEqual([]);
    expect(res.frameTimes.length).toBe(res.layout.frames);
    expect(res.layout.thumbWidth).toBe(160);
    expect(res.layout.sheetWidth).toBe(res.layout.frames * 160);

    const png = await readFile(out);
    // PNG signature + IHDR width/height (big-endian at offsets 16/20)
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(res.layout.sheetWidth);
    // thumb height: 640 × (160/360) ≈ 284 (scale=-2 rounds to even) + 120 waveform
    expect(height).toBe(Math.round((640 * (160 / 360)) / 2) * 2 + 120);
  }, 60000);

  it("even mode keeps the v1 single-pass behaviour", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contact-sheet-even-"));
    const video = join(dir, "in.mp4");
    await run(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=0x336699:s=360x640:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      video,
    ]);
    const out = join(dir, "sheet.png");
    const res = await generateContactSheet({ videoPath: video, outPath: out, frames: 4, thumbWidth: 120, mode: "even" });
    expect(res.mode).toBe("even");
    expect(res.frameTimes).toEqual([]);
    const png = await readFile(out);
    expect(png.readUInt32BE(16)).toBe(4 * 120);
  }, 60000);

  it("smart mode marks a real hard cut (two-colour concat) as a cut frame", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contact-sheet-cut-"));
    const video = join(dir, "in.mp4");
    // 4s clip that hard-cuts from black to white at t=2 — scene detection is luma-driven,
    // so equal-luma colour pairs (e.g. blue→red) score near zero and make a broken fixture
    await run(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=black:s=360x640:d=2",
      "-f", "lavfi", "-i", "color=c=white:s=360x640:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      video,
    ]);
    const out = join(dir, "sheet.png");
    const res = await generateContactSheet({ videoPath: video, outPath: out, frames: 6, thumbWidth: 120 });
    expect(res.mode).toBe("smart");
    // the t=2 cut is detected and one sampled frame sits on it
    expect(res.cuts.some((t) => Math.abs(t - 2) < 0.2)).toBe(true);
    expect(res.frameTimes.some((t) => Math.abs(t - 2) < 0.2)).toBe(true);
    const png = await readFile(out);
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.readUInt32BE(16)).toBe(res.layout.frames * 120);
  }, 60000);
});

describe("smart sampling plan (pure)", () => {
  it("parses pts_time out of showinfo stderr, deduped and sorted", () => {
    const log = [
      "[Parsed_showinfo_1 @ 0x600] n:   0 pts:  76800 pts_time:5.2 duration:...",
      "[Parsed_showinfo_1 @ 0x600] n:   1 pts:  99999 pts_time:2.04 duration:...",
      "[Parsed_showinfo_1 @ 0x600] n:   2 pts:  99999 pts_time:2.04 duration:...",
      "frame=  120 fps=0.0 q=-0.0 size=N/A",
    ].join("\n");
    expect(parseSceneTimes(log)).toEqual([2.04, 5.2]);
    expect(parseSceneTimes("")).toEqual([]);
  });

  it("puts the hook frame first and flags scene cuts", () => {
    const plan = planFrameTimes({ duration: 20, frames: 6, sceneTimes: [4, 9.5, 15] });
    expect(plan.times[0]).toBeCloseTo(0.15, 3);
    expect(plan.cuts[0]).toBe(false);
    for (const cut of [4, 9.5, 15]) {
      const i = plan.times.indexOf(cut);
      expect(i).toBeGreaterThan(-1);
      expect(plan.cuts[i]).toBe(true);
    }
    expect(plan.times.length).toBe(6);
    expect([...plan.times].sort((a, b) => a - b)).toEqual(plan.times);
  });

  it("dedupes clustered cuts by minimum gap and drops near-edge hits", () => {
    // duration 12 / frames 6 → minGap 1.0; 5.0 and 5.4 collapse; 0.1 and 11.95 are edge-dropped
    const plan = planFrameTimes({ duration: 12, frames: 6, sceneTimes: [0.1, 5.0, 5.4, 11.95] });
    const cutTimes = plan.times.filter((_, i) => plan.cuts[i]);
    expect(cutTimes).toEqual([5.0]);
  });

  it("thins to an evenly-indexed subset when cuts exceed slots", () => {
    const many = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30s
    const plan = planFrameTimes({ duration: 32, frames: 6, sceneTimes: many });
    expect(plan.times.length).toBe(6);
    // slots minus the hook frame = 5 cut frames, spread across the range
    expect(plan.cuts.filter(Boolean).length).toBe(5);
    const cutTimes = plan.times.filter((_, i) => plan.cuts[i]);
    expect(cutTimes[0]).toBeLessThan(5);
    expect(cutTimes[cutTimes.length - 1]).toBeGreaterThan(25);
  });

  it("returns empty on zero duration (caller falls back to even mode)", () => {
    expect(planFrameTimes({ duration: 0, frames: 8, sceneTimes: [1, 2] })).toEqual({ times: [], cuts: [] });
  });

  it("builds seeked-input chains, red outlines on cut thumbs and waveform ticks", () => {
    const layout = { frames: 3, thumbWidth: 120, waveHeight: 100, sheetWidth: 360 };
    const plan = { times: [0.15, 5, 10], cuts: [false, true, false] };
    const { filter, outLabel, audioInputIndex } = buildSmartSheetFilter(layout, plan, {
      hasAudio: true,
      duration: 20,
      allCuts: [5, 12.5],
    });
    expect(outLabel).toBe("sheet");
    expect(audioInputIndex).toBe(3); // one un-seeked input after the 3 thumbs
    expect(filter).toContain("[3:a]aformat");
    expect(filter).toContain("hstack=inputs=3[strip]");
    // only the middle thumb is a cut → exactly one red outline drawbox on thumbs
    expect(filter.match(/drawbox=x=0:y=0:w=iw/g)?.length).toBe(1);
    // waveform ticks for all detected cuts: x = t/duration × sheetWidth
    expect(filter).toContain(`drawbox=x=${Math.round((5 / 20) * 360)}:y=0:w=2:h=100`);
    expect(filter).toContain(`drawbox=x=${Math.round((12.5 / 20) * 360)}:y=0:w=2:h=100`);
    // timestamp labels ride on each thumb
    expect(filter).toContain("text='0.1s'"); // 0.15.toFixed(1) → "0.1" (binary float rounds down)
    expect(filter).toContain("text='5.0s'");
  });

  it("omits the wave branch and audio input when silent", () => {
    const layout = { frames: 2, thumbWidth: 120, waveHeight: 0, sheetWidth: 240 };
    const { filter, outLabel, audioInputIndex } = buildSmartSheetFilter(layout, { times: [1, 2], cuts: [false, false] }, {
      hasAudio: false,
      duration: 4,
      allCuts: [],
    });
    expect(outLabel).toBe("strip");
    expect(audioInputIndex).toBeNull();
    expect(filter).not.toContain("showwavespic");
  });
});

describe("cut-time merge (pure)", () => {
  it("keeps every known cut and only adds detected times far from them", () => {
    // 3.18 ≈ known 3.2 (within tol) → dropped; 8.1 is a real unplanned jump → kept
    expect(mergeCutTimes([3.2, 6.4], [3.18, 8.1])).toEqual([3.2, 6.4, 8.1]);
    expect(mergeCutTimes([], [1, 2])).toEqual([1, 2]);
    expect(mergeCutTimes([5], [])).toEqual([5]);
  });
});

describe("segment boundaries (pure)", () => {
  it("accumulates plain-concat starts and shifts ffmpeg_fade overlaps like the composer", () => {
    const concat = segmentBoundaries([
      { duration: 3, transition: "direct_concat" },
      { duration: 4, transition: "direct_concat" },
      { duration: 5, transition: "direct_concat" },
    ]);
    expect(concat).toEqual([3, 7]);
    // fade segments overlap the previous one by FADE_DURATION, shifting boundaries forward
    const fade = segmentBoundaries([
      { duration: 3, transition: "ffmpeg_fade" },
      { duration: 4, transition: "ffmpeg_fade" },
      { duration: 5, transition: "ffmpeg_fade" },
    ]);
    expect(fade.length).toBe(2);
    expect(fade[0]).toBeLessThan(3);
    expect(fade[1]).toBeLessThan(7 - 0.5); // two fades of ≥0.25s each shift the second boundary
    expect(segmentBoundaries([{ duration: 10, transition: "direct_concat" }])).toEqual([]);
  });
});

describe("review proxy (pure)", () => {
  it("caps the short side at 720 with aspect-aware scaling", () => {
    expect(proxyScaleArg(1080, 1920)).toBe("scale=720:-2"); // portrait: width is the short side
    expect(proxyScaleArg(1920, 1080)).toBe("scale=-2:720"); // landscape: height is the short side
    expect(proxyScaleArg(720, 1280)).toBeNull(); // already small enough
    expect(proxyScaleArg(0, 0)).toBe("scale=-2:720"); // unknown size: safe default
  });

  it("burns a boxed timecode and skips scaling when unnecessary", () => {
    const f = buildProxyFilter(1080, 1920);
    expect(f).toContain("scale=720:-2,");
    expect(f).toContain("text='%{pts\\:hms}'");
    const small = buildProxyFilter(540, 960);
    expect(small.startsWith("drawtext=")).toBe(true);
  });
});
