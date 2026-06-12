/**
 * 转场策略
 * 核心思路：用 AI 首尾帧拼接实现自然过渡，而非 FFmpeg 模板转场
 *
 * 工作流程：
 * 1. 生成第一个片段的视频
 * 2. 提取最后一帧作为"结束帧"
 * 3. 生成下一个片段的"开始帧"（可以是 AI 生图或商品图）
 * 4. 用支持首尾帧的模型（Vidu start-end / Kling start-end）生成过渡片段
 * 5. 或者直接让 AI 在生成下一个片段时以上一个片段的最后一帧为参考
 */

// 转场模式
export type TransitionMode =
  | "ai_start_end"    // AI 首尾帧过渡（推荐，效果最好）
  | "ai_reference"    // AI 参考上一帧生成（次选）
  | "direct_concat"   // 直接拼接（硬切）
  | "ffmpeg_fade";    // FFmpeg 淡入淡出（保底方案）

export interface TransitionConfig {
  mode: TransitionMode;
  label: string;
  description: string;
  // 支持该转场模式的模型
  supportedModels: string[];
}

// 转场方案列表
export const TRANSITIONS: Record<TransitionMode, TransitionConfig> = {
  ai_start_end: {
    mode: "ai_start_end",
    label: "AI 智能过渡",
    description: "提取前一片段最后一帧和后一片段首帧，用 AI 生成自然转场视频",
    supportedModels: [
      // Seedance 2.0（支持首帧 image + 尾帧 last_image）
      "bytedance/seedance-2.0/image-to-video",
      "bytedance/seedance-2.0-fast/image-to-video",
      // Vidu Q3 系列
      "vidu/q3-pro/start-end-to-video",
      "vidu/q3-turbo/start-end-to-video",
      "vidu/start-end-to-video-2.0",
    ],
  },
  ai_reference: {
    mode: "ai_reference",
    label: "AI 参考过渡",
    description: "将前一片段最后一帧作为参考图，生成下一个片段时自动衔接",
    supportedModels: [
      // Kling 3.0 O3 系列（最新）
      "kwaivgi/kling-video-o3-pro/reference-to-video",
      "kwaivgi/kling-video-o3-std/reference-to-video",
      // Kling 3.0 Pro/Std
      "kwaivgi/kling-v3.0-pro/image-to-video",
      "kwaivgi/kling-v3.0-std/image-to-video",
      // Google Veo 3.1
      "google/veo3.1/reference-to-video",
      "google/veo3.1/image-to-video",
      // Vidu
      "vidu/reference-to-video-q1",
      "vidu/reference-to-video-2.0",
      // Seedance 2.0（多模态参考生视频）
      "bytedance/seedance-2.0/reference-to-video",
      "bytedance/seedance-2.0-fast/reference-to-video",
      // Seedance v1.5
      "bytedance/seedance-v1.5-pro/image-to-video",
      // Wan 2.6
      "alibaba/wan-2.6/image-to-video",
    ],
  },
  direct_concat: {
    mode: "direct_concat",
    label: "直接拼接",
    description: "硬切，无转场效果",
    supportedModels: [],
  },
  ffmpeg_fade: {
    mode: "ffmpeg_fade",
    label: "淡入淡出",
    description: "FFmpeg 淡入淡出效果（保底方案）",
    supportedModels: [],
  },
};

// 获取转场列表
export function getTransitionList(): TransitionConfig[] {
  return Object.values(TRANSITIONS);
}

// 根据用户已配置的 Provider 推荐最佳转场方案
export function recommendTransition(availableModels: string[]): TransitionMode {
  // 优先用 AI 首尾帧
  const hasStartEnd = TRANSITIONS.ai_start_end.supportedModels.some((m) =>
    availableModels.includes(m)
  );
  if (hasStartEnd) return "ai_start_end";

  // 次选 AI 参考
  const hasReference = TRANSITIONS.ai_reference.supportedModels.some((m) =>
    availableModels.includes(m)
  );
  if (hasReference) return "ai_reference";

  // 保底淡入淡出
  return "ffmpeg_fade";
}
