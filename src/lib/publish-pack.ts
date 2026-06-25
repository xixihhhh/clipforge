/**
 * 免 Key 发布文案包 —— 不配 LLM 也能在导出页「复制即发」。
 * 按品类 + 平台映射热门话题标签，用痛点/数字/情绪钩子模板拼标题与种草文案。
 * 纯函数、确定性（同输入同输出），可单测；配了 LLM 的用户仍走 /api/llm/publish 拿更优文案。
 */

export interface PublishPack {
  titles: string[];
  hashtags: string[]; // 已带 # 前缀、去重
  caption: string;
}

export interface PublishPackInput {
  productName?: string;
  category?: string; // beauty/food/home/fashion/digital/other
  sellingPoints?: string; // 卖点/描述，可多句
  platform?: string; // douyin/kuaishou/xiaohongshu/tiktok
  locale?: "zh" | "en"; // 文案语言，默认 zh；en 出海用英文标题/话题/CTA（避免英文用户拿到中文文案）
}

// 品类热门话题（贴合抖音/快手/小红书带货语境）
const CATEGORY_TAGS: Record<string, string[]> = {
  beauty: ["好物分享", "美妆", "护肤", "变美", "平价好物", "种草"],
  food: ["美食", "好吃推荐", "零食", "吃货日常", "干饭人", "种草"],
  home: ["家居好物", "居家生活", "生活好物", "收纳", "好物推荐", "种草"],
  fashion: ["穿搭", "时尚", "OOTD", "穿搭分享", "好物分享", "种草"],
  digital: ["数码", "数码好物", "科技", "实用好物", "好物推荐", "种草"],
  other: ["好物推荐", "种草", "好物分享", "值得买", "宝藏好物", "日常分享"],
};

// 品类热门话题（英文 TikTok/Reels 带货语境）
const CATEGORY_TAGS_EN: Record<string, string[]> = {
  beauty: ["BeautyTok", "SkincareRoutine", "MakeupHacks", "BeautyFinds", "GlowUp", "TikTokMadeMeBuyIt"],
  food: ["FoodTok", "FoodieFinds", "SnackHaul", "TikTokFood", "MustTry", "TikTokMadeMeBuyIt"],
  home: ["HomeFinds", "HomeHacks", "CleanTok", "OrganizationTips", "CozyHome", "TikTokMadeMeBuyIt"],
  fashion: ["OOTD", "FashionTok", "StyleInspo", "OutfitIdeas", "FashionFinds", "TikTokMadeMeBuyIt"],
  digital: ["TechTok", "GadgetFinds", "TechReview", "CoolGadgets", "Innovation", "TikTokMadeMeBuyIt"],
  other: ["TikTokMadeMeBuyIt", "MustHave", "ProductReview", "WorthIt", "TikTokFinds", "DailyFinds"],
};

// 平台热门话题
const PLATFORM_TAGS: Record<string, string[]> = {
  douyin: ["抖音好物", "抖音电商"],
  kuaishou: ["快手好物", "快手电商"],
  xiaohongshu: ["小红书", "好物推荐"],
  tiktok: ["TikTokMadeMeBuyIt", "TikTokShop"],
};

/** 取第一条卖点：按中英标点/换行切，去空白，限长（英文卖点更长，故 max 可调） */
function firstSellingPoint(sp: string | undefined, max: number): string {
  if (!sp) return "";
  const first = sp.split(/[。.,，;；\n、]/).map((s) => s.trim()).find((s) => s.length > 0) || "";
  return clip(first, max);
}

/** 按显示宽度近似裁剪（CJK 记 1，避免标题过长） */
function clip(s: string, max: number): string {
  const arr = Array.from(s.trim());
  return arr.length <= max ? s.trim() : arr.slice(0, max).join("").trim();
}

/**
 * 构建发布文案的 LLM 提示词（配了 LLM 的用户走这条拿更优文案）。
 * 跟随 locale：zh 出中文带货文案，en 出英文 TikTok 文案——避免英文用户的 LLM 输出中文。
 * 纯函数，提示词内容可确定性单测（LLM 输出本身依赖 key，不在此测）。
 */
export function buildPublishPrompt(
  input: { productName: string; category?: string; productDescription?: string; platform?: string },
  locale: "zh" | "en" = "zh"
): string {
  const { productName, category, productDescription, platform } = input;
  if (locale === "en") {
    const platformHint = platform ? `Target platform: ${platform}.` : "Target platform: TikTok / Reels / Shorts.";
    return `You are a seasoned e-commerce short-video marketer. Write publishing copy for the product below, entirely in ENGLISH. ${platformHint}
Product: ${productName}
${category ? `Category: ${category}\n` : ""}${productDescription ? `Selling points: ${productDescription}\n` : ""}
Output STRICT JSON only (no extra text):
{
  "titles": ["3 catchy short titles with emotion/pain-point/number hooks, each <= 60 chars"],
  "hashtags": ["6-10 hashtags with #, TikTok-style, matching the category and platform trends"],
  "caption": "one-line caption, conversational, with a clear call to action, <= 150 chars"
}`;
  }
  const platformHint = platform ? `目标平台：${platform}。` : "目标平台：抖音/快手/小红书。";
  return `你是资深电商带货短视频运营。请为以下商品生成发布文案。${platformHint}
商品名称：${productName}
${category ? `品类：${category}\n` : ""}${productDescription ? `卖点：${productDescription}\n` : ""}
要求严格输出 JSON（不要多余文字）：
{
  "titles": ["3 个吸睛短标题，含情绪/痛点/数字钩子，每个 ≤20 字"],
  "hashtags": ["6-10 个带 # 的话题标签，贴合品类与平台热点"],
  "caption": "一句话种草文案，口语化，含行动号召，≤40 字"
}`;
}

export function buildPublishPack(input: PublishPackInput): PublishPack {
  const en = input.locale === "en";
  const name = clip((input.productName || "").trim() || (en ? "this find" : "这款好物"), en ? 40 : 16);
  const cat = (input.category || "other").toLowerCase();
  const point = firstSellingPoint(input.sellingPoints, en ? 40 : 12);

  // 标题：情绪 + 卖点/数字钩子，三条不同角度（英文不强裁，CJK 限 22）
  const titles = en
    ? [
        `This ${name} is a total game-changer 🤯`,
        point ? `${name} — ${point}, you'll want one` : `${name} you won't regret buying`,
        `3 reasons to grab the ${name}`,
      ]
    : [
        clip(`${name}也太好用了吧！后悔没早买`, 22),
        clip(point ? `${name}｜${point}，谁用谁回购` : `${name}，闭眼入不踩雷`, 22),
        clip(`三个理由让你入手${name}`, 22),
      ];

  // 话题：品类 + 平台，去重、带 #、控制在 ~10 个内
  const platform = (input.platform || "").toLowerCase();
  const catTags = en ? CATEGORY_TAGS_EN : CATEGORY_TAGS;
  const tagWords = [
    ...(catTags[cat] || catTags.other),
    ...(PLATFORM_TAGS[platform] || []),
  ];
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const w of tagWords) {
    const tag = `#${w}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    hashtags.push(tag);
    if (hashtags.length >= 10) break;
  }

  // 种草文案：口语化 + 行动号召。先裁前半句，再固定拼 CTA，保证 CTA 尾巴不被整体裁断
  const cta = en ? " — tap the link below to grab it 🛒" : "，点下方小黄车带走它～";
  const lead = en
    ? `Obsessed with ${name}${point ? ", " + point : ""}`
    : `${name}真的绝了${point ? "，" + point : ""}`;
  const capMax = en ? 130 : 40;
  const caption = clip(lead, capMax - Array.from(cta).length) + cta;

  return { titles, hashtags, caption };
}
