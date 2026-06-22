/**
 * 合规标识 + 购买 CTA 片尾贴 —— 两个可选的「带货 + 合规」叠加：
 *  - AI 生成标识：TikTok / 抖音自 2025 末起要求 AI 合成内容打标识；披露反而与更高转化正相关。
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
  /** 加「AI 生成」合规标识（全程显示，顶部） */
  aiDisclosure?: boolean;
  /** 自定义合规标识文案，默认「AI 生成 · 广告」 */
  disclosureText?: string;
  /** 片尾购买 CTA 文案（最后约 2.5s）；空/未传则不加 */
  ctaText?: string;
}

const CTA_TAIL_SECONDS = 2.5;

/** 由选项生成合规/CTA 叠加层；totalDuration 为成片真实总时长（秒） */
export function buildComplianceOverlays(opts: ComplianceOverlayOpts, totalDuration: number): ComplianceOverlay[] {
  const out: ComplianceOverlay[] = [];
  const total = Math.max(totalDuration, 0.1);

  if (opts.aiDisclosure) {
    const text = (opts.disclosureText || "AI 生成 · 广告").trim();
    if (text) out.push({ text, style: "title", startTime: 0, endTime: total });
  }

  const cta = (opts.ctaText || "").trim();
  if (cta) {
    const dur = Math.min(CTA_TAIL_SECONDS, total);
    out.push({ text: cta, style: "highlight", startTime: Number(Math.max(0, total - dur).toFixed(3)), endTime: total });
  }

  return out;
}
