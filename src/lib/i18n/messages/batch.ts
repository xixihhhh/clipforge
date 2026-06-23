import type { NamespaceMessages } from "../config";

// batch 命名空间词条（zh 为原文，en 为翻译）
export const batch: NamespaceMessages = {
  zh: {
    // 顶部导航
    navTitle: "批量出片",
    // 页面标题
    heroTitle: "批量出片",
    heroSubtitle: "选择多个商品并统一配置，一键批量生成带货视频",
    // 视频模式选项
    modeProductCloseup: "产品特写",
    modeGraphicMontage: "图文混剪",
    modeSceneDemo: "场景演示",
    modeLivePresenter: "真人出镜",
    // 脚本风格选项
    stylePainPoint: "痛点种草",
    styleScenario: "场景安利",
    styleComparison: "对比测评",
    styleStory: "剧情故事",
    styleAuto: "智能推荐",
    // 品类标签
    categoryHome: "家居日用",
    categoryTech: "数码3C",
    categoryBeauty: "美妆护肤",
    categoryFood: "食品零食",
    categoryFashion: "服饰鞋包",
    categoryOther: "其他",
    // 任务状态
    taskPending: "等待中",
    taskGenerating: "生成中",
    taskComposing: "出片中",
    taskDone: "已完成",
    taskFailed: "失败",
    // 错误/接口提示
    errorNoLlm: "尚未配置 LLM，无法生成脚本",
    errorNoLlmCta: "前往设置填 Key →",
    errorProjectCreate: "项目创建失败",
    errorScriptFailed: "脚本生成失败",
    errorComposeFailed: "合成失败",
    errorGenerateFailed: "生成失败",
    projectNameSuffix: "{name} 推广",
    // 步骤 1
    step1Label: "步骤 1：选择商品",
    step1Selected: "已选 {selected}/{total} 个商品",
    emptyHint: "商品库还是空的，导入示例商品即可马上体验批量出片",
    importExamples: "导入示例商品",
    goToProducts: "前往商品库",
    // 步骤 2
    step2Label: "步骤 2：统一配置",
    videoModeLabel: "视频模式",
    scriptStyleLabel: "脚本风格",
    durationLabel: "目标时长",
    autoComposeLabel: "生成脚本后自动配画面 + 合成成片（免费，全程 0 Key）",
    productCardLabel: "左下角叠商品卡贴片（商品图+名+价+购买引导）",
    // 生成进度
    progressLabel: "生成进度",
    progressDone: "{done}/{total} 已完成",
    taskView: "查看",
    taskViewVideo: "看成片",
    completeMsg: "批量生成完成！共 {count} 条视频",
    // 底部操作栏
    ctaGenerating: "批量生成中...",
    ctaAgain: "生成完成，再来一批",
    ctaStart: "开始批量生成",
    hintWillGenerate: "将为 {count} 个商品批量生成带货视频",
    hintSelectAtLeastOne: "请先选择至少 1 个商品",
  },
  en: {
    // 顶部导航
    navTitle: "Batch production",
    // 页面标题
    heroTitle: "Batch production",
    heroSubtitle: "Select multiple products, set shared options, and generate commerce videos in one click",
    // 视频模式选项
    modeProductCloseup: "Product close-up",
    modeGraphicMontage: "Graphic montage",
    modeSceneDemo: "Scene demo",
    modeLivePresenter: "Live presenter",
    // 脚本风格选项
    stylePainPoint: "Pain point",
    styleScenario: "Scenario pitch",
    styleComparison: "Comparison review",
    styleStory: "Story-driven",
    styleAuto: "Smart pick",
    // 品类标签
    categoryHome: "Home goods",
    categoryTech: "Tech & gadgets",
    categoryBeauty: "Beauty & skincare",
    categoryFood: "Food & snacks",
    categoryFashion: "Fashion & bags",
    categoryOther: "Other",
    // 任务状态
    taskPending: "Pending",
    taskGenerating: "Generating",
    taskComposing: "Rendering",
    taskDone: "Done",
    taskFailed: "Failed",
    // 错误/接口提示
    errorNoLlm: "No LLM configured — can't generate scripts.",
    errorNoLlmCta: "Add your API key in Settings →",
    errorProjectCreate: "Failed to create project",
    errorScriptFailed: "Script generation failed",
    errorComposeFailed: "Render failed",
    errorGenerateFailed: "Generation failed",
    projectNameSuffix: "{name} promo",
    // 步骤 1
    step1Label: "Step 1: Select products",
    step1Selected: "{selected}/{total} selected",
    emptyHint: "Your product library is empty — import sample products to try batch production right away",
    importExamples: "Import sample products",
    goToProducts: "Go to products",
    // 步骤 2
    step2Label: "Step 2: Shared settings",
    videoModeLabel: "Video mode",
    scriptStyleLabel: "Script style",
    durationLabel: "Target duration",
    autoComposeLabel: "Auto-fill footage + render the video after scripting (free, 0 API key)",
    productCardLabel: "Overlay a product card (image + name + price + buy CTA)",
    // 生成进度
    progressLabel: "Progress",
    progressDone: "{done}/{total} done",
    taskView: "View",
    taskViewVideo: "View video",
    completeMsg: "Batch generation complete! {count} videos created",
    // 底部操作栏
    ctaGenerating: "Generating batch...",
    ctaAgain: "Done — run another batch",
    ctaStart: "Start batch generation",
    hintWillGenerate: "Will generate commerce videos for {count} products",
    hintSelectAtLeastOne: "Select at least 1 product first",
  },
};
