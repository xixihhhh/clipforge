import type { NamespaceMessages } from "../config";

// script 命名空间词条（zh 为原文，en 为翻译）
export const script: NamespaceMessages = {
  zh: {
    // 镜头类型标签
    shotTypeHook: "钩子",
    shotTypePainPoint: "痛点",
    shotTypeProductReveal: "产品",
    shotTypeDemo: "演示",
    shotTypeSocialProof: "背书",
    shotTypeCta: "转化",
    // 脚本风格
    stylePainPoint: "痛点种草",
    styleScene: "场景安利",
    styleComparison: "对比测评",
    styleStory: "剧情故事",
    // 通用
    defaultProjectName: "带货项目",
    untitledScript: "未命名脚本",
    // 生成相关错误
    errorNoLlm: "尚未配置 LLM，请先到「设置」填写 API Key",
    errorGenFailedCheckLlm: "脚本生成失败，请检查 LLM 设置",
    errorGenFailed: "脚本生成失败",
    // 加载/空态
    loadingScripts: "正在加载脚本...",
    emptyTitle: "还没有生成脚本",
    emptyDesc: "「{name}」尚未生成脚本，或上次生成失败。点击下方按钮，AI 将根据你的商品信息重新生成。",
    emptyDescThisProject: "该项目",
    generateScript: "生成脚本",
    backToProjects: "返回项目列表",
    // 步骤进度
    stepScript: "脚本",
    stepAssets: "素材",
    stepVideo: "视频",
    stepExport: "导出",
    // 脚本方案区
    scriptOptions: "脚本方案",
    savedAsTemplate: "已保存为模板",
    saveAsTemplate: "存为模板",
    regenerate: "重新生成",
    regenConfirmTitle: "重新生成会替换当前脚本",
    regenConfirmDesc: "当前脚本（及其多个备选方案）将被新生成的内容覆盖，且无法恢复。建议先把满意的版本「存为模板」再继续。",
    regenConfirmOk: "确认替换",
    regenConfirmCancel: "取消",
    shotCount: "{n} 个镜头",
    adComplianceTitle: "广告法合规提醒（{n} 处风险词）",
    adComplianceHint: "脚本含可能违反《广告法》的风险词，发布易被限流/下架。鼠标悬停查看修改建议，建议生成素材前先改。",
    readinessTitle: "发布前自检",
    readinessReady: "可发布",
    readinessRisky: "有风险",
    readinessNeedsWork: "建议先改",
    // Tabs
    tabTimeline: "分镜时间线",
    tabText: "文案编辑",
    nextStepAssets: "下一步：生成素材",
    // 画面来源
    visualProductImage: "📷 商品原图",
    visualAiGenerate: "✨ AI 生成",
    visualUserUpload: "📁 用户上传",
    productImageShort: "商品图",
    // 文案编辑
    fullVoiceover: "完整配音文案",
    statsChars: "总字数：{n} 字",
    statsDuration: "预计时长：{n}s",
    statsSpeed: "语速：约 {n} 字/秒",
    textReadOnlyHint: "此处为全文预览。要修改某句口播或画面描述，请在「分镜时间线」里对应分镜点「编辑」。",
    // 分镜行内编辑
    editShot: "编辑",
    editVoiceoverLabel: "口播文案",
    editDescriptionLabel: "画面描述",
    editSaved: "已保存",
    editSaveFailed: "保存失败，请重试",
    selectionSaved: "已选用该方案",
    // 一键成片
    autoFinish: "一键成片",
    autoFinishHint: "自动完成剩余步骤：配画面 → 配音合成 → 直达导出（全程免 Key）",
    autoFinishSelecting: "确认脚本…",
    autoFinishAssets: "配画面中…",
    autoFinishComposing: "合成中…",
    autoFinishFailed: "自动成片失败，可改用「下一步」手动逐步完成",
    // 保存模板弹窗
    saveTemplateTitle: "保存为模板",
    saveTemplateDesc: "保存当前脚本结构为模板，下次可直接套用到其他商品",
    templateNamePlaceholder: "模板名称，如：痛点种草-美妆通用",
  },
  en: {
    // 镜头类型标签
    shotTypeHook: "Hook",
    shotTypePainPoint: "Pain point",
    shotTypeProductReveal: "Product",
    shotTypeDemo: "Demo",
    shotTypeSocialProof: "Proof",
    shotTypeCta: "CTA",
    // 脚本风格
    stylePainPoint: "Pain-point pitch",
    styleScene: "Scene-based",
    styleComparison: "Comparison review",
    styleStory: "Story-driven",
    // 通用
    defaultProjectName: "Commerce project",
    untitledScript: "Untitled script",
    // 生成相关错误
    errorNoLlm: "No LLM configured — add your API key in Settings first",
    errorGenFailedCheckLlm: "Script generation failed — check your LLM settings",
    errorGenFailed: "Script generation failed",
    // 加载/空态
    loadingScripts: "Loading scripts...",
    emptyTitle: "No script yet",
    emptyDesc: "“{name}” has no script yet, or the last run failed. Click below and AI will regenerate one from your product info.",
    emptyDescThisProject: "this project",
    generateScript: "Generate script",
    backToProjects: "Back to projects",
    // 步骤进度
    stepScript: "Script",
    stepAssets: "Assets",
    stepVideo: "Video",
    stepExport: "Export",
    // 脚本方案区
    scriptOptions: "Script options",
    savedAsTemplate: "Saved as template",
    saveAsTemplate: "Save as template",
    regenerate: "Regenerate",
    regenConfirmTitle: "Regenerating will replace the current script",
    regenConfirmDesc: "The current script (and all its alternative variants) will be overwritten by the new generation and cannot be recovered. Consider saving the version you like as a template first.",
    regenConfirmOk: "Replace",
    regenConfirmCancel: "Cancel",
    shotCount: "{n} shots",
    adComplianceTitle: "Ad-compliance check ({n} risky terms)",
    adComplianceHint: "The script contains terms that may violate ad regulations and risk takedown/throttling. Hover a term for a fix suggestion — best to edit before generating assets.",
    readinessTitle: "Pre-publish check",
    readinessReady: "Ready",
    readinessRisky: "Has risks",
    readinessNeedsWork: "Fix first",
    // Tabs
    tabTimeline: "Shot timeline",
    tabText: "Edit copy",
    nextStepAssets: "Next: generate assets",
    // 画面来源
    visualProductImage: "📷 Product photo",
    visualAiGenerate: "✨ AI-generated",
    visualUserUpload: "📁 User upload",
    productImageShort: "Product",
    // 文案编辑
    fullVoiceover: "Full voiceover script",
    statsChars: "Characters: {n}",
    statsDuration: "Est. duration: {n}s",
    statsSpeed: "Pace: ~{n} chars/s",
    textReadOnlyHint: "This is a full-text preview. To edit a line or a shot description, use Edit on that shot in the timeline.",
    // 分镜行内编辑
    editShot: "Edit",
    editVoiceoverLabel: "Voiceover",
    editDescriptionLabel: "Visual description",
    editSaved: "Saved",
    editSaveFailed: "Save failed, please retry",
    selectionSaved: "Variant selected",
    // one-click auto-finish
    autoFinish: "Auto-finish",
    autoFinishHint: "Auto-complete the rest: match footage → voiceover & compose → straight to export (fully key-free)",
    autoFinishSelecting: "Confirming script…",
    autoFinishAssets: "Matching footage…",
    autoFinishComposing: "Composing…",
    autoFinishFailed: "Auto-finish failed — use “Next” to complete the steps manually",
    // 保存模板弹窗
    saveTemplateTitle: "Save as template",
    saveTemplateDesc: "Save this script structure as a template to reuse on other products",
    templateNamePlaceholder: "Template name, e.g. Pain-point pitch - Beauty",
  },
};
