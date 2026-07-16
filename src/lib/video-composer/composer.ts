import { join, dirname } from "path";
import { getDataDir } from "@/lib/paths";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { mkdir, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { TRANSITIONS, type TransitionMode } from "./transitions";
import { MOTIONS, DEFAULT_MOTION } from "./motions";
import { safeEncodeParams } from "@/lib/compose-presets";
import { createLimiter } from "@/lib/concurrency";
import { buildAigcMetadataArgs, buildAigcMetadataArgv } from "@/lib/compliance-metadata";
import { CAPTION_SAFE_BOTTOM_RATIO, CAPTION_SAFE_BOTTOM_RATIO_NOCARD } from "./safe-zone";

/**
 * Detect an available Chinese font file path.
 * Without an explicit fontfile, drawtext falls back to a default font that lacks CJK glyphs,
 * causing Chinese subtitles to render as boxes/blanks.
 * Prefers the project's bundled font (deployment-stable), then falls back to common macOS/Linux fonts.
 */
export function resolveChineseFontFile(): string | undefined {
  const candidates = [
    // bundled project font (recommended: place a CJK ttf in public/fonts for consistent deployment)
    join(process.cwd(), "public", "fonts", "subtitle.ttf"),
    join(process.cwd(), "public", "fonts", "subtitle.otf"),
    // common macOS Chinese fonts
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    // common Linux Chinese fonts (server deployment)
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * Escape special characters in FFmpeg drawtext filter values.
 * drawtext uses : as the parameter separator, so special characters in text must be escaped.
 */
function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")  // backslash
    .replace(/'/g, "\u2019")      // replace single quote with right single quote (avoids shell nested-escape issues)
    .replace(/:/g, "\\\\:")       // colon (FFmpeg drawtext parameter separator)
    // do NOT escape %: with expansion=none % is a literal; e-commerce copy frequently contains "save 50%" / "50% off",
    // and converting to \% causes ffmpeg 8.0 to report `Stray %`, silently rendering the entire subtitle/overlay blank.
    .replace(/\[/g, "\\\\[")      // square bracket (FFmpeg filter stream label)
    .replace(/\]/g, "\\\\]");
}

/** Escape a path for the subtitles/ass filter: backslash → forward slash, escape colons (Windows drive letters) and single quotes to avoid breaking the filtergraph */
function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** drawtext filter options (text/fontFile are escaped internally, so new overlays can't miss escaping — an audit once caught a bug caused by using the wrong escaper for font paths) */
export interface DrawtextOpts {
  fontFile?: string;
  text: string;
  fontSize: number;
  fontColor: string;
  borderW?: number;
  lineSpacing?: number;
  box?: { color: string; borderW: number };
  x: string;
  y: string;
  /** full enable expression, e.g. enable='between(t,0,3)' (optional) */
  enable?: string;
}

/**
 * Unified drawtext filter string builder: centralises escaping of text (via escapeDrawText)
 * and font paths (via escapeSubtitlesPath) so no new overlay can accidentally skip escaping.
 * Field order matches the historical order across all overlay sites; optional fields are omitted when absent; byte-equivalent to existing commands.
 */
export function buildDrawtext(o: DrawtextOpts): string {
  const p: string[] = [];
  if (o.fontFile) p.push(`fontfile='${escapeSubtitlesPath(o.fontFile)}'`);
  p.push("expansion=none");
  p.push(`text='${escapeDrawText(o.text)}'`);
  p.push(`fontsize=${o.fontSize}`);
  p.push(`fontcolor=${o.fontColor}`);
  if (o.borderW != null) p.push(`borderw=${o.borderW}`);
  if (o.lineSpacing != null) p.push(`line_spacing=${o.lineSpacing}`);
  if (o.box) {
    p.push("box=1");
    p.push(`boxcolor=${o.box.color}`);
    p.push(`boxborderw=${o.box.borderW}`);
  }
  p.push(`x=${o.x}`);
  p.push(`y=${o.y}`);
  if (o.enable) p.push(o.enable);
  return `drawtext=${p.join(":")}`;
}

/** Infer the ASS Fontname from the detected Chinese font file path (libass resolves by name cross-platform; macOS CoreText usually serves as a fallback) */
export function resolveChineseFontFamily(): string {
  const p = (resolveChineseFontFile() || "").toLowerCase();
  // the bundled CJK subtitle font (public/fonts/subtitle.*) is Noto Sans CJK SC —
  // karaoke uses libass font matching by Fontname, so we must return this internal family name
  // to use the bundled font (otherwise libass looks for system PingFang and Korean glyphs become boxes)
  if (p.includes("fonts/subtitle") || p.includes("fonts\\subtitle")) return "Noto Sans CJK SC";
  if (p.includes("pingfang")) return "PingFang SC";
  if (p.includes("stheiti")) return "STHeiti";
  if (p.includes("hiragino")) return "Hiragino Sans GB";
  if (p.includes("notosanscjk") || p.includes("noto")) return "Noto Sans CJK SC";
  if (p.includes("wqy") || p.includes("zenhei")) return "WenQuanYi Zen Hei";
  if (p.includes("arial unicode")) return "Arial Unicode MS";
  return "PingFang SC";
}

/** Returns true for CJK (Chinese/Japanese/Korean) characters — used to estimate character width and line-breaking strategy */
function isCJK(ch: string): boolean {
  return /[⺀-鿿豈-﫿＀-￯　-〿가-힣]/.test(ch);
}

/**
 * Auto-wrap subtitle text: fold long copy into multiple lines based on frame width
 * (inserts real newlines, which drawtext supports natively).
 * Solves the issue of localised English subtitles overflowing the frame edges
 * (English subtitle strings are far longer than their Chinese equivalents).
 * Width estimation: CJK char ≈ fontSize, Latin char ≈ fontSize×0.55;
 * Latin breaks on word boundaries (no mid-word splits), CJK breaks per character.
 * Pure function for easy unit testing.
 */
export function wrapCaption(text: string, fontSize: number, frameWidth: number): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  const maxWidth = frameWidth * 0.86; // side margins
  const charW = (ch: string) => (isCJK(ch) ? fontSize : fontSize * 0.55);
  const strW = (s: string) => Array.from(s).reduce((w, c) => w + charW(c), 0);

  const lines: string[] = [];
  let line = "";
  const hardBreak = (token: string) => {
    for (const ch of token) {
      if (line && strW(line + ch) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  };
  for (const token of clean.split(" ")) {
    if (strW(token) > maxWidth) {
      // single token exceeds max width (long CJK string or very long word) → hard-break per character
      hardBreak(token);
      continue;
    }
    const cand = line ? `${line} ${token}` : token;
    if (line && strW(cand) > maxWidth) {
      lines.push(line);
      line = token;
    } else {
      line = cand;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * Split a narration sentence into rapid "caption cards" distributed evenly within [startTime, endTime].
 * Rapid short captions are the 2026 standard for muted viewing / e-commerce retention,
 * replacing the pattern of displaying a full sentence statically for an entire shot.
 * Target: ~1.2s per card (max 8 cards); CJK splits per character, Latin splits per word;
 * time is allocated proportionally to card length.
 * Pure function for unit testing; the returned multi-segment subtitles are rendered by the
 * existing composer one segment at a time via drawtext (non-overlapping, one card shown at a time).
 */
export function chunkCaption(
  text: string,
  startTime: number,
  endTime: number
): { text: string; startTime: number; endTime: number }[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const total = Math.max(endTime - startTime, 0.1);
  const n = Math.max(1, Math.min(Math.round(total / 1.2), 8));
  if (n === 1) return [{ text: clean, startTime, endTime }];
  const cjk = /[぀-ヿ一-鿿가-힯]/.test(clean); // kana / CJK / hangul
  const units = cjk ? Array.from(clean) : clean.split(/\s+/);
  if (units.length <= n) return [{ text: clean, startTime, endTime }];
  const per = Math.ceil(units.length / n);
  const chunks: string[] = [];
  for (let i = 0; i < units.length; i += per) chunks.push(units.slice(i, i + per).join(cjk ? "" : " "));
  const lens = chunks.map((c) => Math.max(c.length, 1));
  const sum = lens.reduce((a, b) => a + b, 0);
  let acc = startTime;
  return chunks.map((c, i) => {
    const s = acc;
    acc = i === chunks.length - 1 ? endTime : acc + (lens[i] / sum) * total;
    return { text: c, startTime: Number(s.toFixed(3)), endTime: Number(acc.toFixed(3)) };
  });
}

/**
 * Escape special characters inside a shell double-quoted string.
 * Prevents command injection when file paths contain special characters.
 */
function escapeShellPath(filePath: string): string {
  return filePath.replace(/["$`\\!]/g, "\\$&");
}

// video composition configuration
export interface ComposeConfig {
  projectId: string;
  clips: ClipInput[];
  output: {
    resolution: "720p" | "1080p";
    aspectRatio: "9:16" | "16:9" | "1:1";
    bgmPath?: string;
    bgmVolume?: number; // 0-1
    /** BGM fade-out duration in seconds (default 3, 0 = no fade): prevents a hard cut at the end after aloop fills the full duration */
    bgmFadeOutSec?: number;
    /** BGM intro skip in seconds (opt-in, default 0): skips leading silence/intro; setting too large on a short BGM will wipe it out, so default is 0 */
    bgmIntroSkipSec?: number;
    /** narration ducking (opt-in, default false): sidechaincompress lowers BGM whenever narration plays and restores it during pauses, making narration clearer */
    bgmDuck?: boolean;
    /** x264 encoding preset (render quality preset mapping, default medium); only allowlisted values are accepted */
    videoPreset?: string;
    /** x264 -crf quality (default 18); clamped to a valid range */
    crf?: number;
  };
  subtitle?: {
    texts: { text: string; startTime: number; endTime: number }[];
    fontFamily?: string;
    /** absolute path to a Chinese font file (if omitted, the system Chinese font is auto-detected) */
    fontFile?: string;
    fontSize?: number;
    /** font size as a ratio of frame width (used when fontSize is absent; default 0.05) */
    fontSizeRatio?: number;
    color?: string;
    strokeColor?: string;
    strokeWidth?: number;
    /** background box behind each caption: false = none, or a boxcolor string (default black@0.45) */
    box?: false | { color: string };
    position?: "bottom" | "center" | "top";
    /** karaoke per-character subtitles (opt-in): providing a pre-built ASS file path switches to libass burn-in instead of per-sentence drawtext */
    karaokeAssPath?: string;
  };
  /** text overlays: price tag / selling-point tag / title tag, placed in the upper portion of the frame (common e-commerce style) */
  overlays?: {
    text: string;
    style: "title" | "highlight" | "price";
    startTime: number;
    endTime: number;
  }[];
  /** e-commerce product card overlay (opt-in): bottom-left thumbnail + product name + price, shown for the first few seconds to simulate a "shopping cart link" */
  productCard?: {
    imagePath: string; // local path to product image
    name?: string;
    price?: string; // price text, e.g. "¥39.9"
  };
}

export interface ClipInput {
  type: "video" | "image"; // video clip or static image with motion
  filePath: string;
  duration: number; // seconds
  transition: string; // transition type
  motion?: string; // image type only — camera motion effect
  /** whether this clip contains native audio (model-generated video with built-in voice-over) */
  hasAudio?: boolean;
  /** path to the TTS voice-over audio file for this clip; aligned to clip duration (padded with silence if shorter, trimmed if longer) */
  audioPath?: string;
}

// resolution mapping
const RESOLUTIONS: Record<string, Record<string, { width: number; height: number }>> = {
  "9:16": { "720p": { width: 720, height: 1280 }, "1080p": { width: 1080, height: 1920 } },
  "16:9": { "720p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 } },
  "1:1": { "720p": { width: 720, height: 720 }, "1080p": { width: 1080, height: 1080 } },
};

// segment normalisation filter: standardises every [v{i}] to the same pixel format / square pixels (SAR=1) / 30fps / standard timebase
// so that all inputs to subsequent concat/xfade are completely identical — this is the key to avoiding
// FFmpeg "Error reinitializing filters" crashes when mixing real stock footage from different sources with different pixel formats.
const SEGMENT_NORM = "format=yuv420p,setsar=1,fps=30,settb=AVTB";

/** cross-fade duration in seconds for ffmpeg_fade transitions. video xfade / audio acrossfade / subtitle timeline must all use this same value; otherwise audio, video, and subtitles drift out of sync */
export const FADE_DURATION = 0.5;

/** One ffmpeg `-i` input. loop/t reproduce the `-loop 1 [-t N]` flags used for still images / the product-card image. */
interface InputSpec {
  loop?: boolean;
  t?: number;
  path: string;
}

/** ffmpeg argv tokens for one input — raw path, no shell quoting (shell-free execFile path). */
function inputToArgv(spec: InputSpec): string[] {
  const a: string[] = [];
  if (spec.loop) {
    a.push("-loop", "1");
    if (spec.t != null) a.push("-t", String(spec.t));
  }
  a.push("-i", spec.path);
  return a;
}

/** Shell fragment for one input — path shell-escaped + double-quoted (legacy command-string form). */
function inputToShell(spec: InputSpec): string {
  const flags = spec.loop ? (spec.t != null ? `-loop 1 -t ${spec.t} ` : `-loop 1 `) : "";
  return `${flags}-i "${escapeShellPath(spec.path)}"`;
}

interface ComposeGraph {
  inputs: InputSpec[];
  filterComplex: string; // pre-shell-escaped filtergraph, joined with ";\n"
  videoStream: string;
  audioStream: string; // "" when no clip carries audio
  accumulated: number; // real output duration after xfade overlaps
  outputPath: string;
}

// Assemble the ffmpeg composition graph (inputs / filtergraph / stream labels / duration) once;
// buildComposeCommand renders it as a shell string (tests/debug) and buildComposeInvocation renders it
// as shell-free argv + a -filter_complex_script payload (actual execution).
function assembleComposeGraph(config: ComposeConfig): ComposeGraph {
  // empty clips would cause the subsequent -map "[v0]" to reference a stream that was never created, producing a cryptic ffmpeg error; fail early with a readable message instead
  if (!config.clips || config.clips.length === 0) {
    throw new Error("没有可合成的片段（clips 为空）——请先为分镜配好画面素材再合成");
  }
  const { width, height } = RESOLUTIONS[config.output.aspectRatio][config.output.resolution];
  const outputDir = join(getDataDir(), "output", config.projectId);
  const outputPath = join(outputDir, `final_${Date.now()}.mp4`);

  const inputs: InputSpec[] = [];
  const filterParts: string[] = [];

  // check whether any clip carries audio (native audio or TTS voice-over)
  const hasAnyAudio = config.clips.some(
    (c) => (c.hasAudio && c.type === "video") || c.audioPath
  );

  // process each clip
  config.clips.forEach((clip, i) => {
    if (clip.type === "image") {
      // product image + motion effect. falls back to default motion when the motion key is invalid; never skips the clip
      // (otherwise the inputs/filter count would mismatch the [v${i}] references in the concat below, crashing ffmpeg)
      const motion = (clip.motion && MOTIONS[clip.motion]) || MOTIONS[DEFAULT_MOTION];
      inputs.push({ loop: true, t: clip.duration, path: clip.filePath });
      // key: zoompan outputs d frames per input frame. -loop produces many input frames which causes frame count explosion
      // and stretches the video tens of times longer than intended; use trim to grab only the first frame, then let
      // zoompan's d=duration*fps control total output frame count.
      // trailing SEGMENT_NORM normalises pixel format/SAR/fps/timebase: real images from free stock libraries have
      // varying pixel formats (yuvj420p/yuv420p/yuvj444p…); without normalisation concat/xfade throws
      // "Error reinitializing filters" and composition fails.
      // zoompan's integer-rounded d=duration*fps may be 1–2 frames shorter than clip.duration; accumulated across
      // multiple image clips the video ends up shorter than audio/subtitles (drift). Use tpad to clone the last
      // frame to reach exactly clip.duration — consistent with how video clips are handled.
      filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,trim=end_frame=1,setpts=PTS-STARTPTS,${motion.getFilter(width, height, clip.duration)},tpad=stop_mode=clone:stop_duration=${clip.duration},trim=duration=${clip.duration},setpts=PTS-STARTPTS,${SEGMENT_NORM}[v${i}]`);
    } else {
      // video clip: scale to fill + align to shot duration. real stock library videos (Wikimedia etc.) vary in length;
      // clips shorter than the shot duration would leave a black tail and cause audio/subtitle desync if only trimmed —
      // use tpad to clone the last frame up to the target duration, then trim, so each video clip is always exactly clip.duration.
      inputs.push({ path: clip.filePath });
      filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,tpad=stop_mode=clone:stop_duration=${clip.duration},trim=duration=${clip.duration},setpts=PTS-STARTPTS,${SEGMENT_NORM}[v${i}]`);
    }
  });

  // audio handling: TTS voice-over > native video audio > silence; each segment is aligned to clip duration for audio/video sync
  const audioParts: string[] = [];
  if (hasAnyAudio) {
    config.clips.forEach((clip, i) => {
      if (clip.audioPath) {
        // TTS voice-over: added as an extra input, padded with silence / trimmed to clip duration
        const ai = inputs.length;
        inputs.push({ path: clip.audioPath });
        audioParts.push(
          `[${ai}:a]aresample=44100,apad,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`
        );
      } else if (clip.hasAudio && clip.type === "video") {
        // extract the clip's native audio track (model-generated voice/sfx), padded or trimmed to shot duration
        audioParts.push(`[${i}:a]aresample=44100,apad,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        // generate a silent track of the same duration (using a lavfi virtual input)
        audioParts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`);
      }
    });
  }

  // stitch video transitions
  // key: xfade's offset must be relative to the length of the already-accumulated stream, not the previous clip's duration.
  // otherwise xfade #3 and beyond would start fading in from a much earlier point, chopping out all previously joined footage
  // (symptom: final video is inexplicably much shorter than expected). use `accumulated` to track the true length of the current stream.
  let currentVideoStream = "v0";
  let accumulated = config.clips[0]?.duration ?? 0; // duration of v0
  for (let i = 1; i < config.clips.length; i++) {
    const transitionMode = config.clips[i].transition as TransitionMode;
    const nextStream = `xfade${i}`;
    const clipDuration = config.clips[i].duration;

    if (transitionMode === "ffmpeg_fade") {
      const fadeDuration = FADE_DURATION;
      // start the cross-fade fadeDuration seconds before the end of the current accumulated stream
      const offset = Math.max(accumulated - fadeDuration, 0);
      filterParts.push(
        `[${currentVideoStream}][v${i}]xfade=transition=fade:duration=${fadeDuration}:offset=${offset}[${nextStream}]`
      );
      // xfade overlaps by fadeDuration, so subtract the overlap from the accumulated total after adding the new clip.
      // clamp to ≥0: a clip shorter than fadeDuration (0.5s) would make accumulated go negative, corrupting subsequent offsets and BGM fade-out timing (such clips are already degenerate; this clamp is a safety net)
      accumulated = Math.max(0, accumulated + clipDuration - fadeDuration);
    } else {
      // ai_start_end / ai_reference / direct_concat: simple concatenation (no overlap)
      filterParts.push(`[${currentVideoStream}][v${i}]concat=n=2:v=1:a=0[${nextStream}]`);
      accumulated = accumulated + clipDuration;
    }
    currentVideoStream = nextStream;
  }

  // stitch audio tracks (if any clips carry audio)
  let currentAudioStream = "";
  if (hasAnyAudio && audioParts.length > 0) {
    filterParts.push(...audioParts);
    // audio stitching must mirror video transitions: ffmpeg_fade uses acrossfade to overlap by FADE_DURATION
    // (shortening in sync with video xfade); other transitions use plain concat.
    // otherwise the audio track would be 0.5s longer per xfade transition than the resulting video, causing progressive audio/video drift.
    let curA = "a0";
    for (let i = 1; i < config.clips.length; i++) {
      const next = `acs${i}`;
      if ((config.clips[i].transition as TransitionMode) === "ffmpeg_fade") {
        filterParts.push(`[${curA}][a${i}]acrossfade=d=${FADE_DURATION}[${next}]`);
      } else {
        filterParts.push(`[${curA}][a${i}]concat=n=2:v=0:a=1[${next}]`);
      }
      curA = next;
    }
    currentAudioStream = curA;
  }

  // BGM mixing: layered on top of clip audio
  if (config.output.bgmPath) {
    const bgmIndex = inputs.length; // resolved dynamically (TTS audio may have consumed several inputs already)
    inputs.push({ path: config.output.bgmPath });
    const vol = config.output.bgmVolume ?? 0.3;
    // skip intro silence (opt-in, default 0): atrim drops the first N seconds then loops
    const introSkip = config.output.bgmIntroSkipSec ?? 0;
    const introArg = introSkip > 0 ? `atrim=start=${introSkip},asetpts=PTS-STARTPTS,` : "";
    // fade out at the end (default 3s, anchored to the final video duration): prevents aloop from being hard-cut by -t/amix, making the ending sound more polished
    const fadeOut = config.output.bgmFadeOutSec ?? 3;
    const fadeArg = fadeOut > 0 ? `,afade=t=out:st=${Math.max(0, accumulated - fadeOut).toFixed(3)}:d=${fadeOut}` : "";

    if (currentAudioStream) {
      // clip audio present: loop BGM to fill the full video (aloop prevents silence when BGM is shorter than the video),
      // lower its volume + fade out, then mix with narration.
      // amix must use normalize=0: the default normalize=1 scales each input by 1/inputs, halving narration volume to ~50% — narration must stay clearly audible.
      filterParts.push(`[${bgmIndex}:a]${introArg}aloop=loop=-1:size=2e9,volume=${vol}${fadeArg}[bgm_vol]`);
      if (config.output.bgmDuck) {
        // narration ducking (sidechaincompress): BGM auto-lowers when narration plays and recovers during pauses → clearer narration, fuller gaps.
        // narration serves as both a mix input and the sidechain trigger key, so asplit makes a copy. opt-in, off by default (zero default impact).
        filterParts.push(`[${currentAudioStream}]asplit=2[nar_mix][nar_key]`);
        filterParts.push(`[bgm_vol][nar_key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[bgm_duck]`);
        filterParts.push(`[nar_mix][bgm_duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[audio_final]`);
      } else {
        filterParts.push(`[${currentAudioStream}][bgm_vol]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[audio_final]`);
      }
      currentAudioStream = "audio_final";
    } else {
      // no clip audio: BGM only, also looped to fill + fade out (capped to video duration by the output -t flag)
      filterParts.push(`[${bgmIndex}:a]${introArg}aloop=loop=-1:size=2e9,volume=${vol}${fadeArg}[audio_final]`);
      currentAudioStream = "audio_final";
    }
  }

  // subtitles: ① karaoke per-character (libass burn-in from ASS, opt-in); ② otherwise per-sentence drawtext
  if (config.subtitle?.karaokeAssPath) {
    const subtitleStream = `sub_out`;
    const fontFile = config.subtitle.fontFile ?? resolveChineseFontFile();
    // fontsdir points to the directory containing the Chinese font so that libass can locate it on Linux (no CoreText)
    const fontsdirArg = fontFile ? `:fontsdir=${escapeSubtitlesPath(dirname(fontFile))}` : "";
    filterParts.push(`[${currentVideoStream}]subtitles=${escapeSubtitlesPath(config.subtitle.karaokeAssPath)}${fontsdirArg}[${subtitleStream}]`);
    currentVideoStream = subtitleStream;
  } else if (config.subtitle?.texts.length) {
    const subtitleStream = `sub_out`;
    // font size adapts to frame width (~5%) so e-commerce subtitles are prominent; can be overridden via config
    const fontSize = config.subtitle.fontSize || Math.round(width * (config.subtitle.fontSizeRatio || 0.05));
    const fontColor = config.subtitle.color || "white";
    const borderW = config.subtitle.strokeWidth || 3;
    // background box: opt-out via box:false (punch/minimal presets), custom colour via box.color
    const boxOpt =
      config.subtitle.box === false
        ? undefined
        : { color: config.subtitle.box?.color ?? "black@0.45", borderW: Math.round(fontSize * 0.35) };
    // multi-line-safe vertical anchor: bottom is pinned by the bottom edge of the text block (grows upward, never overflows);
    // center/top positions include text_h. bottom baseline is raised above the platform's bottom UI safe zone (avoids
    // the shopping-cart button / progress bar). with product card: pinned to 0.17 by the "card above, subtitle below" stack
    // (any higher and two-line subtitles would collide with the card); without card: raised to 0.22 to clear the 2026 UI zone.
    const hasProductCard = !!config.productCard?.imagePath;
    const bottomRatio = hasProductCard ? CAPTION_SAFE_BOTTOM_RATIO : CAPTION_SAFE_BOTTOM_RATIO_NOCARD;
    const bottomY = (1 - bottomRatio).toFixed(2); // with card: 0.83 / without card: 0.78
    const yPos = config.subtitle.position === "top" ? "h*0.08" : config.subtitle.position === "center" ? "(h-text_h)/2" : `h*${bottomY}-text_h`;
    const lineSpacing = Math.round(fontSize * 0.28);
    // Chinese subtitles must have an explicit font file; otherwise they render as boxes
    const fontFile = config.subtitle.fontFile ?? resolveChineseFontFile();

    const drawTexts = config.subtitle.texts
      .map((t) => {
        // auto-wrap to prevent English / long copy from overflowing the frame (drawtext natively supports real newlines)
        const wrapped = wrapCaption(t.text, fontSize, width);
        // semi-transparent background box improves readability (standard e-commerce short-video style)
        return buildDrawtext({
          fontFile: fontFile || undefined,
          text: wrapped,
          fontSize,
          fontColor,
          borderW,
          lineSpacing,
          box: boxOpt,
          x: "(w-text_w)/2",
          y: yPos,
          enable: `enable='between(t,${t.startTime},${t.endTime})'`,
        });
      })
      .join(",");

    filterParts.push(`[${currentVideoStream}]${drawTexts}[${subtitleStream}]`);
    currentVideoStream = subtitleStream;
  }

  // text overlays: price / selling-point / title tags (placed in the upper frame area, prominent e-commerce style)
  if (config.overlays?.length) {
    const ovFont = config.subtitle?.fontFile ?? resolveChineseFontFile();
    // per-style parameters: font size, text colour, background box colour, vertical position (upper frame)
    const styleOf = (style: "title" | "highlight" | "price") => {
      if (style === "price")
        return { size: Math.round(width * 0.075), color: "white", box: "red@0.85", y: "h*0.12" };
      if (style === "highlight")
        return { size: Math.round(width * 0.058), color: "#1a1a1a", box: "yellow@0.9", y: "h*0.2" };
      return { size: Math.round(width * 0.06), color: "white", box: "black@0.5", y: "h*0.06" }; // title style
    };
    const drawOverlays = config.overlays
      .map((o) => {
        const s = styleOf(o.style);
        const bb = Math.round(s.size * 0.4);
        // Wrap long tag text to the frame width and render each line as its own centered boxed
        // drawtext, stacked downward from the style's base y — these are large-font tags, so a long
        // selling-point/title string would otherwise overflow the frame edges (short tags stay a single
        // line, rendered identically to before). lineH clears the chunky per-line box padding.
        const lines = wrapCaption(o.text, s.size, width).split("\n");
        const lineH = Math.round(s.size * 1.9);
        return lines
          .map((line, i) =>
            buildDrawtext({
              fontFile: ovFont || undefined,
              text: line || " ",
              fontSize: s.size,
              fontColor: s.color,
              borderW: 2,
              box: { color: s.box, borderW: bb },
              x: "(w-text_w)/2",
              y: `${s.y}+${i * lineH}`,
              enable: `enable='between(t,${o.startTime},${o.endTime})'`,
            }),
          )
          .join(",");
      })
      .join(",");
    const ovStream = "ov_out";
    filterParts.push(`[${currentVideoStream}]${drawOverlays}[${ovStream}]`);
    currentVideoStream = ovStream;
  }

  // product card overlay (opt-in): bottom-left card = product thumbnail + name + purchase CTA, shown for ~5s at the start to simulate a "shopping cart link"
  if (config.productCard?.imagePath) {
    const cardIdx = inputs.length;
    inputs.push({ loop: true, path: config.productCard.imagePath });
    const thumb = Math.round(width * 0.16);
    const mx = Math.round(width * 0.045); // left margin
    const pad = Math.round(width * 0.022); // card inner padding
    const nm = (config.productCard.name || "").trim().slice(0, 10);
    const nameAreaW = nm ? Math.round(width * 0.4) : 0;
    const cardW = thumb + (nameAreaW ? pad + nameAreaW : 0);
    // use numeric positioning (avoids the variable-support inconsistency where drawbox doesn't support H but drawtext/overlay do):
    // cardY = frame height - thumbnail - bottom margin. subtitle baseline is already at the safe zone (bottom clearance 0.17);
    // the product card sits above the subtitles (bottom clearance 0.25), maintaining a non-overlapping "card above, subtitle below" stack.
    const cardY = height - thumb - Math.round(height * 0.25);
    const start = 0.4;
    const end = Math.min(5, accumulated);
    const en = `enable='between(t,${start},${end})'`;
    const cardFont = config.subtitle?.fontFile ?? resolveChineseFontFile();
    // 1) unified card background: semi-transparent dark fill wrapping thumbnail and text into a single card
    filterParts.push(`[${currentVideoStream}]drawbox=x=${mx - pad}:y=${cardY - pad}:w=${cardW + 2 * pad}:h=${thumb + 2 * pad}:color=black@0.5:t=fill:${en}[pcard_bg]`);
    currentVideoStream = "pcard_bg";
    // 2) product image thumbnail (proportionally scaled and cropped to a square)
    filterParts.push(`[${cardIdx}:v]scale=${thumb}:${thumb}:force_original_aspect_ratio=increase,crop=${thumb}:${thumb},setsar=1[pcard]`);
    filterParts.push(`[${currentVideoStream}][pcard]overlay=${mx}:${cardY}:${en}[pcard_v]`);
    currentVideoStream = "pcard_v";
    // 3) product name (white) + price (red, prominent) + yellow purchase CTA — three lines to the right of the thumbnail
    if (nm) {
      const tx = mx + thumb + pad;
      const price = (config.productCard.price || "").trim().slice(0, 12);
      const draws: string[] = [];
      const cf = cardFont || undefined;
      draws.push(buildDrawtext({ fontFile: cf, text: nm, fontSize: Math.round(width * 0.036), fontColor: "white", x: `${tx}`, y: `${cardY + Math.round(thumb * 0.12)}`, enable: en }));
      if (price) draws.push(buildDrawtext({ fontFile: cf, text: price, fontSize: Math.round(width * 0.05), fontColor: "0xff3b30", x: `${tx}`, y: `${cardY + Math.round(thumb * 0.4)}`, enable: en }));
      draws.push(buildDrawtext({ fontFile: cf, text: "点击下方购买 →", fontSize: Math.round(width * 0.028), fontColor: "0xffd60a", x: `${tx}`, y: `${cardY + Math.round(thumb * 0.72)}`, enable: en }));
      filterParts.push(`[${currentVideoStream}]${draws.join(",")}[pcard_out]`);
      currentVideoStream = "pcard_out";
    }
  }

  // loudness normalisation to social-media standard (~-14 LUFS, EBU R128 / loudnorm): consistent volume across videos,
  // preventing Douyin/TikTok from re-compressing inconsistent levels. applied at the end of the audio chain; skipped if there is no audio stream.
  if (currentAudioStream) {
    filterParts.push(`[${currentAudioStream}]loudnorm=I=-14:TP=-1.5:LRA=11[audio_norm]`);
    currentAudioStream = "audio_norm";
  }

  return {
    inputs,
    filterComplex: filterParts.join(";\n"),
    videoStream: currentVideoStream,
    audioStream: currentAudioStream,
    accumulated,
    outputPath,
  };
}

/**
 * Convert the pre-shell-escaped filtergraph (built for an inline, double-quoted -filter_complex argument)
 * into the form ffmpeg reads directly from a -filter_complex_script file. The only shell transform our
 * filtergraph relies on is POSIX double-quote backslash-halving (\\ -> \): escapeDrawText deliberately
 * doubles backslashes expecting the shell to halve them. Reading from a file (or passing via execFile)
 * skips the shell, so we apply that halving ourselves. escapeSubtitlesPath emits single backslashes
 * (\: \'), which contain no \\ pair and are left untouched — exactly as the shell leaves them.
 *
 * Exported because the sibling one-off overlay composers (cover / carousel / end-card) also run ffmpeg
 * shell-free via execFile with the filtergraph as a raw argv element, so they need the same halving to
 * turn buildDrawtext's pre-shell escaping into the ffmpeg-direct form.
 */
export function unshellFilter(filter: string): string {
  return filter.replace(/\\\\/g, "\\");
}

/**
 * Legacy shell-command string form — kept for tests / debugging and as the human-readable record of the
 * exact ffmpeg invocation. NOT used to execute anymore: composeVideo runs ffmpeg shell-free via execFile
 * (see buildComposeInvocation), which is what fixes the Windows failure. Paths are shell-quoted and the
 * filtergraph stays in pre-shell form here (a real shell would halve its backslashes).
 */
export function buildComposeCommand(config: ComposeConfig): string {
  const g = assembleComposeGraph(config);
  const inputStr = g.inputs.map(inputToShell).join(" ");

  let cmd = `"${ffmpegBin()}" -y ${inputStr} -filter_complex "${g.filterComplex}" -map "[${g.videoStream}]"`;

  // map audio output
  if (g.audioStream) {
    cmd += ` -map "[${g.audioStream}]"`;
  }

  // encoding parameters
  // render quality preset: resolution was already determined by preset above; here preset controls encode speed/quality (allowlist prevents injection)
  const enc = safeEncodeParams(config.output.videoPreset, config.output.crf);
  cmd += ` -c:v libx264 -preset ${enc.videoPreset} -crf ${enc.crf} -profile:v high -level:v 4.2 -pix_fmt yuv420p`;
  // AIGC implicit labelling (GB 45438-2025): writes "AI-generated label + service provider + content ID" into file metadata,
  // complementing the on-frame explicit label. pure -metadata flags; does not affect filter_complex.
  // content ID is derived from projectId (deterministic, assertable via ffprobe).
  const aigcArgs = buildAigcMetadataArgs({ contentId: config.projectId });
  // explicitly cap output duration to the real video timeline (accumulated): after xfade overlaps the video is shorter than the naive sum; prevents trailing audio playing over a frozen last frame
  cmd += ` -c:a aac -b:a 256k -movflags +faststart ${aigcArgs} -t ${g.accumulated.toFixed(3)} "${escapeShellPath(g.outputPath)}"`;

  return cmd;
}

/** Shell-free ffmpeg invocation: raw argv + a filtergraph in ffmpeg-direct form (fed via -filter_complex_script). */
export interface ComposeInvocation {
  /** ["-y", ...inputs] — raw paths, no shell quoting */
  inputArgs: string[];
  /** filtergraph in ffmpeg-direct form (shell backslash-halving already applied); write to a file for -filter_complex_script */
  filterComplex: string;
  /** maps + encode + metadata + -t + output path (the filter flag is spliced in by the caller) */
  outputArgs: string[];
  outputPath: string;
}

/**
 * Build a shell-free ffmpeg invocation. The giant, newline-laden filtergraph is returned separately so the
 * caller can write it to a file and pass it via -filter_complex_script; together with execFile (no shell)
 * this sidesteps cmd.exe's 8191-char command-line cap, its embedded-newline breakage, and its backslash
 * mangling of Windows paths — all of which made every compose fail on Windows (issue #13) while working on
 * macOS/Linux.
 */
export function buildComposeInvocation(config: ComposeConfig): ComposeInvocation {
  const g = assembleComposeGraph(config);
  const enc = safeEncodeParams(config.output.videoPreset, config.output.crf);
  const inputArgs = ["-y", ...g.inputs.flatMap(inputToArgv)];
  const outputArgs = [
    "-map", `[${g.videoStream}]`,
    ...(g.audioStream ? ["-map", `[${g.audioStream}]`] : []),
    "-c:v", "libx264", "-preset", enc.videoPreset, "-crf", String(enc.crf),
    "-profile:v", "high", "-level:v", "4.2", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart",
    ...buildAigcMetadataArgv({ contentId: config.projectId }),
    "-t", g.accumulated.toFixed(3),
    g.outputPath,
  ];
  return { inputArgs, filterComplex: unshellFilter(g.filterComplex), outputArgs, outputPath: g.outputPath };
}

/** maximum composition duration in milliseconds; the process is killed if exceeded to prevent a stuck render monopolising the machine indefinitely */
export const COMPOSE_TIMEOUT_MS = 10 * 60 * 1000;

/** Resolve the global ffmpeg render cap from COMPOSE_MAX_CONCURRENCY (default 2, clamped 1-8); exported for testability */
export function resolveComposeMaxConcurrency(raw = process.env.COMPOSE_MAX_CONCURRENCY): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.min(8, Math.max(1, Math.floor(n)));
}

// Module-level render gate: N concurrent compose requests used to spawn N parallel ffmpeg
// processes (each up to 10 min), starving CPU so every render slowed down and collectively
// timed out. Excess renders now queue in FIFO order instead of stampeding.
const composeLimiter = createLimiter(resolveComposeMaxConcurrency());

/** Classify low-level ffmpeg composition errors into actionable messages (pure function, unit-testable); returns null for unknown error types (to be rethrown as-is) */
export function composeErrorMessage(e: { killed?: boolean; signal?: string; stderr?: string; message?: string }): string | null {
  if (e.killed || e.signal === "SIGTERM") return "视频合成超时（已超过 10 分钟）——可能分镜过多或机器繁忙，请减少分镜或降到「快速」画质重试";
  const msg = `${e.stderr || ""} ${e.message || ""}`;
  if (/no space left|ENOSPC/i.test(msg)) return "磁盘空间不足，无法写出成片——请清理磁盘后重试";
  return null;
}

// run the composition
export async function composeVideo(config: ComposeConfig): Promise<string> {
  const outputDir = join(getDataDir(), "output", config.projectId);
  await mkdir(outputDir, { recursive: true });

  const inv = buildComposeInvocation(config);

  // Write the (large, newline-laden) filtergraph to a script file and pass it via -filter_complex_script.
  // Combined with execFile (no shell) this is the crux of the Windows fix (issue #13): a real 6-shot compose
  // command is ~12k chars with ~23 embedded newlines, and running it through cmd.exe (as child_process.exec
  // does on Windows) blew past its 8191-char command-line cap and choked on the newlines, so every final
  // compose failed on Windows while working on macOS/Linux. execFile bypasses the shell entirely (no length
  // cap, no quoting/backslash issues) and the script file keeps the argv small regardless of project size.
  const filterFile = join(outputDir, `filter_${Date.now()}.txt`);
  await writeFile(filterFile, inv.filterComplex, "utf8");
  const args = [...inv.inputArgs, "-filter_complex_script", filterFile, ...inv.outputArgs];

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  try {
    // Only the expensive ffmpeg run goes through the gate (cheap setup above runs unguarded);
    // execFile's timeout starts inside the limited fn, so time spent queueing never counts against it.
    // apply timeout (sends SIGTERM if exceeded); disk-full / timeout errors are mapped to readable messages
    await composeLimiter(() =>
      execFileAsync(ffmpegBin(), args, { maxBuffer: 50 * 1024 * 1024, timeout: COMPOSE_TIMEOUT_MS })
    );
  } catch (e) {
    const friendly = composeErrorMessage(e as { killed?: boolean; signal?: string; stderr?: string; message?: string });
    if (friendly) throw new Error(friendly);
    throw e;
  } finally {
    // Best-effort cleanup of the transient filtergraph script (kept out of the finished-video listing).
    await rm(filterFile, { force: true }).catch(() => {});
  }

  return inv.outputPath;
}
