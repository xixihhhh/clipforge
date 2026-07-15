/**
 * 购买 CTA 片尾贴 —— 可选的「带货转化」叠加：
 *  - 购买 CTA 片尾卡：最后 ~2.5s 弹「点击下方小黄车」类引导，是带货的直接转化杠杆。
 * 复用 composer 现有 overlay（textOverlay）渲染管线，纯函数可单测。
 */

export type OverlayStyle = "title" | "highlight" | "price";
export interface ComplianceOverlay {
  text: string;
  style: OverlayStyle;
  startTime: number;
  endTime: number;
}
export interface ComplianceOverlayOpts {
  /** 片尾购买 CTA 文案（最后约 2.5s）；空/未传则不加 */
  ctaText?: string;
}

const CTA_TAIL_SECONDS = 2.5;

/** 由选项生成 CTA 叠加层；totalDuration 为成片真实总时长（秒） */
export function buildComplianceOverlays(opts: ComplianceOverlayOpts, totalDuration: number): ComplianceOverlay[] {
  const out: ComplianceOverlay[] = [];
  const total = Math.max(totalDuration, 0.1);

  const cta = (opts.ctaText || "").trim();
  if (cta) {
    const dur = Math.min(CTA_TAIL_SECONDS, total);
    out.push({ text: cta, style: "highlight", startTime: Number(Math.max(0, total - dur).toFixed(3)), endTime: total });
  }

  return out;
}
