/**
 * Pre-publish "throttle-risk" health check — runs a traceable, item-by-item check on the script before rendering
 * (banned words / hook / duration / subtitle readability / call to action / e-commerce three-act structure / AIGC label),
 * giving a pass/warn/fail result plus concrete, actionable advice for each item.
 *
 * Deliberately avoids fake-precise scores like "73 points": whether a commerce video goes viral depends on too many external
 * factors — reporting a number would be misleading. Only evidence-based, actionable check items are included.
 * Pure function, unit-testable; displayed on the script page in the UI.
 */
import { checkScriptCompliance } from "./ad-compliance";
import type { Shot } from "./db/schema";

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckKey = "compliance" | "hook" | "duration" | "caption" | "cta" | "structure" | "aigc" | "productEarly";

export interface ReadinessItem {
  key: CheckKey;
  status: CheckStatus;
  message: string;
}

export interface ReadinessReport {
  items: ReadinessItem[];
  pass: number;
  warn: number;
  fail: number;
  /** Overall readiness: any fail → needsWork (fix recommended); only warns → risky; all pass → ready */
  overall: "ready" | "risky" | "needsWork";
}

export interface ReadinessOptions {
  /** Whether the AIGC compliance label will be burned in; undefined means skip this check */
  aigcLabel?: boolean;
  /** Product name (commerce videos only) — enables the "product visible in the first 3s" hard rule; omit for topic videos */
  productName?: string;
  locale?: "zh" | "en";
}

// E-commerce duration sweet spot (seconds): too short = insufficient info to drive purchase; too long = completion rate drops
const DUR_MIN = 15;
const DUR_SWEET_HI = 45;
const DUR_MAX = 60;
// Opening hook: golden 3-second window, with 1s tolerance — warn at 4s
const HOOK_MAX_SEC = 4;
// Maximum subtitle reading speed (CJK chars/second); exceeding this makes subtitles unreadable
const READ_CPS = 9;

// "Product visible within the first N seconds" hard rule (2026 Douyin: cart-linked videos that
// tease a story and only reveal the product at the end are treated as completion-baiting and
// suppressed; the product must appear inside the opening 3 seconds)
const PRODUCT_EARLY_SEC = 3;
const PRODUCT_LATE_SEC = 7;
// shot types that inherently show the product
const PRODUCT_SHOT_TYPES = new Set(["product_reveal", "product_intro", "demo"]);

// Hook signals: question / number / pain-point / contrast — any one qualifies as "has a hook"
const HOOK_SIGNAL = /[?？!！]|\d|别再|还在|总是|为什么|怎么|居然|竟然|没想到|原来|你知道|千万别|后悔|踩雷|谁懂|绝了/;
// Call-to-action signals
const CTA_SIGNAL = /小黄车|下方|点击|购买|带走|链接|加购|抢|下单|橱窗|入手|戳|领|tap|link|buy|shop|cart|grab/i;

const cjkLen = (s: string) => Array.from((s || "").replace(/\s+/g, "")).length;

export function checkPublishReadiness(
  shots: Shot[],
  totalDuration: number,
  opts: ReadinessOptions = {}
): ReadinessReport {
  const en = opts.locale === "en";
  const items: ReadinessItem[] = [];
  const push = (key: CheckKey, status: CheckStatus, message: string) => items.push({ key, status, message });

  // 1) Ad-law / banned words
  const violations = checkScriptCompliance(shots);
  if (violations.length === 0) {
    push("compliance", "pass", en ? "No ad-law risk words" : "无广告法风险词");
  } else {
    const words = [...new Set(violations.map((v) => v.term))].slice(0, 5).join(" / ");
    push(
      "compliance",
      "fail",
      en
        ? `${violations.length} ad-law risk word(s) (${words}) — platforms throttle absolute/false-efficacy claims; fix before publishing`
        : `${violations.length} 处广告法风险词（${words}）——平台对绝对化/虚假功效易限流，建议先改`
    );
  }

  // 2) Opening hook
  const hook = shots.find((s) => s.type === "hook") ?? shots[0];
  if (!hook || !(hook.voiceover || "").trim()) {
    push("hook", "fail", en ? "Missing opening hook (shot 1 should be a hook with voiceover)" : "缺开场钩子（第 1 镜应是 hook，且要有口播）");
  } else if (hook.duration > HOOK_MAX_SEC) {
    push("hook", "warn", en ? `Opening hook is ${hook.duration}s — grab attention within the first 3s` : `开场钩子 ${hook.duration}s 偏长——黄金 3 秒内要抓住人`);
  } else if (!HOOK_SIGNAL.test(hook.voiceover)) {
    push("hook", "warn", en ? "Opening hook is flat — add a question / pain-point / number" : "开场钩子偏平——加个疑问 / 痛点 / 数字会更抓人");
  } else {
    push("hook", "pass", en ? "Opening hook is short and punchy" : "开场钩子够短够冲");
  }

  // 3) Duration sweet spot
  const d = Math.round(totalDuration);
  if (d < DUR_MIN) {
    push("duration", "warn", en ? `Total ${d}s is short — may not be enough to drive a purchase` : `总时长 ${d}s 偏短——信息可能不足以促单`);
  } else if (d > DUR_MAX) {
    push("duration", "warn", en ? `Total ${d}s is long — completion rate drops; e-commerce sweet spot ~21–45s` : `总时长 ${d}s 偏长——完播率易掉，带货甜区约 21–45s`);
  } else {
    const note = d > DUR_SWEET_HI ? (en ? " (upper edge)" : "（偏上限）") : "";
    push("duration", "pass", en ? `Total ${d}s is in the e-commerce sweet spot${note}` : `总时长 ${d}s 在带货甜区${note}`);
  }

  // 4) Subtitle readability: check each shot's voiceover character count / duration; flag if reading speed is exceeded
  const dense = shots
    .filter((s) => s.duration > 0 && cjkLen(s.voiceover) / s.duration > READ_CPS)
    .map((s) => s.shotId);
  if (dense.length === 0) {
    push("caption", "pass", en ? "Subtitle pacing is readable" : "字幕节奏可读");
  } else {
    push(
      "caption",
      "warn",
      en
        ? `Shot(s) ${dense.join(", ")} have too-dense subtitles to read — trim copy or add time`
        : `第 ${dense.join("、")} 镜字幕过密、读不完——精简文案或加时长`
    );
  }

  // 5) Call to action
  const hasCtaShot = shots.some((s) => s.type === "cta");
  const hasCtaWords = shots.some((s) => CTA_SIGNAL.test(s.voiceover || "") || CTA_SIGNAL.test(s.textOverlay?.text || ""));
  if (hasCtaShot || hasCtaWords) {
    push("cta", "pass", en ? "Has a clear call to action" : "有明确行动号召");
  } else {
    push("cta", "warn", en ? "No clear call to action (e.g. 'tap the cart below') — hurts conversion" : "缺明确行动号召（如「点下方小黄车」）——转化会打折");
  }

  // 6) E-commerce three-act structure: hook → reveal/demo → CTA
  const types = new Set(shots.map((s) => s.type));
  const missing: string[] = [];
  if (!types.has("hook")) missing.push(en ? "hook" : "钩子");
  if (!types.has("product_reveal") && !types.has("demo")) missing.push(en ? "reveal/demo" : "展示/演示");
  if (!types.has("cta")) missing.push(en ? "CTA" : "号召");
  if (missing.length === 0) {
    push("structure", "pass", en ? "Complete hook → reveal → CTA structure" : "带货三段式完整");
  } else {
    push(
      "structure",
      "warn",
      en
        ? `Missing "${missing.join(", ")}" — the e-commerce structure is hook → reveal/demo → CTA`
        : `结构缺「${missing.join("、")}」——带货三段式：钩子 → 展示/演示 → 号召`
    );
  }

  // 7) Product visible in the first 3s (commerce hard rule; only when the caller passes productName)
  if (opts.productName?.trim()) {
    const name = opts.productName.trim();
    const showsProduct = (s: Shot) =>
      s.visualSource === "product_image" ||
      PRODUCT_SHOT_TYPES.has(s.type ?? "") ||
      (s.voiceover ?? "").includes(name) ||
      (s.description ?? "").includes(name) ||
      (s.textOverlay?.text ?? "").includes(name);
    let elapsed = 0;
    let firstAt: number | null = null;
    for (const s of shots) {
      if (showsProduct(s)) {
        firstAt = elapsed;
        break;
      }
      elapsed += s.duration || 0;
    }
    if (firstAt !== null && firstAt <= PRODUCT_EARLY_SEC) {
      push("productEarly", "pass", en ? "Product appears within the first 3s" : "商品在前 3 秒内出现");
    } else if (firstAt !== null && firstAt <= PRODUCT_LATE_SEC) {
      push(
        "productEarly",
        "warn",
        en
          ? `Product first appears at ~${Math.round(firstAt)}s — cart-linked videos should show it inside 3s`
          : `商品约 ${Math.round(firstAt)}s 才出现——挂车视频应在前 3 秒露出商品`
      );
    } else {
      push(
        "productEarly",
        "fail",
        en
          ? `Product ${firstAt === null ? "never clearly appears" : `first appears at ~${Math.round(firstAt)}s`} — platforms treat "story first, product last" cart videos as completion-baiting and suppress them; put the product in the opening shot`
          : `商品${firstAt === null ? "全程没有明确出现" : `约 ${Math.round(firstAt)}s 才出现`}——平台把「先讲故事最后亮产品」的挂车视频判为骗完播限流，请把商品放进开场镜头`
      );
    }
  }

  // 8) AIGC compliance label (only checked when the caller provides the toggle state)
  if (opts.aigcLabel === true) {
    push("aigc", "pass", en ? "AIGC compliance label is on" : "已开 AIGC 合规标签");
  } else if (opts.aigcLabel === false) {
    push("aigc", "warn", en ? "AIGC label is off — platforms may down-rank unlabeled AI content" : "未开 AIGC 合规标签——平台对未标注 AI 内容可能降权");
  }

  const pass = items.filter((i) => i.status === "pass").length;
  const warn = items.filter((i) => i.status === "warn").length;
  const fail = items.filter((i) => i.status === "fail").length;
  const overall = fail > 0 ? "needsWork" : warn > 0 ? "risky" : "ready";
  return { items, pass, warn, fail, overall };
}
