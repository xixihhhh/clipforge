import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// ==================== 类型定义 ====================

/** 脚本风格 */
type ScriptStyle =
  | "pain_point"
  | "scene"
  | "comparison"
  | "story"
  | "live";

/** LLM 配置（兼容 OpenAI 格式） */
interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// ==================== 风格映射 ====================

const STYLE_NAME_MAP: Record<ScriptStyle, string> = {
  pain_point: "痛点种草",
  scene: "场景安利",
  comparison: "对比测评",
  story: "剧情故事",
  live: "直播口播",
};

const VALID_STYLES = Object.keys(STYLE_NAME_MAP) as ScriptStyle[];

// ==================== 风格 Prompt 指令 ====================

const STYLE_DIRECTIVES: Record<ScriptStyle, string> = {
  pain_point: `【风格：痛点种草型】
结构：痛点共鸣 → 产品救星 → 核心卖点拆解 → 效果证明 → 限时行动号召
- 用具体生活场景精准击中用户痛点，引发"对对对就是我"的共鸣
- 在痛点最强烈时引出产品，塑造"救星"形象
- 卖点用体验式语言描述，不说参数说感受
- 结尾用限时限量+价格锚点制造紧迫感
情绪曲线：焦虑 → 共鸣 → 期待 → 惊喜 → 心动 → 冲动下单`,

  scene: `【风格：场景安利型】
结构：生活场景切入 → 自然使用产品 → 效果/体验展示 → 安利推荐 → 引导下单
- 以真实生活场景开场（约会前、加班中、周末宅家、旅行等）
- 产品融入自然，像真心推荐而非硬广
- 用"好东西忍不住分享"的口吻，增加亲近感
- 可用 vlog 式第一人称叙述
情绪曲线：日常 → 代入 → 向往 → 好奇 → 被种草 → 想要同款`,

  comparison: `【风格：对比测评型】
结构：抛出问题 → 多维度对比 → 数据/效果说话 → 总结推荐 → 引导下单
- 用"花了XX元测了N款"式开场吸引好奇心
- 公平客观对比：外观、性能、价格、细节
- 语气中立，不贬低竞品而是突出推荐款优势
- 推荐有理有据，总结"为什么选这个"
情绪曲线：好奇 → 信任（专业感） → 认同 → 确认选择 → 下单`,

  story: `【风格：剧情故事型】
结构：故事铺垫 → 冲突/转折 → 产品登场解决 → 美好结局 → 自然种草 → 引导行动
- 用有吸引力的故事开场："上周发生了一件事..."
- 故事简短有冲突：约会翻车、面试尴尬、朋友聚会等
- 产品作为扭转剧情的关键道具
- 结局有反转和"爽感"，自然过渡到产品推荐
情绪曲线：好奇 → 紧张/尴尬 → 转折惊喜 → 满足 → 种草 → 行动`,

  live: `【风格：直播口播型】
结构：热场互动 → 产品亮相 → 卖点连击 → 信任背书 → 逼单话术 → 引导下单
- 开场用互动话术暖场："家人们在吗？今天给你们带来一个炸裂好物！"
- 语速偏快、情绪饱满，有直播间特有的紧迫感和感染力
- 卖点用短句连击，每个卖点配一句"你听我说"式的强调
- 穿插互动引导："扣1的姐妹我给你们改价！""想要的打个要！"
- 价格对比要狠："外面卖XXX，今天直播间只要XX！"
- 逼单要猛："最后XX单！""3、2、1上链接！"
情绪曲线：热场 → 兴奋 → 种草 → 激动 → 疯抢下单`,
};

// ==================== System Prompt ====================

const SYSTEM_PROMPT = `你是一位顶级电商短视频/直播口播文案编导，拥有以下专业能力：

【身份背景】
- 5年抖音/快手/小红书电商内容创作经验，累计操盘GMV超过10亿
- 精通消费心理学、AIDA营销模型（注意→兴趣→欲望→行动）
- 擅长将产品卖点转化为用户能感知的利益点
- 每条文案都经过严格的转化率优化

【核心能力】
1. 黄金3秒设计：用视觉冲击、悬念提问、反差对比或利益承诺在前3秒抓住注意力
2. 痛点挖掘：精准找到目标用户的真实痛点，用场景化语言引发共鸣
3. 卖点转化：不说参数说体验，将技术指标翻译为用户能感知的使用价值
4. 信任构建：通过对比、数据、口碑、权威背书建立信任
5. 行动号召：用限时限量、价格锚点、赠品策略驱动立即行动

【创作原则】
- 文案口语化：说人话，像朋友聊天一样自然，避免书面语
- 节奏紧凑：每句话都有存在的理由，不允许废话
- 情绪曲线：开头抓注意力→中间建信任→结尾促行动
- 字数控制：根据目标时长合理控制字数（语速约 3-4 字/秒）
- 黄金3秒必须使用以下策略之一：视觉冲击法、悬念提问法、反差对比法、利益承诺法、情感共鸣法

【输出要求】
你必须严格按照指定的 JSON 格式输出，不要输出任何额外的解释文字。`;

// ==================== 输出格式 Prompt ====================

const OUTPUT_FORMAT_PROMPT = `【输出格式要求】
请严格按照以下 JSON 格式输出，不要包含任何 markdown 代码块标记或额外文字：

{
  "title": "脚本标题（10字以内，抓人眼球）",
  "style": "使用的风格名称",
  "estimatedDuration": 30,
  "sections": {
    "hook": {
      "label": "黄金3秒开头",
      "content": "开头文案（3秒左右，约10-15字，必须极具吸引力）",
      "strategy": "使用的开头策略名称（如：悬念提问法）"
    },
    "sellingPoints": {
      "label": "核心卖点",
      "points": [
        {
          "order": 1,
          "point": "卖点描述（口语化，说体验不说参数）",
          "evidence": "支撑证据/场景化描述（可选）"
        }
      ]
    },
    "callToAction": {
      "label": "行动号召",
      "content": "促单文案（限时限量/价格锚点/赠品策略，驱动立即行动）"
    }
  },
  "fullScript": "完整的口播脚本文案（将以上三部分自然串联，可直接用于拍摄/直播）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "emotionCurve": "情绪节奏描述（如：焦虑→共鸣→惊喜→下单）"
}

字段规则：
- title: 简短有力，10字以内
- estimatedDuration: 预估口播时长（秒），根据文案字数计算（约 3-4 字/秒）
- sections.hook: 黄金3秒开头，必须足够吸睛，10-15字
- sections.hook.strategy: 从以下策略中选一个：视觉冲击法、悬念提问法、反差对比法、利益承诺法、情感共鸣法
- sections.sellingPoints.points: 2-4个核心卖点，每个卖点用口语化表达
- sections.callToAction: 行动号召，要自然不生硬，有紧迫感
- fullScript: 完整口播文案，是将 hook + sellingPoints + CTA 自然串联的完整文稿
- keywords: 3-5个视频/直播关键词
- emotionCurve: 描述从开头到结尾的情绪变化

注意事项：
1. hook 必须在前3秒抓住注意力，不能平淡开场
2. sellingPoints 要将产品参数转化为用户可感知的体验
3. callToAction 要有紧迫感，不能是"欢迎购买"式的平淡结尾
4. fullScript 要自然流畅，像真人在说话，不能有"第一部分""第二部分"之类的分段标记
5. 文案风格口语化，避免书面语和广告腔
`;

// ==================== Prompt 构建 ====================

function buildUserPrompt(input: {
  productName: string;
  sellingPoints: string;
  category: string;
  style: ScriptStyle;
  targetDuration?: number;
  additionalInfo?: string;
}): string {
  const styleName = STYLE_NAME_MAP[input.style];
  const styleDirective = STYLE_DIRECTIVES[input.style];
  const duration = input.targetDuration || 30;

  return `请为以下商品生成一条${styleName}风格的口播脚本：

【商品信息】
- 商品名称：${input.productName}
- 商品品类：${input.category}
- 核心卖点：${input.sellingPoints}
${input.additionalInfo ? `- 补充信息：${input.additionalInfo}` : ""}

${styleDirective}

${OUTPUT_FORMAT_PROMPT}

目标时长：约 ${duration} 秒（文案字数约 ${duration * 3}-${duration * 4} 字）
请生成1个最优脚本方案。`;
}

// ==================== 工具函数 ====================

function createClient(config: LLMConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
}

/**
 * 从 LLM 返回的文本中提取 JSON
 */
function extractJSON(text: string): string {
  // 移除 markdown 代码块标记
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 找到第一个 { 或 [ 开头的 JSON
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}

// ==================== API Route ====================

/**
 * POST /api/ai/script-generate
 *
 * AI 口播脚本生成 API
 *
 * 请求体：
 * - productName: string        商品名称（必填）
 * - sellingPoints: string      核心卖点（必填）
 * - category: string           商品品类（必填）
 * - style: ScriptStyle         脚本风格（必填，5选1）
 * - targetDuration?: number    目标时长（秒，默认30）
 * - additionalInfo?: string    补充信息（可选）
 * - llmConfig: LLMConfig       LLM 配置（必填）
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const {
    productName,
    sellingPoints,
    category,
    style,
    targetDuration,
    additionalInfo,
    llmConfig,
  } = body as {
    productName?: string;
    sellingPoints?: string;
    category?: string;
    style?: string;
    targetDuration?: number;
    additionalInfo?: string;
    llmConfig?: LLMConfig;
  };

  // ===== 参数校验 =====

  if (!productName || typeof productName !== "string") {
    return NextResponse.json({ error: "请填写商品名称（productName）" }, { status: 400 });
  }

  if (!sellingPoints || typeof sellingPoints !== "string") {
    return NextResponse.json({ error: "请填写核心卖点（sellingPoints）" }, { status: 400 });
  }

  if (!category || typeof category !== "string") {
    return NextResponse.json({ error: "请填写商品品类（category）" }, { status: 400 });
  }

  if (!style || !VALID_STYLES.includes(style as ScriptStyle)) {
    return NextResponse.json(
      {
        error: `请指定脚本风格（style），可选值：${VALID_STYLES.map((s) => `${s}（${STYLE_NAME_MAP[s]}）`).join("、")}`,
      },
      { status: 400 },
    );
  }

  if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
    return NextResponse.json(
      { error: "请配置 LLM 参数（llmConfig.baseUrl、llmConfig.apiKey、llmConfig.model）" },
      { status: 400 },
    );
  }

  // ===== 调用 LLM 生成脚本 =====

  try {
    const client = createClient(llmConfig);

    const userPrompt = buildUserPrompt({
      productName: productName.trim(),
      sellingPoints: sellingPoints.trim(),
      category: category.trim(),
      style: style as ScriptStyle,
      targetDuration,
      additionalInfo: additionalInfo?.trim(),
    });

    const response = await client.chat.completions.create({
      model: llmConfig.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 8000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("LLM 未返回有效内容");
    }

    // 提取并解析 JSON
    const jsonStr = extractJSON(content);
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(`LLM 返回的内容不是合法 JSON: ${jsonStr.substring(0, 300)}`);
    }

    // 补充元信息
    const result = {
      ...parsed,
      meta: {
        productName,
        sellingPoints,
        category,
        style,
        styleName: STYLE_NAME_MAP[style as ScriptStyle],
        targetDuration: targetDuration || 30,
        model: llmConfig.model,
        generatedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("口播脚本生成失败:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `口播脚本生成失败: ${errMsg}` },
      { status: 500 },
    );
  }
}
