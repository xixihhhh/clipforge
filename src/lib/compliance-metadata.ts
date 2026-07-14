/**
 * AIGC implicit labeling (file metadata) — aligns with GB 45438-2025 "Methods for Identifying
 * AI-Generated and Synthesized Content" requirements for "implicit labeling":
 * writes three mandatory fields into the output file metadata:
 * ① AI-generated/synthesized tag  ② service provider  ③ content production ID.
 *
 * This is a hard compliance requirement for publishing to Douyin/Kuaishou in China in 2026:
 * the visible "AI-generated" explicit overlay (compliance-overlays.ts) alone is not sufficient —
 * missing implicit metadata causes platforms to auto-detect the video as "unlabeled AI content"
 * and throttle it. This file only produces ffmpeg `-metadata` arguments; it does not touch
 * filter_complex (transition / audio / subtitle filters) — purely appended to the command tail,
 * assertable via ffprobe, zero external keys required.
 *
 * Implementation note: MP4 container support for custom metadata keys is unreliable (keys may be
 * silently dropped), so the three required fields are written into reliably readable standard tags
 * (comment / copyright / description), with all three encoded into the comment string.
 */

export interface AigcMetadataOpts {
  /** Content production ID (use projectId / compositionId) */
  contentId: string;
  /** Service provider name, defaults to ClipForge */
  serviceProvider?: string;
}

/** Strip characters with special meaning inside shell double-quoted strings to prevent injection (values are interpolated into `-metadata k="..."`). */
function sanitize(v: string): string {
  return String(v ?? "").replace(/["$\\`\r\n]/g, "").trim();
}

/** The three GB 45438 metadata fields as [key, value] pairs (shared by the shell-string and argv builders). */
export function buildAigcMetadataFields(opts: AigcMetadataOpts): Array<[string, string]> {
  const provider = sanitize(opts.serviceProvider || "ClipForge") || "ClipForge";
  const id = sanitize(opts.contentId).slice(0, 64) || "unknown";
  // Three required fields: AI-generated/synthesized tag (AIGC=1 / 内容=AI生成合成) + service provider + content production ID
  const triple = `AIGC=1; 内容=AI生成合成; 服务提供者=${provider}; 内容制作编号=${id}`;
  return [
    ["comment", triple],
    ["copyright", `AI-generated content by ${provider}`],
    ["description", `本视频含AI生成合成内容（服务提供者:${provider} 编号:${id}）`],
  ];
}

/** Builds the ffmpeg `-metadata` argument string for GB 45438 implicit labeling (appended to the compose command, before the output file path). */
export function buildAigcMetadataArgs(opts: AigcMetadataOpts): string {
  return buildAigcMetadataFields(opts).map(([k, v]) => `-metadata ${k}="${v}"`).join(" ");
}

/**
 * Same three fields as raw ffmpeg argv tokens (`["-metadata", "comment=...", ...]`) for the shell-free
 * execFile compose path: values are passed verbatim to ffmpeg (no shell), so no double-quote wrapping.
 */
export function buildAigcMetadataArgv(opts: AigcMetadataOpts): string[] {
  return buildAigcMetadataFields(opts).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
}
