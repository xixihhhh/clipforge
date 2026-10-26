import { randomUUID } from "@/lib/uuid";
import type { GenerationMode } from "@/lib/providers/types";
import type { QcReport } from "@/lib/video-composer/qc";

export interface CreativeIntent {
  subject: string;
  action?: string;
  environment?: string;
  lighting?: string;
  palette?: string;
  composition?: string;
  camera?: string;
  motion?: string;
  continuity?: string[];
  productConstraints?: string[];
  negative?: string[];
}

const clean = (value: unknown, max = 300): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const cleanList = (value: unknown, max = 12): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => clean(item, 120)).filter(Boolean))].slice(0, max)
  : [];

export function sanitizeCreativeIntent(value: unknown): CreativeIntent {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    subject: clean(raw.subject),
    ...(clean(raw.action) && { action: clean(raw.action) }),
    ...(clean(raw.environment) && { environment: clean(raw.environment) }),
    ...(clean(raw.lighting) && { lighting: clean(raw.lighting) }),
    ...(clean(raw.palette) && { palette: clean(raw.palette) }),
    ...(clean(raw.composition) && { composition: clean(raw.composition) }),
    ...(clean(raw.camera) && { camera: clean(raw.camera) }),
    ...(clean(raw.motion) && { motion: clean(raw.motion) }),
    ...(cleanList(raw.continuity).length && { continuity: cleanList(raw.continuity) }),
    ...(cleanList(raw.productConstraints).length && { productConstraints: cleanList(raw.productConstraints) }),
    ...(cleanList(raw.negative).length && { negative: cleanList(raw.negative) }),
  };
}

/** Compile provider-neutral creative intent into a deterministic prompt suffix. */
export function compileCreativePrompt(intent: CreativeIntent): { prompt: string; negativePrompt: string } {
  const parts = [
    intent.subject,
    intent.action,
    intent.environment && `Environment: ${intent.environment}`,
    intent.lighting && `Lighting: ${intent.lighting}`,
    intent.palette && `Palette: ${intent.palette}`,
    intent.composition && `Composition: ${intent.composition}`,
    intent.camera && `Camera: ${intent.camera}`,
    intent.motion && `Motion: ${intent.motion}`,
    intent.continuity?.length ? `Continuity anchors: ${intent.continuity.join("; ")}` : "",
    intent.productConstraints?.length ? `Product invariants: ${intent.productConstraints.join("; ")}` : "",
  ].filter(Boolean);
  return { prompt: parts.join(". "), negativePrompt: (intent.negative ?? []).join(", ") };
}

export interface VisualBible {
  characterAnchors: string[];
  productAnchors: string[];
  wardrobeAnchors: string[];
  environmentAnchors: string[];
  lightingAnchors: string[];
  forbiddenChanges: string[];
}

export interface ProjectMediaInsight {
  id: string;
  mediaType: "image" | "video";
  summary: string;
  tags: string[];
  reusablePrompt: string;
  addedAt: string;
}

export interface ProductionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  scriptId?: string;
  assetIds: string[];
  compositionId?: string;
}

export function sanitizeProjectMediaInsight(value: unknown): ProjectMediaInsight | null {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const mediaType = raw.mediaType === "video" ? "video" : raw.mediaType === "image" ? "image" : null;
  const summary = clean(raw.summary, 600);
  if (!mediaType || !summary) return null;
  return {
    id: clean(raw.id, 80) || randomUUID(),
    mediaType,
    summary,
    tags: cleanList(raw.tags),
    reusablePrompt: clean(raw.reusablePrompt, 1200),
    addedAt: clean(raw.addedAt, 40) || new Date().toISOString(),
  };
}

export function sanitizeVisualBible(value: unknown): VisualBible {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    characterAnchors: cleanList(raw.characterAnchors),
    productAnchors: cleanList(raw.productAnchors),
    wardrobeAnchors: cleanList(raw.wardrobeAnchors),
    environmentAnchors: cleanList(raw.environmentAnchors),
    lightingAnchors: cleanList(raw.lightingAnchors),
    forbiddenChanges: cleanList(raw.forbiddenChanges),
  };
}

export interface ConsistencyIssue {
  kind: "missing-anchor" | "forbidden-change";
  anchor: string;
  severity: "warn" | "fail";
}

/** Conservative text-level precheck; visual post-check can layer on top without changing the contract. */
export function checkPromptConsistency(prompt: string, bible: VisualBible): ConsistencyIssue[] {
  const haystack = prompt.toLowerCase();
  const required = [...bible.characterAnchors, ...bible.productAnchors, ...bible.wardrobeAnchors];
  const issues: ConsistencyIssue[] = required
    .filter((anchor) => !haystack.includes(anchor.toLowerCase()))
    .map((anchor) => ({ kind: "missing-anchor", anchor, severity: "warn" }));
  for (const forbidden of bible.forbiddenChanges) {
    if (haystack.includes(forbidden.toLowerCase())) issues.push({ kind: "forbidden-change", anchor: forbidden, severity: "fail" });
  }
  return issues;
}

export const WORKFLOW_STAGE_IDS = ["analyze", "script", "judge", "keyframes", "motion", "voice", "compose", "qc", "release"] as const;
export type WorkflowStageId = typeof WORKFLOW_STAGE_IDS[number];
export interface WorkflowStagePlan {
  id: WorkflowStageId;
  enabled: boolean;
  execution: "server" | "client" | "local";
  billing: "free" | "paid" | "conditional";
  dependsOn: WorkflowStageId[];
  reason?: string;
}

export function buildWorkflowPlan(input: {
  hasSourceMedia: boolean;
  aiKeyframes: boolean;
  aiMotion: boolean;
  nativeAudio: boolean;
  qualityGate?: boolean;
}): WorkflowStagePlan[] {
  const qc = input.qualityGate !== false;
  return [
    { id: "analyze", enabled: input.hasSourceMedia, execution: "server", billing: "conditional", dependsOn: [] },
    { id: "script", enabled: true, execution: "server", billing: "conditional", dependsOn: input.hasSourceMedia ? ["analyze"] : [] },
    { id: "judge", enabled: true, execution: "server", billing: "conditional", dependsOn: ["script"] },
    { id: "keyframes", enabled: true, execution: input.aiKeyframes ? "client" : "server", billing: input.aiKeyframes ? "paid" : "free", dependsOn: ["judge"] },
    { id: "motion", enabled: input.aiMotion, execution: "client", billing: "paid", dependsOn: ["keyframes"], ...(!input.aiMotion && { reason: "still-output" }) },
    { id: "voice", enabled: !input.nativeAudio, execution: "server", billing: "free", dependsOn: input.aiMotion ? ["motion"] : ["keyframes"], ...(input.nativeAudio && { reason: "native-audio" }) },
    { id: "compose", enabled: true, execution: "server", billing: "free", dependsOn: input.nativeAudio ? ["motion"] : ["voice"] },
    { id: "qc", enabled: qc, execution: "local", billing: "free", dependsOn: ["compose"] },
    { id: "release", enabled: qc, execution: "server", billing: "free", dependsOn: ["qc"] },
  ];
}

export function sanitizeWorkflowPlan(value: unknown): WorkflowStagePlan[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.flatMap((item): WorkflowStagePlan[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (!WORKFLOW_STAGE_IDS.includes(raw.id as WorkflowStageId)) return [];
    const execution = raw.execution === "client" || raw.execution === "local" ? raw.execution : "server";
    const billing = raw.billing === "paid" || raw.billing === "conditional" ? raw.billing : "free";
    return [{
      id: raw.id as WorkflowStageId,
      enabled: raw.enabled !== false,
      execution,
      billing,
      dependsOn: cleanList(raw.dependsOn).filter((id): id is WorkflowStageId => WORKFLOW_STAGE_IDS.includes(id as WorkflowStageId)),
      ...(clean(raw.reason, 120) && { reason: clean(raw.reason, 120) }),
    }];
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return WORKFLOW_STAGE_IDS.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
}

export interface CostEstimate {
  knownUsd: number;
  rangeUsd: { min: number; max: number };
  unknownCalls: number;
  estimatedSeconds: { min: number; max: number };
  items: Array<{ stage: WorkflowStageId; calls: number; unitUsd?: number; subtotalUsd?: number }>;
}

export function estimateProduction(input: {
  shotCount: number;
  workflow: WorkflowStagePlan[];
  imageUnitUsd?: number;
  videoUnitUsd?: number;
  analysisUnitUsd?: number;
}): CostEstimate {
  const shots = Math.max(1, Math.min(100, Math.round(input.shotCount || 1)));
  const on = (id: WorkflowStageId) => input.workflow.some((stage) => stage.id === id && stage.enabled);
  const items: CostEstimate["items"] = [];
  if (on("analyze")) items.push({ stage: "analyze", calls: 1, unitUsd: input.analysisUnitUsd });
  if (on("keyframes") && input.workflow.find((s) => s.id === "keyframes")?.billing === "paid") items.push({ stage: "keyframes", calls: shots, unitUsd: input.imageUnitUsd });
  if (on("motion")) items.push({ stage: "motion", calls: shots, unitUsd: input.videoUnitUsd });
  for (const item of items) if (item.unitUsd != null) item.subtotalUsd = item.calls * Math.max(0, item.unitUsd);
  const knownUsd = items.reduce((sum, item) => sum + (item.subtotalUsd ?? 0), 0);
  const unknownCalls = items.reduce((sum, item) => sum + (item.unitUsd == null ? item.calls : 0), 0);
  // Unknown paid calls are represented as a broad range, never as fake precision.
  const unknownMin = unknownCalls * 0.01;
  const unknownMax = unknownCalls * 1;
  const seconds = (on("analyze") ? 15 : 0) + (on("keyframes") ? shots * 20 : 0) + (on("motion") ? shots * 90 : 0) + 45;
  return {
    knownUsd: Math.round(knownUsd * 10000) / 10000,
    rangeUsd: { min: Math.round((knownUsd + unknownMin) * 100) / 100, max: Math.round((knownUsd + unknownMax) * 100) / 100 },
    unknownCalls,
    estimatedSeconds: { min: Math.max(20, Math.round(seconds * 0.65)), max: Math.round(seconds * 1.8) },
    items,
  };
}

export type RoutingGoal = "balanced" | "cost" | "speed" | "quality" | "consistency";
export interface RouteCandidate {
  id: string;
  name: string;
  modes: GenerationMode[];
  supportsAudio?: boolean;
  supportsLastFrame?: boolean | null;
  pricePerCall?: number;
  quality?: number;
  speed?: number;
  /** Project-local evidence from reviewed generations, never a fabricated global leaderboard. */
  observedQuality?: number;
  observedReviews?: number;
  rejectionRate?: number;
}

export interface ModelRouteDecision {
  selected: RouteCandidate | null;
  ranked: Array<{ candidate: RouteCandidate; score: number; reasons: string[] }>;
}

export function routeModel(candidates: RouteCandidate[], input: { mode: GenerationMode; goal: RoutingGoal; requireAudio?: boolean; requireLastFrame?: boolean }): ModelRouteDecision {
  const ranked = candidates
    .filter((candidate) => candidate.modes.includes(input.mode))
    .map((candidate) => {
      let score = 50;
      const reasons: string[] = ["mode-match"];
      if (input.requireAudio) {
        if (candidate.supportsAudio === true) { score += 18; reasons.push("native-audio"); }
        else if (candidate.supportsAudio === false) score -= 35;
      }
      if (input.requireLastFrame) {
        if (candidate.supportsLastFrame === true) { score += 22; reasons.push("last-frame"); }
        else if (candidate.supportsLastFrame === false) score -= 45;
      }
      const quality = candidate.quality ?? 2;
      const speed = candidate.speed ?? 2;
      if (input.goal === "quality") score += quality * 12;
      else if (input.goal === "speed") score += speed * 12;
      else if (input.goal === "consistency") score += (candidate.supportsLastFrame === true ? 28 : 0) + quality * 5;
      else if (input.goal === "cost") score += candidate.pricePerCall == null ? 0 : Math.max(0, 30 - candidate.pricePerCall * 30);
      else score += quality * 5 + speed * 5 + (candidate.pricePerCall == null ? 0 : Math.max(0, 10 - candidate.pricePerCall * 10));
      const evidence = Math.min(1, Math.max(0, candidate.observedReviews ?? 0) / 8);
      if (candidate.observedQuality != null && evidence > 0) {
        const strength = input.goal === "quality" || input.goal === "consistency" ? 0.35 : input.goal === "balanced" ? 0.18 : 0.08;
        score += (Math.max(0, Math.min(100, candidate.observedQuality)) - 50) * strength * evidence;
        reasons.push("project-quality-evidence");
      }
      if (candidate.rejectionRate != null && evidence > 0) {
        score -= Math.max(0, Math.min(1, candidate.rejectionRate)) * 25 * evidence;
        reasons.push("project-rejection-history");
      }
      return { candidate, score: Math.round(score * 100) / 100, reasons };
    })
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  return { selected: ranked[0]?.candidate ?? null, ranked };
}

export type RecoveryAction = "resume-task" | "adapt-params" | "switch-model" | "neutralize-prompt" | "reduce-inputs" | "repair-media" | "retry-stage" | "configure-provider";
export interface FailureDiagnosis { code: string; retryable: boolean; actions: RecoveryAction[]; message: { zh: string; en: string } }

export function diagnoseGenerationFailure(error: unknown): FailureDiagnosis {
  const msg = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (/task.?id|poll|timeout|timed out|unknown status/.test(msg)) return { code: "paid-task-detached", retryable: true, actions: ["resume-task"], message: { zh: "云端任务可能仍在运行，请继续查询原任务，避免重复扣费", en: "The cloud task may still be running; resume it instead of submitting and paying again" } };
  if (/duration|resolution|aspect|ratio|unsupported param|invalid param/.test(msg)) return { code: "parameter-conflict", retryable: true, actions: ["adapt-params", "retry-stage"], message: { zh: "参数与模型规格冲突，可自动适配后重试", en: "Parameters conflict with the model contract; adapt them and retry" } };
  if (/moderation|safety|content policy|审核|敏感/.test(msg)) return { code: "content-policy", retryable: true, actions: ["neutralize-prompt", "retry-stage"], message: { zh: "内容审核拒绝，可保留创作意图并中和高风险措辞", en: "Content policy rejected the request; neutralize risky wording while preserving intent" } };
  if (/too many|maximum|limit.*image|reference.*limit/.test(msg)) return { code: "input-limit", retryable: true, actions: ["reduce-inputs", "retry-stage"], message: { zh: "参考素材超过模型上限，请减少输入后重试", en: "Reference inputs exceed the model limit; reduce them and retry" } };
  if (/ffmpeg|ffprobe|codec|damaged|corrupt|invalid data/.test(msg)) return { code: "media-invalid", retryable: false, actions: ["repair-media"], message: { zh: "媒体文件或编码异常，需要修复或替换素材", en: "The media file or codec is invalid; repair or replace the source" } };
  if (/401|403|api.?key|unauthorized|forbidden/.test(msg)) return { code: "provider-auth", retryable: false, actions: ["configure-provider"], message: { zh: "供应商鉴权失败，请检查 Key、地址和权限", en: "Provider authentication failed; check the key, endpoint, and access" } };
  return { code: "generation-failed", retryable: true, actions: ["retry-stage", "switch-model"], message: { zh: "当前阶段生成失败，可单独重试或切换备用模型", en: "This stage failed; retry it alone or switch to a fallback model" } };
}

export interface SemanticAsset {
  id: string;
  shotId: number;
  mediaType: "image" | "video";
  origin: string;
  tags: string[];
  prompt?: string;
  model?: string;
  commercialStatus: "safe" | "review" | "owned";
}

export function semanticAssetFromRecord(record: { id: string; shotId: number; type: string; filePath?: string | null; prompt?: string | null; model?: string | null; license?: string | null }): SemanticAsset {
  const words = (record.prompt ?? "").toLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,8}/g) ?? [];
  const license = (record.license ?? "").toLowerCase();
  return {
    id: record.id,
    shotId: record.shotId,
    mediaType: /\.(mp4|mov|webm)$/i.test(record.filePath ?? "") ? "video" : "image",
    origin: record.type,
    tags: [...new Set(words)].slice(0, 12),
    ...(record.prompt && { prompt: record.prompt }),
    ...(record.model && { model: record.model }),
    commercialStatus: record.type === "user_upload" || record.type === "product_image" ? "owned" : license && !/unknown|nc|nd/.test(license) ? "safe" : "review",
  };
}

export interface VersionTree {
  scripts: Array<{ id: string; version: number; selected: boolean; createdAt?: Date | null }>;
  generations: Array<{ id: string; kind: "asset" | "task" | "composition"; shotId?: number | null; label: string; status: string; createdAt?: Date | null }>;
}

export function buildVersionTree(input: {
  scripts: Array<{ id: string; version: number; selected?: boolean | null; createdAt?: Date | null }>;
  assets: Array<{ id: string; shotId: number; model?: string | null; type: string; status: string; createdAt?: Date | null }>;
  tasks: Array<{ id: string; shotId?: number | null; model: string; status: string; createdAt?: Date | null }>;
  compositions: Array<{ id: string; label?: string | null; status: string; createdAt?: Date | null }>;
}): VersionTree {
  return {
    scripts: [...input.scripts].sort((a, b) => b.version - a.version).map((s) => ({ ...s, selected: Boolean(s.selected) })),
    generations: [
      ...input.assets.map((a) => ({ id: a.id, kind: "asset" as const, shotId: a.shotId, label: a.model || a.type, status: a.status, createdAt: a.createdAt })),
      ...input.tasks.map((t) => ({ id: t.id, kind: "task" as const, shotId: t.shotId, label: t.model, status: t.status, createdAt: t.createdAt })),
      ...input.compositions.map((c) => ({ id: c.id, kind: "composition" as const, label: c.label || "composition", status: c.status, createdAt: c.createdAt })),
    ].sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0)),
  };
}

export interface RepairAction { checkId: string; stage: WorkflowStageId; action: "recompose" | "remix-audio" | "regenerate-shot" | "replace-media"; automatic: boolean; message: { zh: string; en: string } }

export function repairPlanFromQc(report: QcReport): RepairAction[] {
  return report.checks.filter((check) => check.level !== "ok").map((check) => {
    if (["audio-stream", "silence", "loudness", "true-peak"].includes(check.id)) return { checkId: check.id, stage: "compose", action: "remix-audio", automatic: true, message: { zh: "重新混音并标准化响度", en: "Remix audio and normalize loudness" } } as RepairAction;
    if (["black", "freeze"].includes(check.id)) return { checkId: check.id, stage: "motion", action: "regenerate-shot", automatic: false, message: { zh: "定位异常时间段并重做对应动态镜头", en: "Locate the affected segment and regenerate its motion shot" } } as RepairAction;
    if (check.id === "resolution" || check.id === "duration") return { checkId: check.id, stage: "compose", action: "recompose", automatic: true, message: { zh: "按目标规格重新合成", en: "Recompose using the target output contract" } } as RepairAction;
    return { checkId: check.id, stage: "keyframes", action: "replace-media", automatic: false, message: { zh: "替换异常素材后从当前阶段继续", en: "Replace the faulty asset and resume from this stage" } } as RepairAction;
  });
}

export interface PreviewPlan { resolution: "720p"; videoPreset: "veryfast"; crf: 26; paidStagesSkipped: WorkflowStageId[] }
export function buildPreviewPlan(input: { duration: number; hasGeneratedMotion: boolean }): PreviewPlan {
  return {
    resolution: "720p",
    videoPreset: "veryfast",
    crf: 26,
    paidStagesSkipped: input.hasGeneratedMotion ? [] : ["motion"],
  };
}
