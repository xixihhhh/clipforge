import { join, dirname } from "path";
import { getDataDir } from "@/lib/paths";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { TRANSITIONS, type TransitionMode } from "./transitions";
import { MOTIONS, DEFAULT_MOTION } from "./motions";
import { safeEncodeParams } from "@/lib/compose-presets";
import { buildAigcMetadataArgs } from "@/lib/compliance-metadata";
import { CAPTION_SAFE_BOTTOM_RATIO, CAPTION_SAFE_BOTTOM_RATIO_NOCARD } from "./safe-zone";

/**
 * 探测一个可用的中文字体文件路径
 * drawtext 不指定 fontfile 时，默认字体不含中文字形，中文字幕会渲染成方块/空白
 * 优先项目内置字体（部署可控），再回退到 macOS / Linux 常见中文字体
 */
function resolveChineseFontFile(): string | undefined {
  const candidates = [
    // 项目内置字体（推荐：把一个中文 ttf 放到 public/fonts 保证部署一致）
    join(process.cwd(), "public", "fonts", "subtitle.ttf"),
    join(process.cwd(), "public", "fonts", "subtitle.otf"),
    // macOS 常见中文字体
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    // Linux 常见中文字体（服务器部署）
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * 转义 FFmpeg drawtext 滤镜中的特殊字符
 * drawtext 使用 : 作为参数分隔符，需要转义文本中的特殊字符
 */
function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")  // 反斜杠
    .replace(/'/g, "\u2019")      // 单引号替换为右单引号（避免 shell 嵌套转义问题）
    .replace(/:/g, "\\\\:")       // 冒号（FFmpeg drawtext 参数分隔符）
    // 不转义 %：drawtext 配 expansion=none 后 % 为字面量；带货文案高频含「立省50%」「50% off」，
    // 若转成 \% 则 ffmpeg 8.0 报 `Stray %` 致整条字幕/贴片渲染为空白（静默失效）。
    .replace(/\[/g, "\\\\[")      // 方括号（FFmpeg filter 流标记）
    .replace(/\]/g, "\\\\]");
}

/** 转义 subtitles/ass 滤镜的路径：反斜杠→正斜杠、转义冒号(Windows 盘符)与单引号，避免破坏 filtergraph */
function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** drawtext 滤镜参数（text/fontFile 在内部强制转义，新加贴片不会再漏转义——审计曾因字体路径用错转义器出过 bug） */
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
  /** 整段 enable 表达式，如 enable='between(t,0,3)'（可空） */
  enable?: string;
}

/**
 * 统一构建 drawtext 滤镜串：把「文本→escapeDrawText、字体路径→escapeSubtitlesPath」的转义收口到一处。
 * 字段顺序与各贴片站点历史顺序一致（可选字段缺省即不输出），对现有命令字节等价。
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

/** 由探测到的中文字体文件推断其 ASS Fontname（libass 跨平台按名匹配；macOS CoreText 一般也能兜底） */
export function resolveChineseFontFamily(): string {
  const p = (resolveChineseFontFile() || "").toLowerCase();
  // 项目内置全 CJK 字幕字体（public/fonts/subtitle.*）即 Noto Sans CJK SC——
  // 卡拉OK 走 libass 按 Fontname 匹配，必须回这个内部族名才能用上内置字体（否则会去找系统 PingFang，韩文又成豆腐块）
  if (p.includes("fonts/subtitle") || p.includes("fonts\\subtitle")) return "Noto Sans CJK SC";
  if (p.includes("pingfang")) return "PingFang SC";
  if (p.includes("stheiti")) return "STHeiti";
  if (p.includes("hiragino")) return "Hiragino Sans GB";
  if (p.includes("notosanscjk") || p.includes("noto")) return "Noto Sans CJK SC";
  if (p.includes("wqy") || p.includes("zenhei")) return "WenQuanYi Zen Hei";
  if (p.includes("arial unicode")) return "Arial Unicode MS";
  return "PingFang SC";
}

/** 判断是否为 CJK（中日韩）字符——用于估算字宽与换行策略 */
function isCJK(ch: string): boolean {
  return /[⺀-鿿豈-﫿＀-￯　-〿가-힣]/.test(ch);
}

/**
 * 字幕自动换行：按画面宽度把长文案折成多行（插入真实换行符，drawtext 原生支持）。
 * 解决全球化后英文配音字幕过长溢出画面两侧的问题（英文同时长字符数远多于中文）。
 * 估宽：CJK 字 ≈ fontSize，拉丁字符 ≈ fontSize×0.55；拉丁按单词断行（不拆词），CJK 按字断行。
 * 纯函数，便于单测。
 */
export function wrapCaption(text: string, fontSize: number, frameWidth: number): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  const maxWidth = frameWidth * 0.86; // 两侧留边距
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
      // 单个 token 自身超宽（长 CJK 串或超长单词）→ 按字硬切
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
 * 把一句旁白切成「短句卡」并在 [startTime,endTime] 内顺序排布——rapid 短字幕是 2026 muted 观看 / 带货留存的标配，
 * 替代「一整句静态显示一镜到底」。目标 ~1.2s 一块（封顶 8 块）；CJK 按字、Latin 按词均分，时间按块长比例分配。
 * 纯函数可单测；返回的多段字幕由现有 composer 逐段 drawtext 渲染（互不重叠，一次只显一块）。
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
  const cjk = /[぀-ヿ一-鿿가-힯]/.test(clean); // 假名/汉字/谚文
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
 * 转义 shell 双引号字符串中的特殊字符
 * 防止文件路径包含特殊字符时导致命令注入
 */
function escapeShellPath(filePath: string): string {
  return filePath.replace(/["$`\\!]/g, "\\$&");
}

// 视频合成配置
export interface ComposeConfig {
  projectId: string;
  clips: ClipInput[];
  output: {
    resolution: "720p" | "1080p";
    aspectRatio: "9:16" | "16:9" | "1:1";
    bgmPath?: string;
    bgmVolume?: number; // 0-1
    /** BGM 结尾淡出秒数（默认 3，0=不淡出）：避免 aloop 铺满后被硬切收尾生硬 */
    bgmFadeOutSec?: number;
    /** BGM 跳过前奏秒数（opt-in，默认 0）：跳过开头空白/前奏；设过大且 BGM 短会被清空，故默认 0 */
    bgmIntroSkipSec?: number;
    /** 旁白闪避（opt-in，默认 false）：sidechaincompress 让旁白一响就压低 BGM、停顿回升，旁白更清晰 */
    bgmDuck?: boolean;
    /** x264 编码 preset（渲染质量预设映射，缺省 medium）；只接受白名单值 */
    videoPreset?: string;
    /** x264 -crf 质量（缺省 18）；会被夹取到合法范围 */
    crf?: number;
  };
  subtitle?: {
    texts: { text: string; startTime: number; endTime: number }[];
    fontFamily?: string;
    /** 中文字体文件绝对路径（不指定则自动探测系统中文字体） */
    fontFile?: string;
    fontSize?: number;
    color?: string;
    strokeColor?: string;
    strokeWidth?: number;
    position?: "bottom" | "center" | "top";
    /** 卡拉OK逐字字幕（opt-in）：传入已写好的 ASS 文件路径则改用 libass 烧录，替代逐句 drawtext */
    karaokeAssPath?: string;
  };
  /** 文字贴片：价格贴/卖点贴/标题贴，叠在画面上方区域（带货常见样式） */
  overlays?: {
    text: string;
    style: "title" | "highlight" | "price";
    startTime: number;
    endTime: number;
  }[];
  /** 带货商品卡贴片（opt-in）：左下角商品图缩略 + 商品名 + 价格，开头若干秒展示，营造「挂车」感 */
  productCard?: {
    imagePath: string; // 商品图本地路径
    name?: string;
    price?: string; // 价格文案，如「¥39.9」
  };
}

export interface ClipInput {
  type: "video" | "image"; // 视频片段或静态图+运动
  filePath: string;
  duration: number; // 秒
  transition: string; // 转场类型
  motion?: string; // 仅 image 类型，运动效果
  /** 该片段是否包含原生音频（模型生成的带配音视频） */
  hasAudio?: boolean;
  /** 该片段的配音音频文件路径（TTS 生成）。会按片段时长对齐（不足补静音、超出截断） */
  audioPath?: string;
}

// 分辨率映射
const RESOLUTIONS: Record<string, Record<string, { width: number; height: number }>> = {
  "9:16": { "720p": { width: 720, height: 1280 }, "1080p": { width: 1080, height: 1920 } },
  "16:9": { "720p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 } },
  "1:1": { "720p": { width: 720, height: 720 }, "1080p": { width: 1080, height: 1080 } },
};

// 片段归一化滤镜：把每个 [v{i}] 统一成相同的像素格式 / 方形像素(SAR=1) / 30fps / 标准时基，
// 让后续 concat / xfade 的所有输入完全一致——这是混用真实素材（不同来源、不同像素格式）时
// 避免 FFmpeg「Error reinitializing filters」合成崩溃的关键。
const SEGMENT_NORM = "format=yuv420p,setsar=1,fps=30,settb=AVTB";

/** ffmpeg_fade 转场的交叉淡化时长（秒）。视频 xfade / 音频 acrossfade / 字幕时间轴必须用同一个值，否则音画字失步 */
export const FADE_DURATION = 0.5;

// 生成 FFmpeg 合成命令
export function buildComposeCommand(config: ComposeConfig): string {
  // 空 clips 会让后续 -map "[v0]" 指向从未创建的流，ffmpeg 报晦涩错误；这里提前给出可读错误
  if (!config.clips || config.clips.length === 0) {
    throw new Error("没有可合成的片段（clips 为空）——请先为分镜配好画面素材再合成");
  }
  const { width, height } = RESOLUTIONS[config.output.aspectRatio][config.output.resolution];
  const outputDir = join(getDataDir(), "output", config.projectId);
  const outputPath = join(outputDir, `final_${Date.now()}.mp4`);

  const inputs: string[] = [];
  const filterParts: string[] = [];

  // 判断是否有任何片段带音频（原生音频 或 TTS 配音）
  const hasAnyAudio = config.clips.some(
    (c) => (c.hasAudio && c.type === "video") || c.audioPath
  );

  // 处理每个片段
  config.clips.forEach((clip, i) => {
    if (clip.type === "image") {
      // 商品原图 + 运动效果。运镜键无效时回退到默认运镜，绝不跳过片段
      // （否则 inputs/filter 数量与下方 concat 引用的 [v${i}] 不一致，导致 ffmpeg 崩溃）
      const motion = (clip.motion && MOTIONS[clip.motion]) || MOTIONS[DEFAULT_MOTION];
      inputs.push(`-loop 1 -t ${clip.duration} -i "${escapeShellPath(clip.filePath)}"`);
      // 关键：zoompan 对每个输入帧输出 d 帧。-loop 产生多帧输入会导致帧数爆炸、视频被拉长数十倍，
      // 因此先 trim 取首帧，再用 zoompan 的 d=duration*fps 控制总输出帧数。
      // 末尾 SEGMENT_NORM 统一像素格式/SAR/帧率/时基：免费素材库的真实图片像素格式各异
      // （yuvj420p/yuv420p/yuvj444p…），不归一会让 concat/xfade 报「Error reinitializing filters」而合成失败。
      // zoompan 的 d=duration*fps 取整后会比 clip.duration 短 1~2 帧，多段图片累计后视频比音频/字幕短一截（漂移）。
      // 与视频段一致地用 tpad 克隆末帧补足、再 trim 到精确 duration，保证每段图片恒等于 clip.duration。
      filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,trim=end_frame=1,setpts=PTS-STARTPTS,${motion.getFilter(width, height, clip.duration)},tpad=stop_mode=clone:stop_duration=${clip.duration},trim=duration=${clip.duration},setpts=PTS-STARTPTS,${SEGMENT_NORM}[v${i}]`);
    } else {
      // 视频片段：缩放铺满 + 按分镜时长对齐。免费素材库（Wikimedia 等）真实视频长度不一，
      // 短于分镜时长的片段若只 trim 会留黑尾、并使音画/字幕错位——先 tpad 克隆末帧补到目标时长，
      // 再 trim 截断，保证视频段恒等于 clip.duration。
      inputs.push(`-i "${escapeShellPath(clip.filePath)}"`);
      filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,tpad=stop_mode=clone:stop_duration=${clip.duration},trim=duration=${clip.duration},setpts=PTS-STARTPTS,${SEGMENT_NORM}[v${i}]`);
    }
  });

  // 音频处理：TTS 配音 > 视频原生音频 > 静音；每段都按片段时长对齐，保证音画同步
  const audioParts: string[] = [];
  if (hasAnyAudio) {
    config.clips.forEach((clip, i) => {
      if (clip.audioPath) {
        // TTS 配音：作为额外输入加入，按片段时长补静音/截断对齐
        const ai = inputs.length;
        inputs.push(`-i "${escapeShellPath(clip.audioPath)}"`);
        audioParts.push(
          `[${ai}:a]aresample=44100,apad,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`
        );
      } else if (clip.hasAudio && clip.type === "video") {
        // 提取该片段的原生音轨（模型自带语音/音效），按分镜时长补齐/裁剪对齐
        audioParts.push(`[${i}:a]aresample=44100,apad,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        // 生成等时长的静音音轨（使用 lavfi 虚拟输入）
        audioParts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`);
      }
    });
  }

  // 拼接视频转场
  // 关键：xfade 的 offset 必须相对「已累计拼接后的流」长度，而不是上一个片段的时长。
  // 否则第 3 个及以后的 xfade 会从很早的时间点开始淡入，把前面已拼好的画面整段截掉
  // （表现为成片时长莫名缩短一大截）。这里用 accumulated 跟踪当前流的真实时长。
  let currentVideoStream = "v0";
  let accumulated = config.clips[0]?.duration ?? 0; // v0 的时长
  for (let i = 1; i < config.clips.length; i++) {
    const transitionMode = config.clips[i].transition as TransitionMode;
    const nextStream = `xfade${i}`;
    const clipDuration = config.clips[i].duration;

    if (transitionMode === "ffmpeg_fade") {
      const fadeDuration = FADE_DURATION;
      // 从「当前累计流末尾往前 fadeDuration」开始交叉淡化
      const offset = Math.max(accumulated - fadeDuration, 0);
      filterParts.push(
        `[${currentVideoStream}][v${i}]xfade=transition=fade:duration=${fadeDuration}:offset=${offset}[${nextStream}]`
      );
      // xfade 会重叠 fadeDuration，故累计时长加上新片段后要减去重叠部分。
      // clamp ≥0：clip 短于 fadeDuration(0.5s) 时该步会让 accumulated 变负、连累后续 offset 与 BGM 淡出/总时长定时（此类极短片段本就退化，clamp 是兜底）
      accumulated = Math.max(0, accumulated + clipDuration - fadeDuration);
    } else {
      // ai_start_end / ai_reference / direct_concat：直接拼接（不重叠）
      filterParts.push(`[${currentVideoStream}][v${i}]concat=n=2:v=1:a=0[${nextStream}]`);
      accumulated = accumulated + clipDuration;
    }
    currentVideoStream = nextStream;
  }

  // 拼接音轨（如果有带音频的片段）
  let currentAudioStream = "";
  if (hasAnyAudio && audioParts.length > 0) {
    filterParts.push(...audioParts);
    // 音轨拼接必须镜像视频转场：ffmpeg_fade 用 acrossfade 重叠 FADE_DURATION（与视频 xfade 同步缩短），
    // 其余转场直接 concat。否则音轨按全时长 concat 会比 xfade 后的视频长 0.5s/转场，造成音画渐进失步。
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

  // BGM 混音：叠加在片段音频之上
  if (config.output.bgmPath) {
    const bgmIndex = inputs.length; // 动态取当前输入数（TTS 音频可能已占用若干输入）
    inputs.push(`-i "${escapeShellPath(config.output.bgmPath)}"`);
    const vol = config.output.bgmVolume ?? 0.3;
    // 跳过前奏空白（opt-in，默认 0）：atrim 掉开头若干秒再循环
    const introSkip = config.output.bgmIntroSkipSec ?? 0;
    const introArg = introSkip > 0 ? `atrim=start=${introSkip},asetpts=PTS-STARTPTS,` : "";
    // 结尾淡出（默认 3s，落在成片总时长末尾）：避免 aloop 铺满后被 -t/amix 硬切收尾生硬，更像成片
    const fadeOut = config.output.bgmFadeOutSec ?? 3;
    const fadeArg = fadeOut > 0 ? `,afade=t=out:st=${Math.max(0, accumulated - fadeOut).toFixed(3)}:d=${fadeOut}` : "";

    if (currentAudioStream) {
      // 有片段音频：BGM 循环铺满全片（aloop，避免 BGM 短于视频时尾部没声），压低音量 + 结尾淡出后与旁白混音。
      // amix 必须 normalize=0：默认 normalize=1 会把每路按 1/inputs 缩放，等于把旁白音量腰斩到 ~50%（带货旁白要听清）。
      filterParts.push(`[${bgmIndex}:a]${introArg}aloop=loop=-1:size=2e9,volume=${vol}${fadeArg}[bgm_vol]`);
      if (config.output.bgmDuck) {
        // 旁白闪避（sidechaincompress）：旁白一响 BGM 自动压低、停顿时回升 → 旁白更清晰、间隙更饱满。
        // 旁白既作混音输入又作 sidechain 触发键，故 asplit 复制一份。opt-in，默认不开（零默认影响）。
        filterParts.push(`[${currentAudioStream}]asplit=2[nar_mix][nar_key]`);
        filterParts.push(`[bgm_vol][nar_key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[bgm_duck]`);
        filterParts.push(`[nar_mix][bgm_duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[audio_final]`);
      } else {
        filterParts.push(`[${currentAudioStream}][bgm_vol]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[audio_final]`);
      }
      currentAudioStream = "audio_final";
    } else {
      // 无片段音频：只有 BGM，同样循环铺满 + 结尾淡出（由输出 -t 截到视频时长）
      filterParts.push(`[${bgmIndex}:a]${introArg}aloop=loop=-1:size=2e9,volume=${vol}${fadeArg}[audio_final]`);
      currentAudioStream = "audio_final";
    }
  }

  // 字幕：① 卡拉OK逐字（libass 烧 ASS，opt-in）；② 否则逐句 drawtext
  if (config.subtitle?.karaokeAssPath) {
    const subtitleStream = `sub_out`;
    const fontFile = config.subtitle.fontFile ?? resolveChineseFontFile();
    // fontsdir 指向中文字体所在目录，确保 Linux 等无 CoreText 环境 libass 也能找到中文字体
    const fontsdirArg = fontFile ? `:fontsdir=${escapeSubtitlesPath(dirname(fontFile))}` : "";
    filterParts.push(`[${currentVideoStream}]subtitles=${escapeSubtitlesPath(config.subtitle.karaokeAssPath)}${fontsdirArg}[${subtitleStream}]`);
    currentVideoStream = subtitleStream;
  } else if (config.subtitle?.texts.length) {
    const subtitleStream = `sub_out`;
    // 字号按画面宽度自适应（约 5%），带货字幕需醒目；可被 config 覆盖
    const fontSize = config.subtitle.fontSize || Math.round(width * 0.05);
    const fontColor = config.subtitle.color || "white";
    const borderW = config.subtitle.strokeWidth || 3;
    // 多行安全的纵向锚点：底部按文字块底边定位（向上生长，不会越过画面底边）；居中/顶部含 text_h
    // bottom 字幕基线抬到平台底部 UI 安全区之上（避免被小黄车/进度条遮挡）。
    // 有商品卡：被「卡上字下」堆叠钉在 0.17（再高两行字幕会顶到卡）；无卡：抬到 0.22 更清出 2026 UI 区。
    const hasProductCard = !!config.productCard?.imagePath;
    const bottomRatio = hasProductCard ? CAPTION_SAFE_BOTTOM_RATIO : CAPTION_SAFE_BOTTOM_RATIO_NOCARD;
    const bottomY = (1 - bottomRatio).toFixed(2); // 有卡 0.83 / 无卡 0.78
    const yPos = config.subtitle.position === "top" ? "h*0.08" : config.subtitle.position === "center" ? "(h-text_h)/2" : `h*${bottomY}-text_h`;
    const lineSpacing = Math.round(fontSize * 0.28);
    // 中文字幕必须显式指定中文字体文件，否则渲染为方块
    const fontFile = config.subtitle.fontFile ?? resolveChineseFontFile();

    const drawTexts = config.subtitle.texts
      .map((t) => {
        // 自动换行避免英文/长文案溢出画面（drawtext 原生支持真实换行符）
        const wrapped = wrapCaption(t.text, fontSize, width);
        // 半透明底框提升可读性（带货短视频常见样式）
        return buildDrawtext({
          fontFile: fontFile || undefined,
          text: wrapped,
          fontSize,
          fontColor,
          borderW,
          lineSpacing,
          box: { color: "black@0.45", borderW: Math.round(fontSize * 0.35) },
          x: "(w-text_w)/2",
          y: yPos,
          enable: `enable='between(t,${t.startTime},${t.endTime})'`,
        });
      })
      .join(",");

    filterParts.push(`[${currentVideoStream}]${drawTexts}[${subtitleStream}]`);
    currentVideoStream = subtitleStream;
  }

  // 文字贴片：价格贴/卖点贴/标题贴（叠在画面上方，带货醒目样式）
  if (config.overlays?.length) {
    const ovFont = config.subtitle?.fontFile ?? resolveChineseFontFile();
    // 各样式：字号、字色、底框色、纵向位置（画面上方）
    const styleOf = (style: "title" | "highlight" | "price") => {
      if (style === "price")
        return { size: Math.round(width * 0.075), color: "white", box: "red@0.85", y: "h*0.12" };
      if (style === "highlight")
        return { size: Math.round(width * 0.058), color: "#1a1a1a", box: "yellow@0.9", y: "h*0.2" };
      return { size: Math.round(width * 0.06), color: "white", box: "black@0.5", y: "h*0.06" }; // title
    };
    const drawOverlays = config.overlays
      .map((o) => {
        const s = styleOf(o.style);
        const bb = Math.round(s.size * 0.4);
        return buildDrawtext({
          fontFile: ovFont || undefined,
          text: o.text,
          fontSize: s.size,
          fontColor: s.color,
          borderW: 2,
          box: { color: s.box, borderW: bb },
          x: "(w-text_w)/2",
          y: s.y,
          enable: `enable='between(t,${o.startTime},${o.endTime})'`,
        });
      })
      .join(",");
    const ovStream = "ov_out";
    filterParts.push(`[${currentVideoStream}]${drawOverlays}[${ovStream}]`);
    currentVideoStream = ovStream;
  }

  // 商品卡贴片（opt-in）：左下角统一卡片 = 商品图缩略 + 商品名 + 购买引导，开头 ~5s 展示，营造带货「挂车」感
  if (config.productCard?.imagePath) {
    const cardIdx = inputs.length;
    inputs.push(`-loop 1 -i "${escapeShellPath(config.productCard.imagePath)}"`);
    const thumb = Math.round(width * 0.16);
    const mx = Math.round(width * 0.045); // 左边距
    const pad = Math.round(width * 0.022); // 卡片内边距
    const nm = (config.productCard.name || "").trim().slice(0, 10);
    const nameAreaW = nm ? Math.round(width * 0.4) : 0;
    const cardW = thumb + (nameAreaW ? pad + nameAreaW : 0);
    // 用数值定位（避免 drawbox 不支持 H、drawtext/overlay 支持 H 的变量差异）：cardY = 画面高 - 缩略图 - 底部留白
    // 字幕基线已抬到安全区(底距 0.17)，商品卡再上移到字幕之上(底距 0.25)，保持「卡在上、字幕在下」的不重叠堆叠
    const cardY = height - thumb - Math.round(height * 0.25);
    const start = 0.4;
    const end = Math.min(5, accumulated);
    const en = `enable='between(t,${start},${end})'`;
    const cardFont = config.subtitle?.fontFile ?? resolveChineseFontFile();
    // 1) 统一卡片底：半透明深色，把缩略图与文字裹成一张卡
    filterParts.push(`[${currentVideoStream}]drawbox=x=${mx - pad}:y=${cardY - pad}:w=${cardW + 2 * pad}:h=${thumb + 2 * pad}:color=black@0.5:t=fill:${en}[pcard_bg]`);
    currentVideoStream = "pcard_bg";
    // 2) 商品图缩略（等比填充裁成正方形）
    filterParts.push(`[${cardIdx}:v]scale=${thumb}:${thumb}:force_original_aspect_ratio=increase,crop=${thumb}:${thumb},setsar=1[pcard]`);
    filterParts.push(`[${currentVideoStream}][pcard]overlay=${mx}:${cardY}:${en}[pcard_v]`);
    currentVideoStream = "pcard_v";
    // 3) 商品名（白）+ 价格（红，醒目）+ 黄色购买引导，缩略图右侧三行
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

  // 响度归一到社媒标准（~-14 LUFS，EBU R128 / loudnorm）：跨视频音量一致，避免忽大忽小被抖音/TikTok 二次压制。
  // 置于音频链末端、单趟动态归一；无任何音频流则跳过。
  if (currentAudioStream) {
    filterParts.push(`[${currentAudioStream}]loudnorm=I=-14:TP=-1.5:LRA=11[audio_norm]`);
    currentAudioStream = "audio_norm";
  }

  // 构建完整命令
  const inputStr = inputs.join(" ");
  const filterStr = filterParts.join(";\n");

  let cmd = `"${ffmpegBin()}" -y ${inputStr} -filter_complex "${filterStr}" -map "[${currentVideoStream}]"`;

  // 映射音频输出
  if (currentAudioStream) {
    cmd += ` -map "[${currentAudioStream}]"`;
  }

  // 优化的编码参数
  // 渲染质量预设：分辨率在上方已按 preset 决定，这里用 preset 的编码速度/质量（白名单兜底防注入）
  const enc = safeEncodeParams(config.output.videoPreset, config.output.crf);
  cmd += ` -c:v libx264 -preset ${enc.videoPreset} -crf ${enc.crf} -profile:v high -level:v 4.2 -pix_fmt yuv420p`;
  // AIGC 隐式标识（GB 45438-2025）：把「生成合成标签+服务提供者+内容制作编号」写进文件元数据，与画面显式标识互补。
  // 纯 -metadata，不影响 filter_complex；内容编号用 projectId 派生（确定性、可 ffprobe 断言）。
  const aigcArgs = buildAigcMetadataArgs({ contentId: config.projectId });
  // 显式限定输出时长为视频真实时间轴(accumulated)：xfade 重叠后视频比朴素累计短，避免尾部音频盖在冻结帧上
  cmd += ` -c:a aac -b:a 256k -movflags +faststart ${aigcArgs} -t ${accumulated.toFixed(3)} "${escapeShellPath(outputPath)}"`;

  return cmd;
}

/** 合成的最长时长（毫秒）：超过即杀进程，避免某次渲染卡死无限占用机器 */
export const COMPOSE_TIMEOUT_MS = 10 * 60 * 1000;

/** 把 ffmpeg 合成的底层错误归类成可操作提示（纯函数，可单测）；非已知类返回 null（原样抛） */
export function composeErrorMessage(e: { killed?: boolean; signal?: string; stderr?: string; message?: string }): string | null {
  if (e.killed || e.signal === "SIGTERM") return "视频合成超时（已超过 10 分钟）——可能分镜过多或机器繁忙，请减少分镜或降到「快速」画质重试";
  const msg = `${e.stderr || ""} ${e.message || ""}`;
  if (/no space left|ENOSPC/i.test(msg)) return "磁盘空间不足，无法写出成片——请清理磁盘后重试";
  return null;
}

// 执行合成
export async function composeVideo(config: ComposeConfig): Promise<string> {
  const outputDir = join(getDataDir(), "output", config.projectId);
  await mkdir(outputDir, { recursive: true });

  const cmd = buildComposeCommand(config);

  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    // 加超时（超过即 SIGTERM 杀进程）；磁盘满/超时归类成可读错误
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: COMPOSE_TIMEOUT_MS });
  } catch (e) {
    const friendly = composeErrorMessage(e as { killed?: boolean; signal?: string; stderr?: string; message?: string });
    if (friendly) throw new Error(friendly);
    throw e;
  }

  // 从命令中提取输出路径
  const outputMatch = cmd.match(/"([^"]*final_[^"]*\.mp4)"/);
  return outputMatch ? outputMatch[1] : "";
}
