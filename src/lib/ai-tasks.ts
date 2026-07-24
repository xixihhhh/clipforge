/**
 * Persistence helpers for billable AI generation tasks (ai_tasks table).
 *
 * Purpose (issue #16): the provider task ID must hit disk the moment the cloud
 * acknowledges a paid task — before any polling — so a poll timeout, crash, or
 * restart can never lose a task the user has already been billed for.
 *
 * All writes are best-effort: a DB hiccup must never break the generation flow
 * itself (the API response still carries the task ID as a fallback).
 */

import { getDb } from "@/lib/db";
import { aiTasks } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export type AiTaskStatus = "submitted" | "processing" | "completed" | "failed" | "unknown";

/** Statuses that still need attention — shown in the recovery UI, resumable after restart */
export const ACTIVE_AI_TASK_STATUSES: AiTaskStatus[] = ["submitted", "processing", "unknown"];

export interface RecordAiTaskInput {
  projectId?: string;
  shotId?: number;
  provider: string;
  model: string;
  mediaType?: "image" | "video";
  mode?: string;
  prompt?: string;
  taskId: string;
}

/** Insert a row right after task submission; returns the row id (null if the DB write failed) */
export async function recordAiTask(input: RecordAiTaskInput): Promise<string | null> {
  try {
    const db = getDb();
    const [row] = await db
      .insert(aiTasks)
      .values({
        projectId: input.projectId ?? null,
        shotId: input.shotId ?? null,
        provider: input.provider,
        model: input.model,
        mediaType: input.mediaType ?? "video",
        mode: input.mode ?? null,
        prompt: input.prompt ?? null,
        taskId: input.taskId,
        status: "submitted",
      })
      .returning({ id: aiTasks.id });
    return row?.id ?? null;
  } catch (error) {
    console.error("ai_tasks 落库失败（任务 ID 仍会随响应返回）:", error);
    return null;
  }
}

/** Update status/result of a task row (matched by row id) */
export async function updateAiTask(
  rowId: string | null,
  patch: { status?: AiTaskStatus; resultUrls?: string[]; error?: string | null }
): Promise<void> {
  if (!rowId) return;
  try {
    const db = getDb();
    await db
      .update(aiTasks)
      .set({
        ...(patch.status && { status: patch.status }),
        ...(patch.resultUrls && { resultUrls: patch.resultUrls }),
        ...(patch.error !== undefined && { error: patch.error }),
        updatedAt: new Date(),
      })
      .where(eq(aiTasks.id, rowId));
  } catch (error) {
    console.error("ai_tasks 更新失败:", error);
  }
}

/** Update status/result by provider task ID (used by the standalone status/resume endpoint) */
export async function updateAiTaskByProviderTaskId(
  provider: string,
  taskId: string,
  patch: { status?: AiTaskStatus; resultUrls?: string[]; error?: string | null }
): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(aiTasks)
      .set({
        ...(patch.status && { status: patch.status }),
        ...(patch.resultUrls && { resultUrls: patch.resultUrls }),
        ...(patch.error !== undefined && { error: patch.error }),
        updatedAt: new Date(),
      })
      .where(and(eq(aiTasks.provider, provider), eq(aiTasks.taskId, taskId)));
  } catch (error) {
    console.error("ai_tasks 更新失败:", error);
  }
}

/** List a project's tasks, optionally only the ones still needing attention */
export async function listAiTasks(projectId: string, activeOnly: boolean) {
  const db = getDb();
  const where = activeOnly
    ? and(eq(aiTasks.projectId, projectId), inArray(aiTasks.status, ACTIVE_AI_TASK_STATUSES))
    : eq(aiTasks.projectId, projectId);
  return db.select().from(aiTasks).where(where);
}
