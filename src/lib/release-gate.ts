/**
 * Release gate — one aggregated pre-publish verdict over the checks the pipeline already runs
 * separately: script publish-readiness (ad-law words / hook / duration / CTA / early product),
 * composed-video QC (streams / black / silence / loudness) and the asset license manifest
 * (commercial risk / attribution). Callers assemble the three sub-reports; this module only maps
 * them onto a single pass|warn|fail report with strict, scriptable semantics:
 *
 *   - fail  → something is objectively broken or platform-risky; do not publish as-is
 *   - warn  → needs a human decision (license review, attribution, soft risks)
 *   - pass  → nothing blocking found by the automated checks
 *
 * Pure functions; the route/CLI/MCP feed it data. CLI maps fail (and warn under --strict) to
 * exit code 2 so shell scripts and agents can gate on it.
 */
import type { QcReport } from "@/lib/video-composer/qc";
import type { CreditsManifest } from "@/lib/asset-credits";
import type { ReadinessReport } from "@/lib/publish-readiness";

export type GateStatus = "pass" | "warn" | "fail";
export type GateItemId = "readiness" | "qc" | "credits";

export interface GateItem {
  id: GateItemId;
  status: GateStatus;
  /** one-line summary, bilingual — UI/CLI pick by locale */
  message: { zh: string; en: string };
  /** concrete problems behind a warn/fail, ready to display as sub-lines */
  problems: { zh: string; en: string }[];
}

export interface GateReport {
  /** worst status across items */
  status: GateStatus;
  items: GateItem[];
  summary: { pass: number; warn: number; fail: number };
  verdict: { zh: string; en: string };
}

/**
 * Script readiness → gate item. `checkPublishReadiness` returns single-locale strings, so the
 * caller runs it once per locale on identical input; the item lists are index-aligned because the
 * checker is deterministic.
 */
export function gateItemFromReadiness(zh: ReadinessReport | null, en: ReadinessReport | null): GateItem {
  if (!zh || !en) {
    return {
      id: "readiness",
      status: "fail",
      message: {
        zh: "没有可检查的脚本——先生成并选择脚本",
        en: "No script to check — generate and select a script first",
      },
      problems: [],
    };
  }
  const problems = zh.items
    .map((item, i) => ({ item, enMsg: en.items[i]?.message ?? item.message }))
    .filter(({ item }) => item.status !== "pass")
    .map(({ item, enMsg }) => ({ zh: item.message, en: enMsg }));
  if (zh.overall === "needsWork") {
    return {
      id: "readiness",
      status: "fail",
      message: {
        zh: `脚本发布就绪检查未过（${zh.fail} 项需修复、${zh.warn} 项有风险）`,
        en: `Script readiness check failed (${zh.fail} to fix, ${zh.warn} risky)`,
      },
      problems,
    };
  }
  if (zh.overall === "risky") {
    return {
      id: "readiness",
      status: "warn",
      message: {
        zh: `脚本发布就绪检查有 ${zh.warn} 项风险提示`,
        en: `Script readiness check has ${zh.warn} risk warning(s)`,
      },
      problems,
    };
  }
  return {
    id: "readiness",
    status: "pass",
    message: { zh: "脚本发布就绪检查全部通过", en: "Script readiness checks all passed" },
    problems: [],
  };
}

/** Composed-video QC → gate item. `null` means nothing was composed yet — that alone blocks publishing. */
export function gateItemFromQc(qc: QcReport | null): GateItem {
  if (!qc) {
    return {
      id: "qc",
      status: "fail",
      message: { zh: "还没有成片——先合成视频再过门禁", en: "No composed video yet — compose before gating" },
      problems: [],
    };
  }
  const problems = qc.checks.filter((c) => c.level !== "ok").map((c) => c.message);
  if (qc.status === "fail") {
    const n = qc.checks.filter((c) => c.level === "fail").length;
    return {
      id: "qc",
      status: "fail",
      message: { zh: `成片质检不通过（${n} 项失败）`, en: `Video QC failed (${n} check(s))` },
      problems,
    };
  }
  if (qc.status === "warn") {
    return {
      id: "qc",
      status: "warn",
      message: {
        zh: `成片质检有 ${problems.length} 项警告`,
        en: `Video QC has ${problems.length} warning(s)`,
      },
      problems,
    };
  }
  return {
    id: "qc",
    status: "pass",
    message: { zh: "成片质检通过", en: "Video QC passed" },
    problems: [],
  };
}

/**
 * Asset license manifest → gate item. License review is inherently a human decision, so restricted /
 * unknown licenses map to warn (blocking under --strict), never to an automated fail.
 */
export function gateItemFromCredits(m: CreditsManifest | null): GateItem {
  if (!m) {
    return {
      id: "credits",
      status: "warn",
      message: {
        zh: "没有素材记录可核对授权——若用了外部素材请人工确认",
        en: "No asset records to verify licensing — confirm manually if external footage was used",
      },
      problems: [],
    };
  }
  const rows = [...m.items, ...(m.bgm ? [m.bgm] : [])];
  const problems = rows
    .filter((i) => i.risk === "review")
    .map((i) => {
      const zhWhere = i.shotId >= 0 ? `分镜 ${i.shotId + 1}` : "BGM";
      const enWhere = i.shotId >= 0 ? `Shot ${i.shotId + 1}` : "BGM";
      return {
        zh: `${zhWhere}：${i.license || "许可未知"} — ${i.note.zh}`,
        en: `${enWhere}: ${i.license || "license unknown"} — ${i.note.en}`,
      };
    });
  if (m.summary.needsAttribution > 0) {
    problems.push({
      zh: `${m.summary.needsAttribution} 条署名行需随发布文案附上（见授权清单）`,
      en: `${m.summary.needsAttribution} attribution line(s) must accompany the post (see the manifest)`,
    });
  }
  if (m.summary.needsReview > 0) {
    return {
      id: "credits",
      status: "warn",
      message: {
        zh: `${m.summary.needsReview} 项素材许可需人工复核（NC/ND/未知）——投流前确认或替换`,
        en: `${m.summary.needsReview} asset license(s) need manual review (NC/ND/unknown) — confirm or replace before running ads`,
      },
      problems,
    };
  }
  if (m.summary.needsAttribution > 0) {
    return {
      id: "credits",
      status: "warn",
      message: {
        zh: `素材可商用，但 ${m.summary.needsAttribution} 条署名需随发布附上`,
        en: `Assets are commercial-safe, but ${m.summary.needsAttribution} attribution(s) must accompany the post`,
      },
      problems,
    };
  }
  return {
    id: "credits",
    status: "pass",
    message: { zh: "素材授权可商用，无需署名", en: "Assets are commercial-safe, no attribution required" },
    problems: [],
  };
}

/** Aggregate gate items into the final report (worst status wins). Pure function. */
export function buildGateReport(items: GateItem[]): GateReport {
  const pass = items.filter((i) => i.status === "pass").length;
  const warn = items.filter((i) => i.status === "warn").length;
  const fail = items.filter((i) => i.status === "fail").length;
  const status: GateStatus = fail > 0 ? "fail" : warn > 0 ? "warn" : "pass";
  const verdict =
    status === "fail"
      ? {
          zh: "未过发布门禁——存在必须修复的问题，请勿直接发布/投流",
          en: "Release gate failed — fix the blocking issues before publishing or running ads",
        }
      : status === "warn"
        ? {
            zh: "有条件通过——存在需人工确认的风险项，确认后再发布",
            en: "Conditionally passed — review the flagged risks before publishing",
          }
        : {
            zh: "通过发布门禁——自动检查未发现拦截项",
            en: "Release gate passed — no blocking issues found by automated checks",
          };
  return { status, items, summary: { pass, warn, fail }, verdict };
}
