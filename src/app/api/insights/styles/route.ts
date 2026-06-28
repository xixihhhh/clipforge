import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { publishMetrics } from "@/lib/db/schema";
import { aggregateByStyle } from "@/lib/performance-insights";

/**
 * GET /api/insights/styles —— 跨所有项目按脚本风格聚合投放数据，得出「哪种风格更能卖」。
 * 转化率(成交/播放)降序，供导出页/仪表盘展示并反哺脚本生成。
 */
export async function GET() {
  const db = getDb();
  const rows = await db.select().from(publishMetrics);
  const insights = aggregateByStyle(
    rows.map((r) => ({
      style: r.style,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      orders: r.orders,
    }))
  );
  return NextResponse.json({ insights, total: rows.length });
}
