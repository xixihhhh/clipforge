import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/base";
import { apiError, errText } from "@/lib/api-error";
import { findAiTaskByProviderTaskId, updateAiTask, updateAiTaskByProviderTaskId, type AiTaskStatus } from "@/lib/ai-tasks";
import type { TaskStatusEnum } from "@/lib/providers/types";
import { isSaasMode } from "@/lib/saas/runtime";
import { requireProjectAccess } from "@/lib/saas/authorization";

// Query / resume a previously submitted video task by its provider task ID (issue #16).
// POST because the request carries the API key — keys must never appear in URLs.
// body: { provider, apiKey, baseUrl?, taskId, wait? }
//   wait=false (default): single status check
//   wait=true: block until the task reaches a terminal state (resume flow)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider: providerName, apiKey, baseUrl, taskId, wait } = body;

  if (!providerName || !taskId) {
    return apiError(req, "缺少必要参数（provider / taskId）", "Missing required parameters (provider / taskId)");
  }
  if (!apiKey) {
    return apiError(req, "缺少 API Key，请先在设置中配置对应平台", "Missing API Key, please configure the corresponding platform in settings first");
  }

  const persistedTask = await findAiTaskByProviderTaskId(providerName, taskId);
  if (isSaasMode()) {
    if (!persistedTask?.projectId) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }
    const projectAccess = await requireProjectAccess(persistedTask.projectId);
    if (!projectAccess.ok) return projectAccess.response;
  }

  const updatePersistedTask = async (patch: {
    status?: AiTaskStatus;
    resultUrls?: string[];
    error?: string | null;
  }) => {
    if (isSaasMode()) return updateAiTask(persistedTask?.id ?? null, patch);
    return updateAiTaskByProviderTaskId(providerName, taskId, patch);
  };

  // map the provider's task status to the persisted ai_tasks status
  const toRowStatus = (s: TaskStatusEnum): AiTaskStatus =>
    s === "completed" ? "completed" : s === "failed" || s === "cancelled" ? "failed" : "processing";

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });

    try {
      const status = wait && provider.waitForTask
        ? await provider.waitForTask(taskId, { interval: 5000 })
        : await provider.getTaskStatus(taskId);

      const result = status.result;
      const videoUrls = result && "videoUrls" in result ? result.videoUrls : undefined;

      await updatePersistedTask({
        status: toRowStatus(status.status),
        ...(videoUrls && { resultUrls: videoUrls }),
        error: status.error ?? null,
      });

      return NextResponse.json({
        taskId,
        status: status.status,
        videoUrls,
        error: status.error,
      });
    } catch (error) {
      // definitive failure vs. lost contact — a paid task must never be downgraded to
      // "failed" just because we couldn't reach the status endpoint
      const failed = error instanceof ProviderError && error.code === "TASK_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      await updatePersistedTask({
        status: failed ? "failed" : "unknown",
        error: message,
      });
      return NextResponse.json(
        { error: message, taskId, recoverable: !failed },
        { status: failed ? 500 : 504 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "查询任务失败", "Task query failed") },
      { status: 500 }
    );
  }
}
