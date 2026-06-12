import { join } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { TRANSITIONS, type TransitionMode } from "./transitions";
import { MOTIONS } from "./motions";

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
}

export interface ClipInput {
  type: "video" | "image"; // 视频片段或静态图+运动
  filePath: string;
  duration: number; // 秒
  transition: string; // 转场类型
  motion?: string; // 仅 image 类型，运动效果
  /** 该片段是否包含原生音频（模型生成的带配音视频） */
  hasAudio?: boolean;
}

// 分辨率映射
const RESOLUTIONS: Record<string, Record<string, { width: number; height: number }>> = {
  "9:16": { "720p": { width: 720, height: 1280 }, "1080p": { width: 1080, height: 1920 } },
  "16:9": { "720p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 } },
  "1:1": { "720p": { width: 720, height: 720 }, "1080p": { width: 1080, height: 1080 } },
};

// 生成 FFmpeg 合成命令
export function buildComposeCommand(config: ComposeConfig): string {
  const { width, height } = RESOLUTIONS[config.output.aspectRatio][config.output.resolution];
  const outputDir = join(process.cwd(), "data", "output", config.projectId);
  const outputPath = join(outputDir, `final_${Date.now()}.mp4`);

  const inputs: string[] = [];
  const filterParts: string[] = [];

  // 判断是否有任何片段带音频
  const hasAnyAudio = config.clips.some((c) => c.hasAudio);

  // 处理每个片段
  config.clips.forEach((clip, i) => {
    if (clip.type === "image" && clip.motion) {
      // 商品原图 + 运动效果
      const motion = MOTIONS[clip.motion];
      if (motion) {
        inputs.push(`-loop 1 -t ${clip.duration} -i "${escapeShellPath(clip.filePath)}"`);
        filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,${motion.getFilter(width, height, clip.duration)},setpts=PTS-STARTPTS[v${i}]`);
      }
    } else {
      // 视频片段
      inputs.push(`-i "${escapeShellPath(clip.filePath)}"`);
      filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS[v${i}]`);
    }
  });

  // 音频处理：有原生音频的片段提取音轨，无音频的生成静音
  const audioParts: string[] = [];
  if (hasAnyAudio) {
    config.clips.forEach((clip, i) => {
      if (clip.hasAudio && clip.type === "video") {
        // 提取该片段的原生音轨
        audioParts.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        // 生成等时长的静音音轨（使用 lavfi 虚拟输入）
        audioParts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`);
      }
    });
  }

  // 拼接视频转场
  let currentVideoStream = "v0";
  for (let i = 1; i < config.clips.length; i++) {
    const transitionMode = config.clips[i].transition as TransitionMode;
    const nextStream = `xfade${i}`;

    if (transitionMode === "ffmpeg_fade") {
      const fadeDuration = 0.5;
      const prevDuration = config.clips[i - 1].duration;
      const offset = prevDuration - fadeDuration;
      filterParts.push(
        `[${currentVideoStream}][v${i}]xfade=transition=fade:duration=${fadeDuration}:offset=${offset}[${nextStream}]`
      );
    } else {
      // ai_start_end / ai_reference / direct_concat：直接拼接
      filterParts.push(`[${currentVideoStream}][v${i}]concat=n=2:v=1:a=0[${nextStream}]`);
    }
    currentVideoStream = nextStream;
  }

  // 拼接音轨（如果有带音频的片段）
  let currentAudioStream = "";
  if (hasAnyAudio && audioParts.length > 0) {
    filterParts.push(...audioParts);
    // 按顺序拼接所有音轨
    const audioInputs = config.clips.map((_, i) => `[a${i}]`).join("");
    const concatAudioStream = "aconcat_out";
    filterParts.push(`${audioInputs}concat=n=${config.clips.length}:v=0:a=1[${concatAudioStream}]`);
    currentAudioStream = concatAudioStream;
  }

  // BGM 混音：叠加在片段音频之上
  if (config.output.bgmPath) {
    const bgmIndex = config.clips.length; // BGM 作为最后一个输入
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
    const fontSize = config.subtitle.fontSize || 36;
    const fontColor = config.subtitle.color || "white";
    const borderW = config.subtitle.strokeWidth || 2;
    const yPos = config.subtitle.position === "top" ? "h*0.1" : config.subtitle.position === "center" ? "(h-text_h)/2" : "h*0.85";

    // 中文字幕必须显式指定中文字体文件，否则渲染为方块
    const fontFile = config.subtitle.fontFile ?? resolveChineseFontFile();
    const fontFileArg = fontFile ? `fontfile='${escapeDrawText(fontFile)}':` : "";

    const drawTexts = config.subtitle.texts
      .map(
        (t) =>
          `drawtext=${fontFileArg}text='${escapeDrawText(t.text)}':fontsize=${fontSize}:fontcolor=${fontColor}:borderw=${borderW}:x=(w-text_w)/2:y=${yPos}:enable='between(t,${t.startTime},${t.endTime})'`
      )
      .join(",");

    filterParts.push(`[${currentVideoStream}]${drawTexts}[${subtitleStream}]`);
    currentVideoStream = subtitleStream;
  }

  // 构建完整命令
  const inputStr = inputs.join(" ");
  const filterStr = filterParts.join(";\n");

  let cmd = `ffmpeg -y ${inputStr} -filter_complex "${filterStr}" -map "[${currentVideoStream}]"`;

  // 映射音频输出
  if (currentAudioStream) {
    cmd += ` -map "[${currentAudioStream}]"`;
  }

  // 优化的编码参数
  cmd += ` -c:v libx264 -preset medium -crf 18 -profile:v high -level:v 4.2 -pix_fmt yuv420p`;
  cmd += ` -c:a aac -b:a 256k -movflags +faststart "${escapeShellPath(outputPath)}"`;

  return cmd;
}

// 执行合成
export async function composeVideo(config: ComposeConfig): Promise<string> {
  const outputDir = join(process.cwd(), "data", "output", config.projectId);
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
