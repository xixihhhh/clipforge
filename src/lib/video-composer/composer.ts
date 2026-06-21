import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { TRANSITIONS, type TransitionMode } from "./transitions";
import { MOTIONS, DEFAULT_MOTION } from "./motions";
import { safeEncodeParams } from "@/lib/compose-presets";

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
    .replace(/%/g, "\\\\%")       // 百分号（FFmpeg 时间格式占位符）
    .replace(/\[/g, "\\\\[")      // 方括号（FFmpeg filter 流标记）
    .replace(/\]/g, "\\\\]");
}

/** 判断是否为 CJK（中日韩）字符——用于估算字宽与换行策略 */
function isCJK(ch: string): boolean {
  return /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch);
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
  };
  /** 文字贴片：价格贴/卖点贴/标题贴，叠在画面上方区域（带货常见样式） */
  overlays?: {
    text: string;
    style: "title" | "highlight" | "price";
    startTime: number;
    endTime: number;
  }[];
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
      filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,trim=end_frame=1,setpts=PTS-STARTPTS,${motion.getFilter(width, height, clip.duration)},setpts=PTS-STARTPTS,${SEGMENT_NORM}[v${i}]`);
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
      // xfade 会重叠 fadeDuration，故累计时长加上新片段后要减去重叠部分
      accumulated = accumulated + clipDuration - fadeDuration;
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

    if (currentAudioStream) {
      // 有片段音频：BGM 和片段音频混合，片段音频优先（BGM 自动压低）
      filterParts.push(`[${bgmIndex}:a]volume=${vol}[bgm_vol]`);
      filterParts.push(`[${currentAudioStream}][bgm_vol]amix=inputs=2:duration=first:dropout_transition=2[audio_final]`);
      currentAudioStream = "audio_final";
    } else {
      // 无片段音频：只有 BGM
      filterParts.push(`[${bgmIndex}:a]volume=${vol}[audio_final]`);
      currentAudioStream = "audio_final";
    }
  }

  // 字幕
  if (config.subtitle?.texts.length) {
    const subtitleStream = `sub_out`;
    // 字号按画面宽度自适应（约 5%），带货字幕需醒目；可被 config 覆盖
    const fontSize = config.subtitle.fontSize || Math.round(width * 0.05);
    const fontColor = config.subtitle.color || "white";
    const borderW = config.subtitle.strokeWidth || 3;
    // 多行安全的纵向锚点：底部按文字块底边定位（向上生长，不会越过画面底边）；居中/顶部含 text_h
    const yPos = config.subtitle.position === "top" ? "h*0.08" : config.subtitle.position === "center" ? "(h-text_h)/2" : "h*0.88-text_h";
    const lineSpacing = Math.round(fontSize * 0.28);
    // 半透明底框，提升可读性（带货短视频常见样式）
    const boxArg = `box=1:boxcolor=black@0.45:boxborderw=${Math.round(fontSize * 0.35)}:`;

    // 中文字幕必须显式指定中文字体文件，否则渲染为方块
    const fontFile = config.subtitle.fontFile ?? resolveChineseFontFile();
    const fontFileArg = fontFile ? `fontfile='${escapeDrawText(fontFile)}':` : "";

    const drawTexts = config.subtitle.texts
      .map((t) => {
        // 自动换行避免英文/长文案溢出画面（drawtext 原生支持真实换行符）
        const wrapped = wrapCaption(t.text, fontSize, width);
        return `drawtext=${fontFileArg}text='${escapeDrawText(wrapped)}':fontsize=${fontSize}:fontcolor=${fontColor}:borderw=${borderW}:line_spacing=${lineSpacing}:${boxArg}x=(w-text_w)/2:y=${yPos}:enable='between(t,${t.startTime},${t.endTime})'`;
      })
      .join(",");

    filterParts.push(`[${currentVideoStream}]${drawTexts}[${subtitleStream}]`);
    currentVideoStream = subtitleStream;
  }

  // 文字贴片：价格贴/卖点贴/标题贴（叠在画面上方，带货醒目样式）
  if (config.overlays?.length) {
    const ovFont = config.subtitle?.fontFile ?? resolveChineseFontFile();
    const ovFontArg = ovFont ? `fontfile='${escapeDrawText(ovFont)}':` : "";
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
        return `drawtext=${ovFontArg}text='${escapeDrawText(o.text)}':fontsize=${s.size}:fontcolor=${s.color}:borderw=2:box=1:boxcolor=${s.box}:boxborderw=${bb}:x=(w-text_w)/2:y=${s.y}:enable='between(t,${o.startTime},${o.endTime})'`;
      })
      .join(",");
    const ovStream = "ov_out";
    filterParts.push(`[${currentVideoStream}]${drawOverlays}[${ovStream}]`);
    currentVideoStream = ovStream;
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
  // 显式限定输出时长为视频真实时间轴(accumulated)：xfade 重叠后视频比朴素累计短，避免尾部音频盖在冻结帧上
  cmd += ` -c:a aac -b:a 256k -movflags +faststart -t ${accumulated.toFixed(3)} "${escapeShellPath(outputPath)}"`;

  return cmd;
}

// 执行合成
export async function composeVideo(config: ComposeConfig): Promise<string> {
  const outputDir = join(getDataDir(), "output", config.projectId);
  await mkdir(outputDir, { recursive: true });

  const cmd = buildComposeCommand(config);

  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

  // 从命令中提取输出路径
  const outputMatch = cmd.match(/"([^"]*final_[^"]*\.mp4)"/);
  return outputMatch ? outputMatch[1] : "";
}
