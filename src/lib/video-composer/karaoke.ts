/**
 * 卡拉OK逐字高亮字幕（ASS）—— 2026 TikTok/带货爆款字幕标配：整句留屏，逐字随旁白「唱」过去变高亮色。
 * 我们自产 Edge TTS、文本已知，无需 ASR：按字符数把每行旁白时长均摊到每个字/词的 \k 卡拉OK时长。
 * 纯函数产出 ASS 文本（不落盘、不调 ffmpeg），可单测；由 composer 用 libass(subtitles 滤镜)烧录。
 */

export interface KaraokeLine {
  text: string;
  startTime: number; // 秒
  endTime: number; // 秒
}

export interface KaraokeStyleOpts {
  fontName?: string; // ASS Fontname；libass 经 fontconfig/CoreText/ fontsdir 解析
  fontSize?: number;
  /** 已唱（高亮）色，ASS &HAABBGGRR；默认黄 */
  primaryColour?: string;
  /** 未唱色；默认白 */
  secondaryColour?: string;
  outlineColour?: string;
  playResX?: number;
  playResY?: number;
  /** 底部边距（px，PlayRes 坐标系） */
  marginV?: number;
  /** 含数字的单位（价格/折扣/数量）自动放大+换热色高亮，默认 true */
  emphasizeNumbers?: boolean;
  /** 强调高亮色（ASS &HAABBGGRR），默认橙红 */
  accentColour?: string;
}

const DEFAULTS = {
  fontName: "PingFang SC",
  fontSize: 46,
  primaryColour: "&H0000F0FF", // 黄（高亮）
  secondaryColour: "&H00FFFFFF", // 白（未唱）
  outlineColour: "&H00202020",
  playResX: 1080,
  playResY: 1920,
  marginV: 240,
  emphasizeNumbers: true,
  accentColour: "&H000050FF", // 橙红，价格/折扣强调
};

/** 秒 → ASS 时间戳 H:MM:SS.cc（厘秒） */
export function toAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const cc = cs === 100 ? 99 : cs; // 防进位越界
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

/** 转义 ASS Text 字段里的特殊字符（{ } 是覆盖块定界、\ 是控制符、换行用 \N） */
export function assEscapeText(text: string): string {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/** 切分为卡拉OK高亮单位：CJK 按字，拉丁按词（连带其后空格归到该词，避免词间塌缩） */
export function splitKaraokeUnits(text: string): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const units: string[] = [];
  let latin = "";
  const flushLatin = () => {
    if (latin) {
      units.push(latin);
      latin = "";
    }
  };
  for (const ch of Array.from(clean)) {
    const isCjk = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/.test(ch);
    if (isCjk) {
      flushLatin();
      units.push(ch);
    } else if (ch === " ") {
      latin += " "; // 空格并入当前拉丁词尾，随词作为一个卡拉单位后立即收束
      flushLatin();
    } else {
      latin += ch;
    }
  }
  flushLatin();
  return units.map((u) => u).filter((u) => u.length > 0);
}

/** ASS 颜色 &HAABBGGRR → 内联 \1c 用的 &HBBGGRR&（去掉 alpha） */
function toInlineColour(assColour: string): string {
  const hex = String(assColour || "").replace(/^&H/i, "").replace(/&$/, "");
  const bgrr = hex.length >= 8 ? hex.slice(2) : hex;
  return `&H${bgrr || "FFFFFF"}&`;
}

interface LineCfg {
  baseFs: number;
  primaryC: string; // 内联 \1c（普通字填充目标色）
  accentC: string; // 内联 \1c（强调字填充目标色，热色）
  emphasize: boolean;
  emphScale: number;
}

/**
 * 为一行生成 {\k..}逐字 文本：行时长按各单位字符长占比换算成厘秒 \k；
 * 含数字的单位（价格/折扣/数量，如 50% / 9.9 / ¥39）自动放大 + 换热色高亮（带货爆款强调技法）。
 */
function buildKaraokeLineText(text: string, durationSec: number, cfg: LineCfg): string {
  const units = splitKaraokeUnits(text);
  if (units.length === 0) return "";
  const totalCs = Math.max(1, Math.round(durationSec * 100));
  const lens = units.map((u) => Math.max(u.trim().length, 1));
  const sumLen = lens.reduce((a, b) => a + b, 0);
  let used = 0;
  return units
    .map((u, i) => {
      // 末单位吃掉余数，保证 \k 之和恰为 totalCs
      const k = i === units.length - 1 ? totalCs - used : Math.max(1, Math.round((lens[i] / sumLen) * totalCs));
      used += k;
      const emph = cfg.emphasize && /\d/.test(u); // 含数字 → 价格/折扣/数量，强调
      const fs = emph ? Math.round(cfg.baseFs * cfg.emphScale) : cfg.baseFs;
      const c = emph ? cfg.accentC : cfg.primaryC;
      return `{\\k${k}\\fs${fs}\\1c${c}}${assEscapeText(u)}`;
    })
    .join("");
}

/** 生成完整 ASS 文本（含样式 + 逐字卡拉OK事件）。 */
export function buildKaraokeAss(lines: KaraokeLine[], opts: KaraokeStyleOpts = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const outline = Math.max(2, Math.round(o.fontSize * 0.07));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${o.playResX}`,
    `PlayResY: ${o.playResY}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: K,${o.fontName},${o.fontSize},${o.primaryColour},${o.secondaryColour},${o.outlineColour},&H64000000,1,0,0,0,100,100,0,0,1,${outline},1,2,60,60,${o.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const cfg: LineCfg = {
    baseFs: o.fontSize,
    primaryC: toInlineColour(o.primaryColour),
    accentC: toInlineColour(o.accentColour),
    emphasize: o.emphasizeNumbers !== false,
    emphScale: 1.35,
  };
  const events = (lines || [])
    .filter((l) => l && l.text && l.endTime > l.startTime)
    .map((l) => {
      const body = buildKaraokeLineText(l.text, l.endTime - l.startTime, cfg);
      return `Dialogue: 0,${toAssTime(l.startTime)},${toAssTime(l.endTime)},K,,0,0,0,,${body}`;
    });
  return header.concat(events).join("\n") + "\n";
}
