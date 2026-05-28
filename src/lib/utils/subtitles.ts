/**
 * 字幕工具 —— 将口播文本按语速拆分为 SRT 字幕段落
 *
 * 功能：
 *   1. 按语速将长文本拆分为多段字幕（每段 ≤ maxCharsPerLine 个字符，默认 15）
 *   2. 根据字幕总字数和语速估算每段起止时间
 *   3. 输出标准 SRT 格式字符串
 *   4. 支持 3 种渲染样式：default / bold / outline
 *
 * SRT 样式说明（ASS/SSA 内联标签，兼容部分播放器）：
 *   - default ：底部居中，白字 + 黑色边框（默认行为）
 *   - bold    ：白字加粗
 *   - outline ：白字 + 加粗描边
 */

// ──────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────

export type SubtitleStyle = 'default' | 'bold' | 'outline';

export interface SubtitleSegment {
  /** 段序号（从 1 开始） */
  index: number;
  /** 字幕文本 */
  text: string;
  /** 起始时间（秒） */
  startSec: number;
  /** 结束时间（秒） */
  endSec: number;
}

export interface GenerateSubtitlesOptions {
  /** 口播文本 */
  text: string;
  /** 语速（字/秒），默认 4 */
  charsPerSec?: number;
  /** 每段最大字符数，默认 15 */
  maxCharsPerLine?: number;
  /** 字幕样式，默认 'default' */
  style?: SubtitleStyle;
  /** 起始偏移秒数，默认 0 */
  startOffset?: number;
  /** 相邻字幕之间的间隔（秒），默认 0.2 */
  gap?: number;
}

export interface SubtitleResult {
  /** SRT 格式文本 */
  srt: string;
  /** 分段详情 */
  segments: SubtitleSegment[];
  /** 字幕总时长（秒） */
  totalDuration: number;
  /** 使用的样式 */
  style: SubtitleStyle;
}

// ──────────────────────────────────────────────
// 文本分段
// ──────────────────────────────────────────────

/**
 * 按语义和最大长度将文本拆分为字幕段。
 *
 * 优先在标点符号 / 空格处断行；若无合适的断点则强制按 maxChars 截断。
 */
export function splitTextIntoSegments(
  text: string,
  maxChars: number = 15,
): string[] {
  // 预处理：合并多余空白
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const segments: string[] = [];
  let remaining = cleaned;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      segments.push(remaining.trim());
      break;
    }

    // 在 [0, maxChars] 范围内寻找最佳断点
    let breakAt = findBestBreakPoint(remaining, maxChars);

    const segment = remaining.slice(0, breakAt).trim();
    if (segment) {
      segments.push(segment);
    }

    remaining = remaining.slice(breakAt).trimStart();
  }

  return segments;
}

/**
 * 从后往前寻找最佳断点位置。
 * 优先级：句号/问号/感叹号 > 逗号/分号/冒号 > 空格 > 强制截断。
 */
function findBestBreakPoint(text: string, maxChars: number): number {
  const searchRange = text.slice(0, maxChars);

  // 1. 句末标点（。！？!?…）
  const sentenceEnd = findLastIndexOfAny(searchRange, [
    '。', '！', '？', '!', '?', '…', '……', '；', ';',
  ]);
  if (sentenceEnd !== -1) return sentenceEnd + 1;

  // 2. 句中标点（，、：:——）
  const clauseEnd = findLastIndexOfAny(searchRange, [
    '，', '、', '：', ':', ',', '——', '—',
  ]);
  if (clauseEnd !== -1) return clauseEnd + 1;

  // 3. 空格
  const lastSpace = searchRange.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.3) return lastSpace + 1;

  // 4. 强制截断
  return maxChars;
}

/** 在文本中从后往前查找任意一个目标字符的位置 */
function findLastIndexOfAny(text: string, chars: string[]): number {
  let best = -1;
  for (const ch of chars) {
    const idx = text.lastIndexOf(ch);
    if (idx > best) best = idx;
  }
  return best;
}

// ──────────────────────────────────────────────
// 时间计算
// ──────────────────────────────────────────────

/**
 * 根据分段和语速计算每段的时间区间。
 */
export function calculateTimings(
  segments: string[],
  charsPerSec: number = 4,
  startOffset: number = 0,
  gap: number = 0.2,
): { start: number; end: number }[] {
  const timings: { start: number; end: number }[] = [];
  let current = startOffset;

  for (const seg of segments) {
    // 去掉标点后计算实际朗读字数（标点不占额外时间）
    const readableChars = seg.replace(/[，。！？、；：,.:;!?…—\-\s]/g, '').length;
    // 至少 0.5 秒，避免短句一闪而过
    const duration = Math.max(0.5, readableChars / charsPerSec);

    timings.push({
      start: current,
      end: current + duration,
    });

    current += duration + gap;
  }

  return timings;
}

// ──────────────────────────────────────────────
// SRT 格式化
// ──────────────────────────────────────────────

/**
 * 将秒数格式化为 SRT 时间码 → HH:MM:SS,mmm
 */
function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':') + ',' + String(ms).padStart(3, '0');
}

/**
 * 根据样式为字幕文本添加渲染标签。
 *
 * SRT 本身不支持样式，但许多播放器支持内联 HTML 标签：
 *   - <b> 加粗
 *   - <u> 下划线
 *   - <font color="..."> 颜色
 *
 * 如果你的播放器支持 ASS/SSA，这些标签可替换为 ASS override tags。
 */
function applyStyle(text: string, style: SubtitleStyle): string {
  switch (style) {
    case 'bold':
      // 加粗白字
      return `<b><font color="#FFFFFF">${escapeXml(text)}</font></b>`;

    case 'outline':
      // 描边白字（利用 CSS text-shadow 思路，部分播放器支持）
      // 通用兼容方案：加粗 + 白色，外层包裹辅助标签
      return `<b><font color="#FFFFFF">${escapeXml(text)}</font></b>`;

    case 'default':
    default:
      // 默认白字黑边——SRT 通常由播放器叠加渲染，这里只输出纯文本即可
      return escapeXml(text);
  }
}

/** 转义 XML 特殊字符 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ──────────────────────────────────────────────
// ASS 样式注释块（可选，输出在 SRT 头部供支持的播放器解析）
// ──────────────────────────────────────────────

function getStyleComment(style: SubtitleStyle): string {
  switch (style) {
    case 'bold':
      return [
        'NOTE style: bold',
        'NOTE 白字加粗，适用于深色背景',
        'NOTE ASS equivalent: Style: Bold,PrimaryColour=&H00FFFFFF,',
        'NOTE   Bold=-1,Outline=0,Shadow=0',
      ].join('\n');

    case 'outline':
      return [
        'NOTE style: outline',
        'NOTE 白字描边，适用于复杂背景',
        'NOTE ASS equivalent: Style: Outline,PrimaryColour=&H00FFFFFF,',
        'NOTE   Bold=-1,Outline=2,OutlineColour=&H00000000,Shadow=0',
      ].join('\n');

    case 'default':
    default:
      return [
        'NOTE style: default',
        'NOTE 底部白字黑边（播放器默认叠加样式）',
        'NOTE ASS equivalent: Style: Default,PrimaryColour=&H00FFFFFF,',
        'NOTE   OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1',
        'NOTE   Alignment=2,MarginV=30',
      ].join('\n');
  }
}

// ──────────────────────────────────────────────
// 主入口
// ──────────────────────────────────────────────

/**
 * 将口播文本转为 SRT 字幕。
 *
 * @example
 * ```ts
 * const result = generateSubtitles({
 *   text: '大家好，欢迎来到今天的视频。今天我们来聊一聊如何快速生成字幕文件。',
 *   charsPerSec: 4,
 *   maxCharsPerLine: 15,
 *   style: 'bold',
 * });
 * console.log(result.srt);
 * ```
 */
export function generateSubtitles(options: GenerateSubtitlesOptions): SubtitleResult {
  const {
    text,
    charsPerSec = 4,
    maxCharsPerLine = 15,
    style = 'default',
    startOffset = 0,
    gap = 0.2,
  } = options;

  if (!text.trim()) {
    return {
      srt: '',
      segments: [],
      totalDuration: 0,
      style,
    };
  }

  // 1. 分段
  const textSegments = splitTextIntoSegments(text, maxCharsPerLine);

  // 2. 计算时间
  const timings = calculateTimings(textSegments, charsPerSec, startOffset, gap);

  // 3. 组装段落
  const segments: SubtitleSegment[] = textSegments.map((t, i) => ({
    index: i + 1,
    text: t,
    startSec: timings[i].start,
    endSec: timings[i].end,
  }));

  // 4. 生成 SRT
  const styleComment = getStyleComment(style);

  const srtBody = segments
    .map((seg) => {
      const styledText = applyStyle(seg.text, style);
      return [
        String(seg.index),
        `${formatSrtTime(seg.startSec)} --> ${formatSrtTime(seg.endSec)}`,
        styledText,
        '',
      ].join('\n');
    })
    .join('\n');

  const srt = [styleComment, '', srtBody].join('\n');

  // 5. 总时长
  const lastSeg = segments[segments.length - 1];
  const totalDuration = lastSeg ? lastSeg.endSec : 0;

  return { srt, segments, totalDuration, style };
}

// ──────────────────────────────────────────────
// 便捷函数
// ──────────────────────────────────────────────

/**
 * 快速生成 SRT 字符串（最简接口）。
 */
export function toSrt(
  text: string,
  options?: Omit<GenerateSubtitlesOptions, 'text'>,
): string {
  return generateSubtitles({ text, ...options }).srt;
}

/**
 * 生成带 ASS 样式头的字幕（适用于支持 ASS override tag 的播放器）。
 */
export function toStyledSrt(
  text: string,
  style: SubtitleStyle = 'default',
  extraOptions?: Omit<GenerateSubtitlesOptions, 'text' | 'style'>,
): string {
  return generateSubtitles({ text, style, ...extraOptions }).srt;
}

// ──────────────────────────────────────────────
// 附赠：SRT 解析器（方便读取已有 SRT 文件）
// ──────────────────────────────────────────────

export interface ParsedSrtEntry {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * 解析 SRT 字符串为结构化数据。
 */
export function parseSrt(srtContent: string): ParsedSrtEntry[] {
  // 去掉 NOTE 注释行
  const cleaned = srtContent
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('NOTE'))
    .join('\n');

  // 按空行分块
  const blocks = cleaned.trim().split(/\n\s*\n/);
  const entries: ParsedSrtEntry[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    if (isNaN(index)) continue;

    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/,
    );
    if (!timeMatch) continue;

    const text = lines.slice(2).join('\n').replace(/<[^>]+>/g, ''); // 去掉 HTML 标签

    entries.push({
      index,
      startSec: parseSrtTime(timeMatch[1]),
      endSec: parseSrtTime(timeMatch[2]),
      text,
    });
  }

  return entries;
}

/** 将 SRT 时间码解析为秒数 */
function parseSrtTime(timeStr: string): number {
  const normalized = timeStr.replace(',', '.');
  const [hms, ms] = normalized.split('.');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}
