import type { NamespaceMessages } from "../config";

// generationSettings 命名空间词条：设置页「高级」里的自定义模型接入点 / 生成参数面板
export const generationSettings: NamespaceMessages = {
  zh: {
    // 媒体类型
    mediaImage: "生图",
    mediaVideo: "生视频",
    platformDefault: "平台默认",

    // 自定义模型接入点
    customModelTitle: "自定义模型接入点",
    customModelDesc:
      "在已有平台上挂任意 model id，添加后即可在上方「默认生图/生视频模型」里选用（平台 Key 复用「AI 平台」配置）。",
    fieldProvider: "归属平台",
    fieldType: "类型",
    fieldModelId: "model id",
    modelIdPlaceholder: "如 fal-ai/flux-pro/v1.1",
    fieldName: "显示名（选填）",
    namePlaceholder: "不填则用 model id",
    audioCheckbox: "该视频模型原生带音频（可省 TTS）",
    addModel: "添加模型",
    audioSuffix: " · 带音频",
    delete: "删除",

    // 生成参数
    genParamsTitle: "生成参数（全局默认）",
    genParamsDesc: "生成图片/动态镜头时统一使用，留空的数值项走对应模型默认。",
    imageSection: "图片",
    aspectRatio: "画面比例",
    aspect916: "9:16 竖屏",
    aspect169: "16:9 横屏",
    aspect11: "1:1 方形",
    count: "生成数量",
    steps: "推理步数",
    guidanceScale: "引导系数",
    seed: "随机种子",
    seedPlaceholder: "随机",
    negativePrompt: "反向提示词（选填）",
    imageNegativePlaceholder: "不希望出现的元素，如 模糊、文字、水印",
    videoSection: "视频（转动态镜头）",
    resolution: "分辨率",
    duration: "时长（秒）",
    fps: "帧率 fps",
    motionStrength: "运动强度",
    videoNegativePlaceholder: "不希望出现的元素",
  },
  en: {
    // Media types
    mediaImage: "Image",
    mediaVideo: "Video",
    platformDefault: "Platform default",

    // Custom model endpoints
    customModelTitle: "Custom model endpoints",
    customModelDesc:
      "Attach any model id to an existing platform; once added it's selectable under \"Default image/video model\" above (the platform key is reused from \"AI platforms\").",
    fieldProvider: "Platform",
    fieldType: "Type",
    fieldModelId: "model id",
    modelIdPlaceholder: "e.g. fal-ai/flux-pro/v1.1",
    fieldName: "Display name (optional)",
    namePlaceholder: "Defaults to the model id",
    audioCheckbox: "This video model has native audio (skips TTS)",
    addModel: "Add model",
    audioSuffix: " · with audio",
    delete: "Delete",

    // Generation params
    genParamsTitle: "Generation params (global defaults)",
    genParamsDesc:
      "Applied to all image/motion-shot generation; blank numeric fields fall back to each model's default.",
    imageSection: "Image",
    aspectRatio: "Aspect ratio",
    aspect916: "9:16 portrait",
    aspect169: "16:9 landscape",
    aspect11: "1:1 square",
    count: "Count",
    steps: "Inference steps",
    guidanceScale: "Guidance scale",
    seed: "Seed",
    seedPlaceholder: "Random",
    negativePrompt: "Negative prompt (optional)",
    imageNegativePlaceholder: "Elements to avoid, e.g. blur, text, watermark",
    videoSection: "Video (motion shots)",
    resolution: "Resolution",
    duration: "Duration (s)",
    fps: "Frame rate (fps)",
    motionStrength: "Motion strength",
    videoNegativePlaceholder: "Elements to avoid",
  },
};
