import type { Shot } from "@/lib/db/schema";

/**
 * 素材页视图行：由「选中脚本的分镜」+「已落库素材」派生。
 * 纯数据，无 React 依赖，供素材页初次加载与配画面后刷新复用（可单测）。
 */
export interface AssetItem {
  shotId: number;
  type: Shot["type"];
  duration: number;
  description: string;
  prompt: string;
  visualSource: Shot["visualSource"];
  status: "pending" | "generating" | "done" | "failed";
  thumbnailUrl?: string;
  error?: string;
  /** 素材是否为视频（已转动态镜头/图生视频） */
  isVideo?: boolean;
  /** 已落库素材的真实类型（如 stock_footage 表示免费素材库自动配的画面） */
  assetType?: string;
}

/** 视频素材文件后缀（用于区分视频 vs 静态图，决定缩略图与「转动态」入口） */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/** GET /api/project/[id]/assets 返回行里本函数关心的子集 */
export interface SavedAssetRow {
  shotId: number;
  filePath?: string | null;
  status?: string | null;
  type?: string | null;
  /** 视频素材的静态预览图（免费素材视频会落此列）；用作 <img> 缩略图，避免拿 mp4 当图渲染 */
  thumbnailPath?: string | null;
}

/**
 * 把「选中脚本分镜 + 已落库素材」合成素材页视图行。
 * - 已落库且就绪的素材（filePath 为 /api/files 可访问路径）→ 直接就绪并带缩略图；
 * - 商品原图分镜（product_image）→ 用首张商品图就绪；
 * - 其余分镜 → 待生成（pending）。
 * 纯函数，初次加载与「自动配画面」后刷新共用，保证两条路径行为一致。
 */
export function buildAssetRows(
  shots: Shot[],
  savedAssets: SavedAssetRow[],
  productImages: string[],
): AssetItem[] {
  // 已落库且就绪的素材按 shotId 索引
  const savedByShot = new Map<number, SavedAssetRow>();
  for (const a of savedAssets) {
    if (a && a.filePath && a.status === "done") savedByShot.set(a.shotId, a);
  }
  const firstProduct = productImages[0];

  return shots.map((s) => {
    const saved = savedByShot.get(s.shotId);
    if (saved && saved.filePath) {
      // 视频素材：用静态预览图当缩略图（拿 mp4 当 <img> 会裂图），并标记 isVideo 以正确收起「转动态」入口
      const isVideo = VIDEO_EXT.test(saved.filePath);
      return {
        shotId: s.shotId,
        type: s.type,
        duration: s.duration,
        description: s.description,
        prompt: s.prompt ?? "",
        visualSource: s.visualSource,
        status: "done" as const,
        thumbnailUrl: isVideo && saved.thumbnailPath ? saved.thumbnailPath : saved.filePath,
        isVideo: isVideo || undefined,
        assetType: saved.type ?? undefined,
      };
    }
    return {
      shotId: s.shotId,
      type: s.type,
      duration: s.duration,
      description: s.description,
      prompt: s.prompt ?? "",
      visualSource: s.visualSource,
      status: s.visualSource === "product_image" ? ("done" as const) : ("pending" as const),
      thumbnailUrl: s.visualSource === "product_image" ? firstProduct : undefined,
    };
  });
}

/** 仍待配画面（pending）的分镜数 */
export function pendingShotCount(rows: AssetItem[]): number {
  return rows.filter((r) => r.status === "pending").length;
}

/** 仍待配画面、且不是商品原图（商品原图分镜不该用免费素材覆盖）的分镜数 */
export function pendingNonProductShotCount(rows: AssetItem[]): number {
  return rows.filter((r) => r.status === "pending" && r.visualSource !== "product_image").length;
}

/**
 * 是否应展示「自动配画面（免费素材）」入口（免费素材库 = keyless Openverse 图片，零生图 Key）：
 * - topic（无商品一句话成片）项目：始终提供，这是其首选出片路径；
 * - 其它项目（含带货）：当**未配置生图模型**、却仍有待配画面的非商品分镜时提供——
 *   让没有 AI Key 的用户也能给钩子/背书等 B-roll 分镜配好画面（商品原图分镜不受影响）。
 */
export function shouldOfferStockFill(
  rows: AssetItem[],
  contentType: string | undefined,
  hasImageModel: boolean,
): boolean {
  if (rows.length === 0) return false;
  if (contentType === "topic") return true;
  return !hasImageModel && pendingNonProductShotCount(rows) > 0;
}

/**
 * 是否需要提示「未配置默认生图模型」：
 * 未配模型、且仍有 AI 生成分镜尚未出图时才提示；若 AI 分镜都已生成（done），
 * 则不提示——避免与「N/N 个素材已就绪」自相矛盾，给小白造成"出错了"的错觉。
 */
export function needsImageModelWarning(rows: AssetItem[], hasImageModel: boolean): boolean {
  if (hasImageModel) return false;
  return rows.some((r) => r.visualSource === "ai_generate" && r.status !== "done");
}
