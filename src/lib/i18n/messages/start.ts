import type { NamespaceMessages } from "../config";

// start 命名空间词条（落地页「先做后配」/start）
export const start: NamespaceMessages = {
  zh: {
    // 顶部导航
    navProducts: "商品库",
    navBatch: "批量",
    navSettings: "设置",
    // 主视觉
    eyebrow: "AI 带货短视频工作台",
    h1Lead: "丢张商品图，",
    h1Highlight: "直接出片",
    sub: "上传商品图，或说一句话主题。AI 自动写脚本、配画面、配音，合成竖屏成片——先开跑，要用到 AI 时再配 Key。",
    // 模式切换
    tabUpload: "上传商品图",
    tabLink: "商品链接",
    tabTopic: "一句话成片",
    // 商品链接模式
    linkPlaceholder: "粘贴商品链接（淘宝/京东/拼多多/1688/独立站…）",
    linkHint: "自动抓取商品标题、价格、主图，直接建项目并写带货脚本",
    linkProductFallback: "导入的商品",
    // 上传模式
    dropTitle: "拖入商品图，或点击上传",
    dropSub: "JPG / PNG，最多 5 张 · 没素材？下面点个示例",
    imgAlt: "商品图",
    removeAria: "删除",
    productNamePlaceholder: "商品名称（必填，如：便携榨汁杯）",
    sellingPointsPlaceholder: "核心卖点（选填）——填了脚本更精准",
    // 一句话模式
    topicPlaceholder: "说个主题，如：3 个让租房变高级的小物 / 冬天必囤的护手霜",
    // 未配 Key 提示
    keyboxText: "还没配 Key？脚本/画面需要先接一个 AI 平台。推荐 Atlas Cloud——一个 Key 搞定脚本+图+视频+配音。",
    keyboxCta: "去配置",
    // Atlas 一键接入（落地页内联，免跳设置）
    atlasBadge: "一个 Key",
    atlasTitle: "接入 Atlas Cloud，立即开跑",
    atlasDesc: "脚本 + 图 + 视频 + 配音都用它，模型已自动选好。",
    atlasGetKey: "没有 Key？1 分钟免费获取",
    atlasKeyPlaceholder: "粘贴 Atlas Cloud API Key",
    atlasConnectStart: "连接并开始",
    atlasConnecting: "连接中…",
    atlasUseOther: "想用别的平台（OpenAI / DeepSeek…）？前往完整设置",
    atlasKeyInvalid: "Key 无效或无权限，请检查后重试",
    atlasConnectFailed: "连接失败，请检查网络后重试",
    atlasDismiss: "稍后再说",
    // 主按钮 + 安心文案
    ctaStart: "开始生成",
    busyDefault: "生成中…",
    reassureLead: "还没配 Key？开始时一键接 ",
    reassureTail: "——脚本 + 图 + 视频 + 配音，一个 Key 全搞定。",
    // 生成阶段提示
    stageCreate: "创建项目…",
    stageUpload: "上传商品图…",
    stageScript: "AI 写脚本…",
    stageIngest: "抓取商品信息…",
    // 错误提示
    errTopicScript: "生成失败，请检查 LLM 配置",
    errProjectCreate: "项目创建失败，请重试",
    errUpload: "图片上传失败，请检查网络",
    errScript: "脚本生成失败，请检查 LLM 配置",
    errIngest: "没能从该链接抓取到商品信息，请检查链接或改用「上传商品图」",
    errGeneric: "出错了，请重试",
    // 示例
    examplesLabel: "没素材，先试试",
    // 最近项目
    recentLabel: "继续未完成的项目",
    untitledProject: "未命名项目",
    // 最近项目卡片的阶段标签（区别于上方 stage* 生成进行时文案）
    pjStageScript: "脚本",
    pjStageAssets: "素材",
    pjStageVideo: "合成",
    pjStageDone: "已完成",
    // 高级入口
    advLink: "高级设置 · 多平台 / 自定义模型 / 生成参数 ›",
    // 新建项目默认名（{name} 为商品名）
    projectName: "{name} 推广",
  },
  en: {
    // 顶部导航
    navProducts: "Products",
    navBatch: "Batch",
    navSettings: "Settings",
    // 主视觉
    eyebrow: "AI Short-Video Studio",
    h1Lead: "Drop a product photo, ",
    h1Highlight: "ship the video",
    sub: "Upload a product photo or just type a topic. AI writes the script, fills the visuals, adds voiceover, and renders a vertical short — start now, add a key only when AI kicks in.",
    // 模式切换
    tabUpload: "Upload product photo",
    tabLink: "Product link",
    tabTopic: "One-sentence video",
    // 商品链接模式
    linkPlaceholder: "Paste a product URL (Taobao / JD / Amazon / Shopify / any store…)",
    linkHint: "Auto-grabs the title, price and images, creates the project and writes the script",
    linkProductFallback: "Imported product",
    // 上传模式
    dropTitle: "Drop a product photo, or click to upload",
    dropSub: "JPG / PNG, up to 5 · No assets? Pick an example below",
    imgAlt: "Product photo",
    removeAria: "Remove",
    productNamePlaceholder: "Product name (required, e.g. Portable juicer cup)",
    sellingPointsPlaceholder: "Key selling points (optional) — sharper script if filled",
    // 一句话模式
    topicPlaceholder: "Type a topic, e.g. 3 small things that make a rental feel upscale / must-stock hand creams for winter",
    // 未配 Key 提示
    keyboxText: "No key yet? Scripts and visuals need an AI platform first. We recommend Atlas Cloud — one key covers script + image + video + voiceover.",
    keyboxCta: "Configure",
    // Atlas 一键接入（落地页内联，免跳设置）
    atlasBadge: "One key",
    atlasTitle: "Connect Atlas Cloud and start now",
    atlasDesc: "It powers script + image + video + voiceover — models are auto-picked.",
    atlasGetKey: "No key? Get one free in a minute",
    atlasKeyPlaceholder: "Paste your Atlas Cloud API key",
    atlasConnectStart: "Connect & start",
    atlasConnecting: "Connecting…",
    atlasUseOther: "Prefer another platform (OpenAI / DeepSeek…)? Open full settings",
    atlasKeyInvalid: "Key invalid or unauthorized — check and retry",
    atlasConnectFailed: "Connection failed — check your network and retry",
    atlasDismiss: "Maybe later",
    // 主按钮 + 安心文案
    ctaStart: "Start generating",
    busyDefault: "Generating…",
    reassureLead: "No key yet? Connect ",
    reassureTail: " in one click — script + image + video + voiceover, all with a single key.",
    // 生成阶段提示
    stageCreate: "Creating project…",
    stageUpload: "Uploading product photos…",
    stageScript: "AI is writing the script…",
    stageIngest: "Fetching product info…",
    // 错误提示
    errTopicScript: "Generation failed. Check your LLM settings",
    errProjectCreate: "Failed to create project. Please try again",
    errUpload: "Image upload failed. Check your network",
    errScript: "Script generation failed. Check your LLM settings",
    errIngest: "Couldn't fetch product info from that link — check the URL or use “Upload product photo”",
    errGeneric: "Something went wrong. Please try again",
    // 示例
    examplesLabel: "No assets? Try one",
    // 最近项目
    recentLabel: "Continue an unfinished project",
    untitledProject: "Untitled project",
    // 最近项目卡片的阶段标签（区别于上方 stage* 生成进行时文案）
    pjStageScript: "Script",
    pjStageAssets: "Assets",
    pjStageVideo: "Compose",
    pjStageDone: "Done",
    // 高级入口
    advLink: "Advanced · multi-platform / custom models / generation params ›",
    // 新建项目默认名（{name} 为商品名）
    projectName: "{name} Promo",
  },
};
