/**
 * LLM Prompt 模板
 * 用于生成电商短视频带货脚本的系统提示词和结构化模板
 */

import { getTemplatesByCategory, categoryNameMap, type ProductCategory } from "./templates";

// ==================== 系统角色 Prompt ====================

/** 系统角色 prompt：专业电商短视频编导 */
export const SYSTEM_PROMPT = `你是一位顶级电商短视频编导，拥有以下专业能力：

【身份背景】
- 5年抖音/快手电商短视频创作经验，累计操盘GMV超过10亿
- 精通消费心理学、AIDA营销模型（注意→兴趣→欲望→行动）
- 擅长用视听语言讲故事，每条视频都经过严格的分镜设计
- 深谙平台算法机制，完播率和互动率是创作的核心指标

【核心能力】
1. 黄金3秒设计：用视觉冲击、悬念提问、反差对比或利益承诺在前3秒留住观众
2. 痛点挖掘：精准找到目标用户的真实痛点，用场景化语言引发共鸣
3. 产品种草：将产品卖点转化为用户可感知的利益点，不说参数说体验
4. 信任构建：通过数据、对比、口碑、权威背书建立信任
5. 行动号召：用限时限量、价格锚点、赠品策略驱动立即购买

【创作原则】
- 文案口语化：说人话，像朋友聊天一样自然
- 节奏紧凑：每个分镜都有存在的理由，不允许废镜头
- 情绪曲线：开头抓眼球→中间建信任→结尾促行动
- 画面可执行：每个分镜的描述要足够具体，能直接指导拍摄或AI生成
- 商品展示镜头（product_reveal/cta）优先使用 product_image，确保商品不被AI篡改
- AI 生成的场景描述要具体、有画面感
- prompt 字段用英文写，要具体描述画面构图、光线、色调

【输出要求】
你必须严格按照指定的 JSON 格式输出脚本，不要输出任何额外的解释文字。`;

// ==================== 风格结构模板 ====================

/** 脚本风格类型 */
export type ScriptStyleType = "pain_point" | "scene" | "comparison" | "story" | "custom";

/** 风格中文名映射 */
export const styleNameMap: Record<ScriptStyleType, string> = {
  pain_point: "痛点种草",
  scene: "场景安利",
  comparison: "对比测评",
  story: "剧情故事",
  custom: "自定义",
};

/** 按风格的结构化 prompt 指令 */
export const stylePrompts: Record<Exclude<ScriptStyleType, "custom">, string> = {
  pain_point: `
【脚本风格：痛点种草型】
结构要求：痛点引入 → 产品救星 → 效果证明 → 限时抢购

创作要点：
1. 开头必须精准击中目标用户的痛点，用具体场景而非抽象描述
   - 好的："每次化妆卡粉斑驳，拍照都不敢放大看"
   - 差的："你的皮肤不好吗？"
2. 痛点要足够疼，用户看了要有"对对对就是我"的感觉
3. 产品出场时机要在痛点最强烈的时候，像"救星"一样登场
4. 使用效果要有对比：使用前vs使用后，越直观越好
5. 最后用限时限量制造紧迫感，逼单要自然不生硬

情绪节奏：焦虑 → 共鸣 → 期待 → 惊喜 → 心动 → 冲动下单`,

  scene: `
【脚本风格：场景安利型】
结构要求：生活场景切入 → 自然使用 → 效果展示 → 安利推荐

创作要点：
1. 开头是一个具体的生活场景（约会前、加班中、周末宅家、旅行途中等）
2. 产品的出现要"自然"，像生活中真的会用到，而非硬广
3. 重点展示产品融入生活的"美好瞬间"，让观众代入
4. 安利口吻要像"好东西忍不住分享"，而非"你一定要买"
5. 可以用 vlog 式的第一人称叙述，增加真实感和亲近感

情绪节奏：日常 → 代入 → 向往 → 好奇 → 被种草 → 想要同款`,

  comparison: `
【脚本风格：对比测评型】
结构要求：提出问题 → 多方对比 → 数据/效果说话 → 推荐最优

创作要点：
1. 开头可以用"花了XXX元测了N款，就为了告诉你买哪个"式的吸引
2. 对比维度要公平客观：外观、性能、价格、细节等
3. 每项对比用直观的方式呈现：并排测试、数据图表、慢动作回放
4. 语气保持客观中立，不贬低竞品而是突出推荐款的优势
5. 最后的推荐要有理有据，总结"为什么选这个"

情绪节奏：好奇 → 信任（专业感） → 认同 → 确认选择 → 下单`,

  story: `
【脚本风格：剧情故事型】
结构要求：剧情铺垫 → 冲突/转折 → 产品登场解决问题 → 美好结局+种草

创作要点：
1. 开头用一个有吸引力的故事开场："上周发生了一件事..."
2. 故事要简短但有冲突：约会翻车、面试尴尬、朋友聚会社死等
3. 产品作为解决冲突的关键道具出现，扭转故事走向
4. 结局要有反转和"爽感"，让观众看完有满足感
5. 最后自然过渡到产品介绍，不破坏故事的沉浸感
6. 故事时长控制在15-25秒，不能拖沓

情绪节奏：好奇 → 紧张/尴尬 → 转折惊喜 → 满足 → 种草 → 行动`,
};

// ==================== 视频模式指令 ====================

/** 按视频模式的素材生成策略 */
export const VIDEO_MODE_DIRECTIVES: Record<string, string> = {
  product_closeup: `
【视频模式：产品特写】
这是一条以商品本身为主角的视频，全程不出现真人。

素材策略（极其重要，严格遵守）：
1. 所有分镜的 visualSource 优先使用 "product_image"（商品原图最真实）
2. 需要场景背景时才用 "ai_generate"，但画面主体必须是产品，绝对不要生成人脸
3. 每个使用 product_image 的分镜，设置 motion 字段控制运动效果：
   - hook 分镜：motion = "zoom_in_slow"（缓慢推进，营造悬念）
   - product_reveal：motion = "ken_burns"（缓慢漂移，展示全貌）
   - demo：motion = "pan_left" 或 "pan_right"（横移展示细节）
   - cta：motion = "static"（静止，聚焦购买信息）
4. prompt 字段描述产品周围的环境/光线/氛围，不描述人物
   - 好的 prompt："Premium tissue box on a clean marble surface, soft studio lighting, bokeh background, product photography"
   - 差的 prompt："A woman holding tissue paper"（不要出现人）
5. 可使用 textOverlay 在关键帧上叠加文字（卖点、价格等）

适合的商品：高客单价护肤品、食品、数码产品、家居用品等`,

  graphic_montage: `
【视频模式：图文混剪】
这是一条快节奏的图文混剪视频，用商品图+文字卡片+转场动画吸引注意力。

素材策略：
1. 以 "product_image" 为主，穿插文字卡片
2. 每个分镜都应设置 textOverlay 字段，叠加关键信息：
   - hook：textOverlay.style = "title"，文字大而醒目
   - pain_point：textOverlay.style = "highlight"，强调痛点
   - demo：textOverlay.style = "subtitle"，描述功能
   - cta：textOverlay.style = "price"，显示价格/优惠
3. 转场要快速密集（建议 ffmpeg_fade 或 direct_concat，不用 AI 转场）
4. 分镜时长要短（每个 2-4 秒），节奏紧凑
5. prompt 中描述简洁的背景和排版风格，不要人物
6. 所有分镜使用 motion 效果让画面不死板

适合的商品：快消品、日用品、零食、平价美妆等`,

  scene_demo: `
【视频模式：场景演示】
这是一条展示产品使用场景的视频，用 AI 生成使用环境，但不生成人脸。

素材策略：
1. product_reveal 和 cta 分镜使用 "product_image"（确保商品真实）
2. hook 和 demo 分镜使用 "ai_generate"，生成使用场景
3. AI 生成的画面必须避免人脸！可以出现：
   - 手部特写（涂抹、使用、操作）
   - 背影/侧影（模糊处理）
   - 只有物品的场景（桌面、浴室、厨房等）
4. prompt 中明确写 "no face visible, hands only" 或 "back view, silhouette"
   - 好的："Close-up of hands applying cream on skin, soft natural lighting, bathroom counter, no face visible"
   - 差的："A beautiful woman applying cream"（会生成假脸）
5. 场景要真实生活化，光线自然，避免过度渲染

适合的商品：护肤品、化妆品、厨房用品、健身器材等`,

  live_presenter: `
【视频模式：真人出镜】
这是一条有真人出镜讲解的视频。

素材策略：
1. 如果提供了出镜人物信息，所有含人物的分镜 prompt 必须包含人物外貌描述
2. product_reveal 和 cta 依然建议使用 "product_image"
3. hook 和 demo 可以使用 "ai_generate" 生成人物场景
4. 也可将 visualSource 设为 "user_upload"，让用户上传自己拍摄的真人素材
5. 如果没有真人素材，建议只在中景/远景使用 AI 人物，避免面部特写（容易失真）

建议：如果用户没有真人素材，优先考虑切换到"产品特写"或"场景演示"模式`,
};

// ==================== 平台 SEO 策略 ====================

/** 按投放平台的算法优化指令 */
export const PLATFORM_SEO_DIRECTIVES: Record<string, string> = {
  douyin: `
【抖音算法优化策略】
完播率优化（权重最高）：
- 前3秒必须有强钩子，不能用品牌logo或空镜头开场
- 每5秒要有一个信息密度高点（新信息、反转、视觉刺激）防止用户划走
- 结尾不要有"谢谢观看"之类的结束信号，要在高潮处戛然而止或抛出悬念
- 配音语速建议 3.5-4 字/秒，比日常略快

互动率优化：
- 在 voiceover 中自然植入 1-2 个引导互动的话术：
  "你们觉得值不值？评论区告诉我"
  "用过的姐妹扣1，没用过的扣2"
  "先收藏，下次买的时候不迷路"
- CTA 分镜的文案要有紧迫感："最后XX件"、"今天下单送XX"

转化率优化：
- 价格锚点要明确：先说原价/柜台价，再说活动价
- 最后 3 秒必须有清晰的购买引导："点击下方小黄车"
- 避免出现绝对化用语（"最好的"、"第一"）可能被限流`,

  kuaishou: `
【快手算法优化策略】
完播率优化：
- 快手用户更喜欢"接地气"的内容，开头用日常场景切入
- 语速可以略慢于抖音（3-3.5字/秒），更有"聊天感"
- 视频时长建议 20-40 秒（快手完播率权重比抖音更高）

互动率优化：
- 快手用户互动意愿强，多用"老铁们"、"家人们"等称呼
- 引导评论："这个价格你们能接受吗？"
- 引导关注："关注我，每天给你们找好物"

转化率优化：
- 快手用户价格敏感度高，性价比是核心卖点
- 多用"自用款"、"回购N次"等信任话术
- CTA 要简单直接："直接拍，不用犹豫"`,

  xiaohongshu: `
【小红书算法优化策略】
完播率优化：
- 小红书用户偏好"精致感"和"教程感"
- 开头用"分享"、"安利"、"测评"等小红书原生词汇
- 视频节奏可以比抖音慢，注重画面美感

互动率优化：
- 引导收藏："建议先收藏，需要的时候翻出来看"
- 引导评论："你们还想看什么类型的测评？"
- 用"姐妹"、"宝子"等小红书风格称呼

转化率优化：
- 小红书用户信任"真实分享"，避免过度营销感
- 多分享使用体验和对比，少说"赶紧买"
- 封面要精致，标题用关键词（品牌名+品类+核心卖点）`,

  tiktok: `
【TikTok Shop 算法优化策略】
官方推荐三段式结构（更易进推荐、提转化）：
- 黄金 3-6 秒钩子：第一帧即产品或惊艳效果，开门见山抛痛点/反差，不留缓冲、不放 logo 空镜
- 核心信息（Key Message）：3-5 个利益点快速给到，每点配一个画面，讲清"为什么是它"
- 明确 CTA：片尾清晰引导"点击橱窗/黄车下单"，可叠加限时优惠

高转化四范式（任选其一贯穿全片）：
- 测评（Review）：真实试用 + 优缺点，建立可信度
- 前后对比（Before/After）：使用前 vs 使用后的可视化反差
- 开箱（Unboxing）：拆封惊喜 + 细节特写，营造期待
- 教程（How-to）：手把手演示用法/场景，降低决策门槛

留存与合规：
- 节奏更快：每 2-3 秒切一个信息点，字幕全程在屏（多为静音观看）
- 价格/优惠用画面贴片强化，别只靠口播
- 面向海外受众时口播可用英文/目标语言；AI 生成内容需打标识，避免夸大与未经证实的功效宣称`,
};

// ==================== 黄金3秒策略 ====================

/** 黄金3秒开头策略库 */
export const goldenThreeSecondsStrategies = `
【黄金3秒开头策略 - 必须使用以下策略之一】

策略1「视觉冲击法」：用极度吸睛的画面作为第一帧
  - 夸张的对比（素颜vs妆后、脏vs干净）
  - 动态捕捉（爆浆、拉丝、泼水、碎裂）
  - 微距特写（质地、纹理、光泽）
  示例文案："这个效果真实存在吗？！"

策略2「悬念提问法」：抛出一个让人忍不住要看答案的问题
  - 反常识问题："XX元的东西居然比XX元的好用？"
  - 身份代入："月薪5000的姐妹都在用的XX"
  - 数字钩子："3秒搞定XX，我用了这个方法"
  示例文案："为什么这个XX全网都在抢？"

策略3「反差对比法」：制造强烈的认知反差
  - 价格反差："10块钱 vs 500块钱的XX"
  - 效果反差："同事以为我花了3000做的脸"
  - 身份反差："程序员教你化妆？效果比美妆博主还好"
  示例文案："千万别买贵了！同样的效果只要十分之一！"

策略4「利益承诺法」：直接告诉观众看完能得到什么
  - 省钱："看完这条帮你省500块"
  - 变美/变好："7天让你的XX发生质变"
  - 避坑："买XX前一定要看这条"
  示例文案："看完这条视频，你就知道买哪个了！"

策略5「情感共鸣法」：戳中观众的情感痛点
  - 焦虑共鸣："是不是也觉得XX越来越XX了？"
  - 快乐分享："今天开心到必须分享的一个好物！"
  - 后悔预警："早知道就该买！后悔没早点发现"
  示例文案："姐妹们，别划走！这个XX我后悔没早买！"
`;

// ==================== 输出格式约束 ====================

/** JSON 输出格式约束 prompt */
export const OUTPUT_FORMAT_PROMPT = `
【输出格式要求】
请严格按照以下 JSON 格式输出，不要包含任何 markdown 代码块标记或额外文字：

{
  "title": "脚本标题（10字以内，抓人眼球）",
  "totalDuration": 25,
  "shots": [
    {
      "shotId": 1,
      "type": "hook",
      "duration": 3,
      "description": "画面描述：要足够具体，包含场景布置、人物动作、物品位置、光线氛围等细节",
      "camera": "镜头运动描述：特写/中景/全景 + 推拉摇移跟升降等运动方式",
      "visualSource": "ai_generate",
      "transition": "direct_concat",
      "voiceover": "配音文案：口语化的播音文案，控制字数与duration匹配（约3字/秒）",
      "prompt": "英文AI生图/生视频prompt：用于生成该分镜的视觉素材",
      "searchTerms": ["english keyword", "alt keyword"],
      "characterId": "出镜人物ID（可选，有人物出镜时填写）"
    }
  ],
  "seo": {
    "title": "视频标题（含核心关键词，15字以内）",
    "hashtags": ["#话题标签1", "#话题标签2", "#话题标签3"],
    "coverText": "封面文案（8字以内，吸引点击）",
    "interactionGuide": "互动引导语（引导评论/收藏/关注）",
    "description": "视频描述文案（含关键词，50字以内）"
  }
}

字段规则：
- shotId: 从1开始递增的整数
- type: 只能是 "hook" | "pain_point" | "product_reveal" | "demo" | "social_proof" | "cta" 之一
- duration: 该分镜时长（秒），所有分镜 duration 之和应等于 totalDuration
- description: 中文画面描述，要具体到可以直接拍摄或让AI生成
- camera: 中文镜头运动描述
- visualSource: "ai_generate"（AI生成）| "product_image"（使用商品图）| "user_upload"（用户上传）
- transition: "ai_start_end" | "ai_reference" | "direct_concat" | "ffmpeg_fade"
- voiceover: 中文配音文案，字数约等于 duration x 3
- prompt: 英文 prompt，用于 AI 图像/视频生成，描述画面主体、风格、光线、构图等
- searchTerms: 1-3 个英文检索词，描述该分镜画面主体（用于从免费素材库自动搜画面，无商品主题成片时尤其关键），如 ["coffee morning", "cozy cafe"]
- characterId: 如果该分镜有人物出镜，填入人物ID；无人物的分镜省略此字段
- seo.title: 包含商品名和核心卖点的短标题
- seo.hashtags: 3-5个相关话题标签，第一个为品类大标签
- seo.coverText: 封面上叠加的大字文案
- seo.interactionGuide: 自然的互动引导话术
- seo.description: 发布时的视频描述

注意事项：
1. 第一个分镜的 type 必须是 "hook"，最后一个必须是 "cta"
2. totalDuration 控制在15-30秒之间
3. 分镜数量控制在5-8个
4. prompt 字段要用英文，风格描述要专业（如 cinematic, soft lighting, macro shot 等）
5. visualSource 为 "product_image" 时，prompt 字段可省略
`;

// ==================== 商品分析 Prompt ====================

/** 商品图片分析 prompt */
export const PRODUCT_ANALYSIS_PROMPT = `你是一位专业的电商选品分析师。请仔细分析提供的商品图片，提取以下信息：

1. 【商品识别】
   - 商品名称/类型
   - 所属品类（美妆护肤/食品零食/家居日用/服饰鞋包/数码3C）
   - 品牌（如果可见）

2. 【视觉特征】
   - 主色调和配色方案
   - 包装设计风格（简约/华丽/可爱/科技感等）
   - 产品形态（固体/液体/粉末/组合等）
   - 材质质感（哑光/亮面/透明/磨砂等）

3. 【卖点提取】
   - 从图片可见的产品卖点（成分、功效、规格等）
   - 包装上的营销文案
   - 产品独特的设计亮点

4. 【目标用户推断】
   - 根据产品特征推断目标用户群体
   - 适合的使用场景
   - 可能的痛点和需求

5. 【短视频建议】
   - 推荐的拍摄角度和特写镜头
   - 建议突出的视觉元素
   - 适合的脚本风格（痛点种草/场景安利/对比测评/剧情故事）

请用 JSON 格式输出分析结果：
{
  "productName": "商品名称",
  "category": "beauty|food|home|fashion|tech",
  "brand": "品牌名（未知则留空）",
  "visualFeatures": {
    "mainColor": "主色调",
    "designStyle": "设计风格",
    "productForm": "产品形态",
    "texture": "材质质感"
  },
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "targetAudience": "目标用户描述",
  "usageScenarios": ["场景1", "场景2"],
  "painPoints": ["痛点1", "痛点2"],
  "videoSuggestions": {
    "recommendedAngles": ["角度1", "角度2"],
    "keyVisuals": ["视觉元素1", "视觉元素2"],
    "suggestedStyle": "pain_point|scene|comparison|story"
  }
}`;

// ==================== 组装完整 Prompt ====================

/** 脚本生成的输入参数 */
export interface ScriptGenerationInput {
  /** 商品名称 */
  productName: string;
  /** 商品品类 */
  category: ProductCategory;
  /** 商品描述/卖点 */
  productDescription?: string;
  /** 脚本风格 */
  styleType: ScriptStyleType;
  /** 目标时长（秒） */
  targetDuration?: number;
  /** 目标用户 */
  targetAudience?: string;
  /** 商品图片分析结果 */
  productAnalysis?: string;
  /** 视频模式 */
  videoMode?: "product_closeup" | "graphic_montage" | "scene_demo" | "live_presenter";
  /** 用户自定义要求 */
  customRequirements?: string;
  /** 参考脚本结构（爆款模板的镜头节奏/类型/转化逻辑，用于"套用模板"生成） */
  referenceStructure?: string;
  /** 出镜人物信息（仅 live_presenter 模式，用于注入 prompt 保持人物一致性） */
  character?: {
    id: string;
    name: string;
    appearance: string;
    voiceStyle?: string;
  };
  /** 价格区间 */
  priceRange?: string;
  /** 投放平台（逗号分隔：douyin,kuaishou,xiaohongshu） */
  platforms?: string;
  /** 产品用法与优势 */
  usageAdvantage?: string;
}

/**
 * 组装完整的用户 prompt
 * 将所有模板、策略、约束组合成一条完整的生成指令
 */
export function buildUserPrompt(input: ScriptGenerationInput): string {
  const {
    productName,
    category,
    productDescription,
    styleType,
    targetDuration = 25,
    targetAudience,
    productAnalysis,
    videoMode = "product_closeup",
    customRequirements,
    character,
    priceRange,
    platforms,
    usageAdvantage,
  } = input;

  // 获取品类模板
  const categoryData = getTemplatesByCategory(category);
  const categoryName = categoryNameMap[category];

  // 获取风格指令
  const styleDirective = styleType === "custom"
    ? `【脚本风格：自定义】\n请根据用户的自定义要求来确定脚本结构和风格。`
    : stylePrompts[styleType];

  // 选择最合适的参考模板（取第一个作为参考）
  const referenceTemplate = categoryData.templates[0];

  // 组装 prompt
  const parts: string[] = [];

  parts.push(`请为以下商品创作一条电商短视频带货脚本：`);
  parts.push(`\n【商品信息】`);
  parts.push(`- 商品名称：${productName}`);
  parts.push(`- 商品品类：${categoryName}`);

  if (productDescription) {
    parts.push(`- 商品描述/卖点：${productDescription}`);
  }

  if (targetAudience) {
    parts.push(`- 目标用户：${targetAudience}`);
  }

  if (priceRange) {
    parts.push(`- 价格区间：${priceRange}`);
  }

  if (usageAdvantage) {
    parts.push(`- 用法与优势：${usageAdvantage}`);
  }

  parts.push(`- 目标总时长：${targetDuration}秒`);
  parts.push(`- 画面比例：9:16 竖屏（手机观看）`);
  parts.push(`- 目标平台：抖音/快手`);

  // 添加商品图片分析结果
  if (productAnalysis) {
    parts.push(`\n【商品图片分析结果】`);
    parts.push(productAnalysis);
  }

  // 注入出镜人物约束
  if (character) {
    parts.push(`\n【出镜人物】`);
    parts.push(`- 人物名称：${character.name}`);
    parts.push(`- 外貌特征：${character.appearance}`);
    if (character.voiceStyle) {
      parts.push(`- 声音风格：${character.voiceStyle}`);
    }
    parts.push(`- 重要：所有包含人物出镜的分镜，prompt 中必须包含该人物的外貌描述，确保画面一致性`);
    parts.push(`- 在 shot 的 characterId 字段填入 "${character.id}"`);
  }

  // 添加视频模式指令
  parts.push(`\n${VIDEO_MODE_DIRECTIVES[videoMode]}`);

  // 注入投放平台的 SEO 策略
  if (platforms) {
    const platformList = platforms.split(",");
    // 用第一个平台作为主要优化目标
    const primaryPlatform = platformList[0];
    if (PLATFORM_SEO_DIRECTIVES[primaryPlatform]) {
      parts.push(`\n${PLATFORM_SEO_DIRECTIVES[primaryPlatform]}`);
    }
    if (platformList.length > 1) {
      parts.push(`\n【注意】视频同时投放于：${platformList.join("、")}，脚本要兼顾各平台用户习惯`);
    }
  }

  // 添加品类专属指令
  parts.push(`\n${categoryData.directive}`);

  // 添加风格指令
  parts.push(`\n${styleDirective}`);

  // 添加黄金3秒策略
  parts.push(`\n${goldenThreeSecondsStrategies}`);

  // 添加参考模板
  parts.push(`\n【参考脚本案例（仅供参考风格和节奏，不要照搬内容）】`);
  parts.push(`模板名称：${referenceTemplate.name}`);
  parts.push(`参考示例：\n${referenceTemplate.example}`);

  // 添加自定义要求
  if (customRequirements) {
    parts.push(`\n【用户额外要求】`);
    parts.push(customRequirements);
  }

  // 添加输出格式约束
  parts.push(`\n${OUTPUT_FORMAT_PROMPT}`);

  // 语言跟随商品信息语言：英文商品(海外 TikTok Shop/Amazon 带货)就出英文带货脚本/旁白，
  // 否则上面 OUTPUT_FORMAT 的「中文配音文案」会让英文商品也产出中文旁白（视频本体就错了）。
  // 放最后最显著、覆盖规范里的「中文」。与 topic 路径(buildTopicPrompt)同一手法。
  const productText = `${productName || ""} ${productDescription || ""} ${usageAdvantage || ""}`;
  if (productText.trim() && !/[一-鿿]/.test(productText)) {
    parts.push(
      `\n【LANGUAGE — IMPORTANT, overrides any "中文" wording above】The product info is NOT in Chinese. Write every "title" and "voiceover" field in the SAME language as the product (e.g. natural English for an overseas TikTok Shop audience), never Chinese. Keep "searchTerms" in English as usual; "description"/"camera" may be concise English.`
    );
  }

  return parts.join("\n");
}

/**
 * 构建批量生成 prompt（一次生成多个不同风格的脚本）
 */
export function buildBatchPrompt(input: ScriptGenerationInput, count: number = 3): string {
  const basePrompt = buildUserPrompt(input);

  const refBlock = input.referenceStructure
    ? `\n\n【参考爆款结构】\n请参考以下经过验证的高转化分镜结构（镜头类型、节奏、转化逻辑），用本商品重新创作脚本（不要照搬文案，要贴合本商品卖点）：\n${input.referenceStructure}\n`
    : "";

  return `${basePrompt}${refBlock}

【批量生成要求】
请生成 ${count} 个不同风格/角度的脚本方案。每个方案的切入角度、开头策略、叙事节奏都要有明显差异。

输出格式改为：
{
  "scripts": [
    { "title": "...", "totalDuration": ..., "shots": [...] },
    { "title": "...", "totalDuration": ..., "shots": [...] }
  ]
}

请确保输出 ${count} 个脚本方案。`;
}

// ==================== 主题成片（去商品化）====================
//
// 「一句话主题成片」：用户只给一句话主题（如"在家如何泡一杯手冲咖啡"、"城市夜景的浪漫"），
// 不涉及任何商品，引擎产出一条有旁白、有画面节奏的短视频脚本，每个分镜都带英文检索词
// （stockKeywords），随后由 stock-fill 从免费素材库自动配齐画面 → 合成成片。
// 与带货脚本的区别：没有商品/卖点/逼单，全程 ai_generate（实际由免费素材兜底），重表达不重转化。

/** 主题成片的系统角色：通用短视频内容编导（知识/生活/故事/情绪向） */
export const TOPIC_SYSTEM_PROMPT = `你是一位顶级短视频内容编导，擅长把任意一个主题做成有画面、有节奏、让人看完有收获或有共鸣的竖屏短视频。

【核心能力】
1. 黄金3秒：用悬念、反差、利益承诺或情绪共鸣在前3秒留住观众
2. 信息节奏：把主题拆成层层递进的小信息点，每个分镜只讲一件事，不堆砌
3. 画面感：每个分镜都能对应到一段真实可检索的画面（风景、动作、物件、场景）
4. 旁白口语化：像朋友聊天，不书面、不说教，配音字数与时长匹配（约3字/秒）
5. 收尾升华：结尾用一句金句或行动建议收束，给观众"值得点赞收藏"的理由

【创作原则】
- 这是一条没有商品的内容向短视频，不要出现任何带货、卖点、价格、下单、购买引导
- 每个分镜的画面都要能用免费素材库搜到，所以画面主体要常见、具象、可拍摄
- 画面里不强求出现人脸，优先用环境/动作/物件/风景表达
- searchTerms 必须用英文，描述该分镜的画面主体，是自动配画面的关键，绝不能省略

【输出要求】
你必须严格按照指定的 JSON 格式输出，不要输出任何额外的解释文字。`;

/** 主题成片旁白风格 */
export type TopicNarrationStyle = "knowledge" | "story" | "lifestyle" | "inspiration" | "travel";

/** 旁白风格中文名 */
export const topicNarrationNameMap: Record<TopicNarrationStyle, string> = {
  knowledge: "知识科普",
  story: "情感故事",
  lifestyle: "生活方式",
  inspiration: "励志金句",
  travel: "旅行风光",
};

/** 各旁白风格的创作指令 */
const topicStylePrompts: Record<TopicNarrationStyle, string> = {
  knowledge: `
【旁白风格：知识科普】
- 开头抛出一个反常识或让人好奇的问题/事实
- 中间用 3-5 个递进的小知识点把主题讲清楚，每个分镜一个点
- 语言准确但不掉书袋，多用"其实""你可能不知道"等口语连接
- 结尾给一句可记住的总结金句`,
  story: `
【旁白风格：情感故事】
- 用第一人称或第二人称叙事，开头是一个有代入感的瞬间
- 中间有情绪起伏（铺垫→转折→释然），让观众跟着走
- 画面以氛围、光影、生活细节为主，烘托情绪
- 结尾落到一句能引发共鸣的感悟`,
  lifestyle: `
【旁白风格：生活方式】
- 像一段精致的生活 vlog 旁白，娓娓道来
- 展示一个具体的生活场景/流程/习惯的美好瞬间
- 画面注重质感与细节（手部动作、物件特写、自然光）
- 结尾是一句温柔的生活态度表达`,
  inspiration: `
【旁白风格：励志金句】
- 节奏明快有力，每个分镜一句短而有冲击力的话
- 用对比、排比制造气势，画面大气（风光、奔跑、登顶、城市）
- 不空喊口号，结合具体画面让情绪落地
- 结尾一句点题的金句，适合被点赞收藏`,
  travel: `
【旁白风格：旅行风光】
- 以目的地或风景为主角，旁白像一封写给某个地方的信
- 画面是地标、自然、人文细节的组合，节奏舒缓
- 旁白点出这个地方独特的氛围与值得去的理由
- 结尾留一句让人想出发的话`,
};

/** 主题成片的输出格式约束（复用 Shot 结构，但去掉商品/逼单，强制每镜 searchTerms） */
const TOPIC_OUTPUT_FORMAT_PROMPT = `
【输出格式要求】
请严格按照以下 JSON 格式输出，不要包含任何 markdown 代码块标记或额外文字：

{
  "title": "脚本标题（10字以内，抓人眼球）",
  "totalDuration": 25,
  "shots": [
    {
      "shotId": 1,
      "type": "hook",
      "duration": 3,
      "description": "中文画面描述：这一镜呈现什么画面（场景/动作/物件/光线），要具体可检索",
      "camera": "镜头运动描述：特写/中景/全景 + 推拉摇移",
      "visualSource": "ai_generate",
      "transition": "direct_concat",
      "voiceover": "中文旁白文案，字数约等于 duration × 3",
      "searchTerms": ["english keyword", "alt keyword"]
    }
  ]
}

字段规则：
- shotId: 从1开始递增的整数
- type: 第一个分镜用 "hook"，中间分镜用 "demo"，最后一个用 "cta"（此处表示收尾升华，不是带货）
- duration: 该分镜时长（秒），所有分镜 duration 之和应等于 totalDuration
- description: 中文画面描述，具体到可以直接检索或拍摄
- camera: 中文镜头运动描述
- visualSource: 固定为 "ai_generate"
- transition: "direct_concat" | "ffmpeg_fade" 之一（主题成片节奏明快，建议这两种）
- voiceover: 中文旁白文案，字数约等于 duration × 3
- searchTerms: 【必填】1-3 个英文检索词，精准描述该分镜画面主体，如 ["pour over coffee", "coffee beans closeup"]。每个分镜都必须有，否则无法自动配画面

注意事项：
1. 第一个分镜 type 必须是 "hook"，最后一个必须是 "cta"（收尾升华）
2. totalDuration 控制在 15-40 秒之间
3. 分镜数量控制在 5-9 个
4. 全程不得出现任何商品、卖点、价格、购买/下单引导
5. 每个分镜的 searchTerms 都不能省略，用常见、具象的英文词以保证素材库能搜到画面
`;

/** 主题成片脚本生成输入 */
export interface TopicScriptInput {
  /** 一句话主题 */
  topic: string;
  /** 旁白风格，默认 knowledge */
  narrationStyle?: TopicNarrationStyle;
  /** 目标时长（秒），默认 25 */
  targetDuration?: number;
  /** 投放平台（逗号分隔），用于注入平台 SEO 策略（可选） */
  platforms?: string;
  /** 用户额外要求（可选） */
  customRequirements?: string;
}

/** 组装主题成片的用户 prompt */
export function buildTopicPrompt(input: TopicScriptInput): string {
  const {
    topic,
    narrationStyle = "knowledge",
    targetDuration = 25,
    platforms,
    customRequirements,
  } = input;

  const styleDirective = topicStylePrompts[narrationStyle] ?? topicStylePrompts.knowledge;

  const parts: string[] = [];
  parts.push(`请围绕以下主题创作一条竖屏短视频脚本（这是一条没有商品的内容向视频）：`);
  parts.push(`\n【主题】\n${topic}`);
  parts.push(`\n【基本要求】`);
  parts.push(`- 旁白风格：${topicNarrationNameMap[narrationStyle] ?? "知识科普"}`);
  parts.push(`- 目标总时长：${targetDuration}秒`);
  parts.push(`- 画面比例：9:16 竖屏（手机观看）`);

  // 旁白风格指令
  parts.push(`\n${styleDirective}`);

  // 黄金3秒（与带货共用，开头抓人逻辑通用）
  parts.push(`\n${goldenThreeSecondsStrategies}`);

  // 平台 SEO（可选，用第一个平台）
  if (platforms) {
    const primary = platforms.split(",")[0];
    if (PLATFORM_SEO_DIRECTIVES[primary]) {
      parts.push(`\n${PLATFORM_SEO_DIRECTIVES[primary]}`);
    }
  }

  if (customRequirements) {
    parts.push(`\n【用户额外要求】\n${customRequirements}`);
  }

  parts.push(`\n${TOPIC_OUTPUT_FORMAT_PROMPT}`);

  // 语言跟随主题语言：英文主题就出英文旁白/标题（否则上面 JSON 规范里的「中文配音文案」会让
  // 全球用户的英文主题也产出中文旁白——视频本体就错了）。放在最后最显著、覆盖规范里的「中文」。
  if (!/[一-鿿]/.test(topic)) {
    parts.push(
      `\n【LANGUAGE — IMPORTANT, overrides any "中文" wording above】The topic is NOT in Chinese. Write every "title" and "voiceover" field in the SAME language as the topic (e.g. natural English), never Chinese. Keep "searchTerms" in English as usual; "description"/"camera" may be concise English.`
    );
  }

  return parts.join("\n");
}

/** 批量生成多套主题成片脚本（不同切入角度） */
export function buildTopicBatchPrompt(input: TopicScriptInput, count: number = 3): string {
  const basePrompt = buildTopicPrompt(input);
  return `${basePrompt}

【批量生成要求】
请生成 ${count} 个不同切入角度的脚本方案，每个方案的开头钩子、叙事顺序、画面选择都要有明显差异。

输出格式改为：
{
  "scripts": [
    { "title": "...", "totalDuration": ..., "shots": [...] },
    { "title": "...", "totalDuration": ..., "shots": [...] }
  ]
}

请确保输出 ${count} 个脚本方案，且每个分镜都带 searchTerms。`;
}

// ==================== 向后兼容的旧接口 ====================

/**
 * 旧版脚本 prompt 构建函数（保持向后兼容）
 * @deprecated 请使用 buildUserPrompt 替代
 */
export function buildScriptPrompt(params: {
  productName: string;
  productCategory?: string;
  productDescription?: string;
  productAnalysis?: string;
  styleType: string;
  duration: number;
  templateHint?: string;
}): string {
  const category = mapOldCategory(params.productCategory);

  return buildBatchPrompt({
    productName: params.productName,
    category,
    productDescription: params.productDescription,
    productAnalysis: params.productAnalysis,
    styleType: (params.styleType as ScriptStyleType) || "pain_point",
    targetDuration: params.duration,
    customRequirements: params.templateHint,
  });
}

/** 将旧版品类名映射为新版品类 key */
function mapOldCategory(category?: string): ProductCategory {
  if (!category) return "beauty";
  const map: Record<string, ProductCategory> = {
    "美妆护肤": "beauty",
    "食品零食": "food",
    "家居日用": "home",
    "服饰鞋包": "fashion",
    "数码3C": "tech",
  };
  return map[category] || "beauty";
}
