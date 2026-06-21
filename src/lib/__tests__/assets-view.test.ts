import { describe, it, expect } from "vitest";
import {
  buildAssetRows,
  pendingShotCount,
  pendingNonProductShotCount,
  shouldOfferStockFill,
  needsImageModelWarning,
  type SavedAssetRow,
} from "@/lib/assets-view";
import type { Shot } from "@/lib/db/schema";

// 造一个最小可用的分镜
function shot(partial: Partial<Shot> & { shotId: number }): Shot {
  return {
    shotId: partial.shotId,
    type: partial.type ?? "hook",
    duration: partial.duration ?? 3,
    description: partial.description ?? `镜头${partial.shotId}`,
    camera: partial.camera ?? "static",
    visualSource: partial.visualSource ?? "ai_generate",
    transition: partial.transition ?? "ffmpeg_fade",
    voiceover: partial.voiceover ?? "",
    prompt: partial.prompt ?? "",
    stockKeywords: partial.stockKeywords,
  };
}

describe("buildAssetRows", () => {
  it("已落库且就绪的素材 → 就绪并带缩略图，透传 assetType", () => {
    const shots = [shot({ shotId: 1, visualSource: "ai_generate" })];
    const saved: SavedAssetRow[] = [
      { shotId: 1, filePath: "/api/files/p1/stock/a.jpg", status: "done", type: "stock_footage" },
    ];
    const rows = buildAssetRows(shots, saved, []);
    expect(rows[0].status).toBe("done");
    expect(rows[0].thumbnailUrl).toBe("/api/files/p1/stock/a.jpg");
    expect(rows[0].assetType).toBe("stock_footage");
    expect(rows[0].isVideo).toBeUndefined(); // 图片素材不是视频
  });

  it("视频素材（mp4）→ 标记 isVideo，缩略图取静态预览图而非 mp4", () => {
    const shots = [shot({ shotId: 1, visualSource: "ai_generate" })];
    const saved: SavedAssetRow[] = [
      {
        shotId: 1,
        filePath: "/api/files/p1/stock/clip.mp4",
        thumbnailPath: "https://cdn/preview.jpg",
        status: "done",
        type: "stock_footage",
      },
    ];
    const rows = buildAssetRows(shots, saved, []);
    expect(rows[0].isVideo).toBe(true);
    expect(rows[0].thumbnailUrl).toBe("https://cdn/preview.jpg"); // 用预览图，不拿 mp4 当 <img>
  });

  it("视频素材但无预览图 → isVideo 仍为 true，缩略图回退到文件本身", () => {
    const shots = [shot({ shotId: 1 })];
    const saved: SavedAssetRow[] = [
      { shotId: 1, filePath: "/api/files/p1/x.webm", status: "done", type: "stock_footage" },
    ];
    const rows = buildAssetRows(shots, saved, []);
    expect(rows[0].isVideo).toBe(true);
    expect(rows[0].thumbnailUrl).toBe("/api/files/p1/x.webm");
  });

  it("未就绪的落库素材（status 非 done）不算就绪", () => {
    const shots = [shot({ shotId: 1 })];
    const saved: SavedAssetRow[] = [{ shotId: 1, filePath: "/x.jpg", status: "pending" }];
    const rows = buildAssetRows(shots, saved, []);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].thumbnailUrl).toBeUndefined();
  });

  it("商品原图分镜 → 用首张商品图直接就绪", () => {
    const shots = [shot({ shotId: 1, visualSource: "product_image" })];
    const rows = buildAssetRows(shots, [], ["/uploads/prod.jpg"]);
    expect(rows[0].status).toBe("done");
    expect(rows[0].thumbnailUrl).toBe("/uploads/prod.jpg");
  });

  it("普通 AI 分镜无素材 → 待生成", () => {
    const shots = [shot({ shotId: 1, visualSource: "ai_generate" })];
    const rows = buildAssetRows(shots, [], []);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].thumbnailUrl).toBeUndefined();
  });

  it("落库素材覆盖商品图（已生成优先于商品原图兜底）", () => {
    const shots = [shot({ shotId: 1, visualSource: "product_image" })];
    const saved: SavedAssetRow[] = [
      { shotId: 1, filePath: "/api/files/p1/a.png", status: "done", type: "ai_generated" },
    ];
    const rows = buildAssetRows(shots, saved, ["/uploads/prod.jpg"]);
    expect(rows[0].thumbnailUrl).toBe("/api/files/p1/a.png");
    expect(rows[0].assetType).toBe("ai_generated");
  });
});

describe("pendingShotCount", () => {
  it("统计 pending 分镜数", () => {
    const rows = buildAssetRows(
      [shot({ shotId: 1 }), shot({ shotId: 2, visualSource: "product_image" }), shot({ shotId: 3 })],
      [],
      ["/p.jpg"],
    );
    // shot1/shot3 pending，shot2 用商品图就绪
    expect(pendingShotCount(rows)).toBe(2);
  });
});

describe("pendingNonProductShotCount", () => {
  it("只数待配且非商品原图的分镜", () => {
    const rows = buildAssetRows(
      [
        shot({ shotId: 1, visualSource: "ai_generate" }), // pending b-roll
        shot({ shotId: 2, visualSource: "product_image" }), // 商品图就绪
        shot({ shotId: 3, visualSource: "ai_generate" }), // pending b-roll
      ],
      [],
      ["/p.jpg"],
    );
    expect(pendingNonProductShotCount(rows)).toBe(2);
  });
});

describe("shouldOfferStockFill", () => {
  // 两个 ai_generate 分镜、无素材 → 都是待配的非商品 B-roll
  const brollRows = buildAssetRows([shot({ shotId: 1 }), shot({ shotId: 2 })], [], []);

  it("topic 项目 → 始终提供（即便已配生图模型，免费素材是其首选路径）", () => {
    expect(shouldOfferStockFill(brollRows, "topic", true)).toBe(true);
  });

  it("带货项目·未配生图模型·有待配 B-roll → 提供（让无 Key 用户也能配画面）", () => {
    expect(shouldOfferStockFill(brollRows, "product", false)).toBe(true);
  });

  it("带货项目·已配生图模型 → 不提供（走 AI 生成，避免入口冗余）", () => {
    expect(shouldOfferStockFill(brollRows, "product", true)).toBe(false);
  });

  it("带货项目·全是商品原图且已就绪 → 不提供（不该用免费素材盖商品图）", () => {
    const rows = buildAssetRows([shot({ shotId: 1, visualSource: "product_image" })], [], ["/p.jpg"]);
    expect(shouldOfferStockFill(rows, "product", false)).toBe(false);
  });

  it("空分镜 → 不提供", () => {
    expect(shouldOfferStockFill([], "topic", false)).toBe(false);
  });
});

describe("needsImageModelWarning", () => {
  it("已配生图模型 → 不提示", () => {
    const rows = buildAssetRows([shot({ shotId: 1, visualSource: "ai_generate" })], [], []);
    expect(needsImageModelWarning(rows, true)).toBe(false);
  });

  it("未配模型·有 AI 分镜待出图 → 提示", () => {
    const rows = buildAssetRows([shot({ shotId: 1, visualSource: "ai_generate" })], [], []);
    expect(needsImageModelWarning(rows, false)).toBe(true);
  });

  it("未配模型·AI 分镜都已生成 → 不提示（避免与「已就绪」矛盾）", () => {
    const saved: SavedAssetRow[] = [
      { shotId: 1, filePath: "/api/files/p/reel1.png", status: "done", type: "ai_generated" },
    ];
    const rows = buildAssetRows([shot({ shotId: 1, visualSource: "ai_generate" })], saved, []);
    expect(needsImageModelWarning(rows, false)).toBe(false);
  });

  it("未配模型·只有商品原图分镜（无 AI 生成）→ 不提示", () => {
    const rows = buildAssetRows([shot({ shotId: 1, visualSource: "product_image" })], [], ["/p.jpg"]);
    expect(needsImageModelWarning(rows, false)).toBe(false);
  });
});
