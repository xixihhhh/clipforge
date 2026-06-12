// 新手示例包：示例商品（一键填充/导入商品库）、参考脚本结构、首页示例作品展示。
// 说明：这些是「官方示例」，与用户真实创建的数据完全分离、明确标注，不会混入「我的项目」。
import type { Shot } from "@/lib/db/schema";

// 示例商品品类（对齐商品库 ProductItem.category）
export interface ExampleProduct {
  id: string;
  name: string;
  category: "beauty" | "food" | "home" | "fashion" | "tech" | "other";
  /** 卖点描述（同时用于商品库 description / 新建表单 sellingPoints） */
  sellingPoints: string;
  price: string;
  /** 打包在 public/examples 下的真实商品图 */
  image: string;
}

export const exampleProducts: ExampleProduct[] = [
  {
    id: "ex-juicer",
    name: "便携榨汁杯",
    category: "tech",
    sellingPoints: "USB 充电随身榨，30 秒一杯鲜榨果汁；六叶刀头碎冰碎果，办公室、健身房、出差都能用；杯体可水洗，清洗 0 负担。",
    price: "129",
    image: "/examples/juicer.png",
  },
  {
    id: "ex-coffee",
    name: "冷萃咖啡液",
    category: "food",
    sellingPoints: "0 糖 0 脂，3 秒冲一杯；冷热都好喝，兑水兑奶皆可；独立小包装随身带，上班族续命、健身控糖都适合。",
    price: "59",
    image: "/examples/coffee.png",
  },
  {
    id: "ex-tissue",
    name: "云柔加厚抽纸",
    category: "home",
    sellingPoints: "加厚 3 层，湿水不破不掉屑；原生木浆亲肤不刺激，宝宝孕妇可用；整箱囤更划算，家用车用办公都合适。",
    price: "39",
    image: "/examples/tissue.png",
  },
];

// 参考脚本结构（高转化带货分镜模板，供「示例作品」展示与新手参考）
export interface ExampleTemplate {
  id: string;
  name: string;
  styleType: "pain_point" | "comparison" | "story";
  styleLabel: string;
  description: string;
  totalDuration: number;
  shots: Shot[];
}

export const exampleTemplates: ExampleTemplate[] = [
  {
    id: "tpl-pain",
    name: "痛点种草·黄金3秒",
    styleType: "pain_point",
    styleLabel: "痛点种草",
    description: "开头 3 秒抛痛点抓眼球，放大场景共鸣，再用产品给出解法，最后限时促单。最通用的带货结构。",
    totalDuration: 28,
    shots: [
      { shotId: 1, type: "hook", duration: 3, description: "第一人称视角快速切入，抛出尖锐痛点提问", camera: "手持跟拍", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "你是不是也受够了___？", prompt: "" },
      { shotId: 2, type: "pain_point", duration: 5, description: "放大使用前的痛点场景，引起共鸣", camera: "特写", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "每次都___，真的太难受了", prompt: "" },
      { shotId: 3, type: "product_reveal", duration: 4, description: "产品登场，缓慢推进展示包装", camera: "缓慢推进", visualSource: "product_image", transition: "ai_start_end", voiceover: "直到我用上了它", prompt: "" },
      { shotId: 4, type: "demo", duration: 8, description: "真实演示核心卖点与使用效果", camera: "中景", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "你看，___，完全解决了", prompt: "" },
      { shotId: 5, type: "cta", duration: 3, description: "商品+价格+购物车，引导下单", camera: "固定", visualSource: "product_image", transition: "direct_concat", voiceover: "限时优惠，赶紧抢！", prompt: "" },
    ],
  },
  {
    id: "tpl-compare",
    name: "对比测评·横向种草",
    styleType: "comparison",
    styleLabel: "对比测评",
    description: "多款横向对比，用真实测试凸显本品优势，再用销量好评背书，适合理性决策品类。",
    totalDuration: 30,
    shots: [
      { shotId: 1, type: "hook", duration: 3, description: "多款产品并排，抛出测评悬念", camera: "俯拍全景", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "花了___块测了 5 款，告诉你哪款最值", prompt: "" },
      { shotId: 2, type: "demo", duration: 9, description: "逐一对比测试核心指标", camera: "特写对比", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "第一款不行…这款居然还可以？", prompt: "" },
      { shotId: 3, type: "product_reveal", duration: 4, description: "本品胜出，特写展示", camera: "推进", visualSource: "product_image", transition: "ai_start_end", voiceover: "最后赢家就是它", prompt: "" },
      { shotId: 4, type: "social_proof", duration: 6, description: "销量数据与好评背书", camera: "固定", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "月销 10 万+，好评率 99%", prompt: "" },
      { shotId: 5, type: "cta", duration: 3, description: "下单引导与赠品信息", camera: "固定", visualSource: "product_image", transition: "direct_concat", voiceover: "链接在小黄车，今天下单还送赠品", prompt: "" },
    ],
  },
  {
    id: "tpl-story",
    name: "剧情故事·情景代入",
    styleType: "story",
    styleLabel: "剧情故事",
    description: "用一个有代入感的小故事包装产品，情绪先行、卖点自然融入，适合美妆、食品等感性品类。",
    totalDuration: 26,
    shots: [
      { shotId: 1, type: "hook", duration: 3, description: "主角登场，制造悬念开头", camera: "正面中景", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "那天发生了一件超尴尬的事", prompt: "" },
      { shotId: 2, type: "pain_point", duration: 5, description: "故事中的尴尬/痛点情节", camera: "特写", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "我当时真的恨不得找个地缝钻进去", prompt: "" },
      { shotId: 3, type: "product_reveal", duration: 3, description: "产品作为转折点出现", camera: "特写", visualSource: "product_image", transition: "ai_start_end", voiceover: "还好包里有它", prompt: "" },
      { shotId: 4, type: "demo", duration: 7, description: "使用后情节反转，效果展示", camera: "中景", visualSource: "ai_generate", transition: "ai_start_end", voiceover: "用完之后，整个人都自信了", prompt: "" },
      { shotId: 5, type: "cta", duration: 3, description: "结尾种草与下单引导", camera: "固定", visualSource: "product_image", transition: "direct_concat", voiceover: "姐妹们真的快冲！", prompt: "" },
    ],
  },
];

// 首页「示例作品」：一个完整可看的样例（脚本结构 + 已合成样片）
export interface ExampleShowcase {
  id: string;
  title: string;
  productName: string;
  category: string;
  styleLabel: string;
  totalDuration: number;
  resolution: string;
  aspectRatio: string;
  cover: string; // 封面图
  videoUrl: string; // 打包样片
  shots: Shot[];
}

export const exampleShowcase: ExampleShowcase = {
  id: "showcase-tissue",
  title: "云柔加厚抽纸·痛点种草",
  productName: "云柔加厚抽纸",
  category: "家居日用",
  styleLabel: "痛点种草",
  totalDuration: 28,
  resolution: "1080p",
  aspectRatio: "9:16",
  cover: "/examples/tissue.png",
  videoUrl: "/examples/sample-tissue.mp4",
  shots: exampleTemplates[0].shots.map((s, i) => ({
    ...s,
    voiceover:
      i === 0
        ? "你还在用一擦就破的纸巾？"
        : i === 1
        ? "普通纸巾一沾水就烂，擦个嘴满脸纸屑"
        : i === 2
        ? "直到我换上了这款云柔抽纸"
        : i === 3
        ? "加厚 3 层，湿水都不破，亲肤不掉屑"
        : "整箱囤更划算，赶紧去抢！",
  })),
};
