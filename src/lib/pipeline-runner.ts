/**
 * Server-side executor for the free hands-off chain (judge → stock-fill → compose).
 *
 * Until now this chain was a string of browser fetches inside the script page —
 * closing the tab killed the run halfway with only the final compose surviving
 * server-side. The runner moves orchestration into the server process and keeps a
 * persistent pipeline_runs record, so the page degrades to an observer: it can
 * re-attach after a refresh, and a failed/interrupted run resumes from its
 * recorded stage.
 *
 * Stage semantics mirror the page chain exactly (quality bar unchanged):
 * - judge: best-effort quality pass, tier-gated auto-apply (invariant/default only);
 *   missing LLM config or a failed pass skips silently.
 * - stock_fill: best-effort free footage matching; failure is non-fatal.
 * - compose: the only fatal stage — free Edge TTS render, polled to completion.
 *
 * Stages are re-invoked through the existing HTTP routes (self-fetch against this
 * server's own origin) instead of duplicating their internals — identical behavior,
 * one implementation.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { compositions, pipelineRuns } from "@/lib/db/schema";
import {
  autoApplicableRewrites,
  autoApplicableDescriptionRewrites,
  type JudgeReport,
} from "@/lib/script-judge";
import { stagesFrom, type PipelineStage } from "@/lib/pipeline-stages";

export interface PipelineLlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface StartPipelineInput {
  projectId: string;
  /** script variant to lock in as selected before the chain runs */
  scriptId?: string;
  /** this server's own origin (from the incoming request) — target of stage self-fetches */
  origin: string;
  /** optional LLM config: enables the judge pass + semantic footage rerank */
  llmConfig?: PipelineLlmConfig;
  /** resume breakpoint; defaults to the full chain */
  fromStage?: PipelineStage;
}

// Survives route-module reloads in dev: one registry of run ids currently executing in THIS
// process. A DB row saying "running" whose id is absent here means the server restarted
// mid-run — the row is an orphan and gets surfaced as interrupted.
const globalRuns = globalThis as unknown as { __clipforgeActivePipelines?: Set<string> };
const activeRuns = (globalRuns.__clipforgeActivePipelines ??= new Set<string>());

export function isPipelineRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

/** Compose polling budget: 2.5s × 288 ≈ 12 min, above the server render timeout. */
const COMPOSE_POLL_INTERVAL_MS = 2500;
const COMPOSE_POLL_MAX = 288;

async function setRun(runId: string, patch: Partial<typeof pipelineRuns.$inferInsert>): Promise<void> {
  const db = getDb();
  await db.update(pipelineRuns).set({ ...patch, updatedAt: new Date() }).where(eq(pipelineRuns.id, runId));
}

/** Judge stage: run the panel and auto-apply tier-gated rewrites. Best-effort by contract. */
async function runJudgeStage(input: StartPipelineInput): Promise<void> {
  if (!input.llmConfig?.baseUrl || !input.llmConfig.model || !input.scriptId) return;
  try {
    const res = await fetch(`${input.origin}/api/project/${input.projectId}/script-judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scriptId: input.scriptId, llmConfig: input.llmConfig }),
    });
    if (!res.ok) return;
    const report = (await res.json()) as JudgeReport;
    const patchByShot = new Map<number, { shotId: number; voiceover?: string; description?: string }>();
    for (const r of autoApplicableRewrites(report)) patchByShot.set(r.shotId, { shotId: r.shotId, voiceover: r.voiceover });
    for (const r of autoApplicableDescriptionRewrites(report)) {
      patchByShot.set(r.shotId, { ...(patchByShot.get(r.shotId) ?? { shotId: r.shotId }), description: r.description });
    }
    if (patchByShot.size === 0) return;
    await fetch(`${input.origin}/api/project/${input.projectId}/scripts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scriptId: input.scriptId, shotTexts: Array.from(patchByShot.values()) }),
    });
  } catch {
    /* quality is best-effort — never a new failure mode for the chain */
  }
}

/** Stock-fill stage: free footage matching, optional semantic rerank. Non-fatal. */
async function runStockFillStage(input: StartPipelineInput): Promise<void> {
  try {
    await fetch(`${input.origin}/api/project/${input.projectId}/stock-fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scriptId: input.scriptId,
        source: "all",
        mediaType: "auto",
        ...(input.llmConfig?.baseUrl && input.llmConfig.model ? { llmConfig: input.llmConfig } : {}),
      }),
    });
  } catch {
    /* non-fatal: product images/assets may already cover the shots */
  }
}

/** Compose stage: free Edge TTS render, polled to a terminal status. The only fatal stage. */
async function runComposeStage(input: StartPipelineInput, runId: string): Promise<void> {
  const res = await fetch(`${input.origin}/api/project/${input.projectId}/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptId: input.scriptId, freeTts: { enabled: true } }),
  });
  const data = (await res.json().catch(() => ({}))) as { compositionId?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "合成启动失败 / compose failed to start");
  const compositionId = data.compositionId;
  if (compositionId) await setRun(runId, { compositionId });

  const db = getDb();
  for (let i = 0; i < COMPOSE_POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, COMPOSE_POLL_INTERVAL_MS));
    const rows = compositionId
      ? await db.select().from(compositions).where(eq(compositions.id, compositionId)).limit(1)
      : [];
    const st = rows[0]?.status;
    if (st === "done") return;
    if (st === "failed") throw new Error("视频合成失败 / video composition failed");
  }
  throw new Error("合成超时 / composition timed out");
}

/**
 * Insert a run row and execute the chain in the background. Returns the run id
 * immediately (the route responds 202; pages poll GET for progress).
 */
export async function startPipelineRun(input: StartPipelineInput): Promise<string> {
  const db = getDb();
  const stages = stagesFrom(input.fromStage);
  const [run] = await db
    .insert(pipelineRuns)
    .values({ projectId: input.projectId, scriptId: input.scriptId ?? null, stage: stages[0], status: "running" })
    .returning();
  activeRuns.add(run.id);

  void (async () => {
    try {
      // lock in the chosen variant so every stage (and compose) uses it
      if (input.scriptId) {
        await fetch(`${input.origin}/api/project/${input.projectId}/scripts`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedScriptId: input.scriptId }),
        }).catch(() => {});
      }
      for (const stage of stages) {
        await setRun(run.id, { stage });
        if (stage === "judge") await runJudgeStage(input);
        else if (stage === "stock_fill") await runStockFillStage(input);
        else await runComposeStage(input, run.id);
      }
      await setRun(run.id, { status: "done" });
    } catch (e) {
      console.error(`[pipeline] 运行失败 run=${run.id}:`, e);
      await setRun(run.id, { status: "failed", error: e instanceof Error ? e.message : String(e) }).catch(() => {});
    } finally {
      activeRuns.delete(run.id);
    }
  })();

  return run.id;
}
