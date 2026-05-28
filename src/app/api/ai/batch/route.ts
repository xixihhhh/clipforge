/**
 * 批量数字人视频生成 API
 * POST /api/ai/batch
 *
 * 接收脚本列表 × 形象列表 × 音色列表，循环调用数字人 API 生成多个版本。
 * 支持并发控制（最多 3 个同时生成）。
 *
 * 请求体:
 * {
 *   scripts: [{ text: string; label?: string }]         // 脚本文案列表
 *   avatars: [{ avatarUrl: string; label?: string }]     // 形象列表
 *   voices:  [{ voice: string; label?: string }]         // 音色列表
 *   config?: { apiKey: string; apiEndpoint?: string }    // Provider 配置
 *   options?: {
 *     duration?: number          // 视频时长（秒），默认 5
 *     motionStyle?: string       // 动作风格，默认 'talking'
 *     ttsSpeed?: number          // TTS 语速，默认 1.0
 *     maxConcurrency?: number    // 最大并发数，默认 3，上限 5
 *     skipTTS?: boolean          // 跳过 TTS，直接用 text 文本（数字人内部静音）
 *   }
 * }
 *
 * 响应:
 * {
 *   success: true
 *   batchId: string             // 批次 ID
 *   totalTasks: number          // 总任务数
 *   tasks: [{
 *     id: string                // 任务编号 (batch-index)
 *     script: { text; label }
 *     avatar: { avatarUrl; label }
 *     voice: { voice; label }
 *     ttsTaskId?: string        // TTS 任务 ID
 *     videoTaskId?: string      // 数字人视频任务 ID
 *     status: 'submitted' | 'failed'
 *     error?: string
 *   }]
 *   concurrency: number         // 实际使用的并发数
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { SiliconFlowDigitalHuman } from '@/lib/providers/digital-human';
import type { ProviderConfig } from '@/lib/providers/types';

// ==================== 类型定义 ====================

interface ScriptItem {
  text: string;
  label?: string;
}

interface AvatarItem {
  avatarUrl: string;
  label?: string;
}

interface VoiceItem {
  voice: string;
  label?: string;
}

interface BatchOptions {
  duration?: number;
  motionStyle?: 'talking' | 'gesturing' | 'presenting' | string;
  tssSpeed?: number;
  maxConcurrency?: number;
  skipTTS?: boolean;
}

interface BatchRequestBody {
  scripts: ScriptItem[];
  avatars: AvatarItem[];
  voices: VoiceItem[];
  config?: Partial<ProviderConfig>;
  options?: BatchOptions;
}

interface TaskRecord {
  index: number;
  script: ScriptItem;
  avatar: AvatarItem;
  voice: VoiceItem;
  ttsTaskId?: string;
  videoTaskId?: string;
  status: 'pending' | 'submitted' | 'failed';
  error?: string;
}

// ==================== 并发控制器 ====================

/**
 * 带并发限制的任务执行器
 * 将任务列表分批执行，每批最多 maxConcurrency 个任务同时进行
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  // 创建 worker 池
  const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (err) {
        // 错误已在 task 内部处理，此处兜底
        results[currentIndex] = err as T;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

// ==================== API 路由 ====================

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BatchRequestBody;
    const { scripts, avatars, voices, config: overrideConfig, options } = body;

    // ---------- 参数校验 ----------
    if (!scripts || !Array.isArray(scripts) || scripts.length === 0) {
      return NextResponse.json({ error: '请提供至少一个脚本 (scripts)' }, { status: 400 });
    }
    if (!avatars || !Array.isArray(avatars) || avatars.length === 0) {
      return NextResponse.json({ error: '请提供至少一个形象 (avatars)' }, { status: 400 });
    }
    if (!voices || !Array.isArray(voices) || voices.length === 0) {
      return NextResponse.json({ error: '请提供至少一个音色 (voices)' }, { status: 400 });
    }

    // 校验每个脚本的文本
    for (let i = 0; i < scripts.length; i++) {
      if (!scripts[i].text?.trim()) {
        return NextResponse.json(
          { error: `scripts[${i}].text 不能为空` },
          { status: 400 },
        );
      }
    }
    // 校验每个形象
    for (let i = 0; i < avatars.length; i++) {
      if (!avatars[i].avatarUrl?.trim()) {
        return NextResponse.json(
          { error: `avatars[${i}].avatarUrl 不能为空` },
          { status: 400 },
        );
      }
    }

    const providerConfig: Partial<ProviderConfig> = {
      apiKey: overrideConfig?.apiKey || '',
      apiEndpoint: overrideConfig?.apiEndpoint || 'https://api.siliconflow.cn/v1',
    };

    if (!providerConfig.apiKey) {
      return NextResponse.json({ error: '请提供 API Key' }, { status: 400 });
    }

    const maxConcurrency = Math.min(Math.max(options?.maxConcurrency ?? 3, 1), 5);
    const duration = options?.duration || 5;
    const motionStyle = options?.motionStyle || 'talking';
    const skipTTS = options?.skipTTS ?? false;
    const ttsSpeed = options?.tssSpeed ?? 1.0;

    const dh = new SiliconFlowDigitalHuman(providerConfig);
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ---------- 生成笛卡尔积任务列表 ----------
    const allTasks: {
      script: ScriptItem;
      avatar: AvatarItem;
      voice: VoiceItem;
    }[] = [];

    for (const script of scripts) {
      for (const avatar of avatars) {
        for (const voice of voices) {
          allTasks.push({ script, avatar, voice });
        }
      }
    }

    console.log(
      `[批量生成] batchId=${batchId} 总任务数=${allTasks.length} ` +
      `脚本=${scripts.length} 形象=${avatars.length} 音色=${voices.length} 并发=${maxConcurrency}`,
    );

    // ---------- 构建并发任务 ----------
    const taskRecords: TaskRecord[] = allTasks.map((t, i) => ({
      index: i,
      ...t,
      status: 'pending' as const,
    }));

    const taskRunners = allTasks.map((taskItem, index) => {
      return async (): Promise<void> => {
        const record = taskRecords[index];
        try {
          let audioUrl: string | undefined;

          // Step 1: TTS 合成语音
          if (!skipTTS) {
            try {
              const ttsResult = await dh.generateTTS({
                text: taskItem.script.text,
                voice: taskItem.voice.voice,
                speed: ttsSpeed,
                format: 'mp3',
                config: providerConfig,
              });
              audioUrl = ttsResult.audioUrl;
              record.ttsTaskId = `tts_${batchId}_${index}`;
            } catch (ttsErr) {
              const msg = ttsErr instanceof Error ? ttsErr.message : 'TTS 合成失败';
              console.warn(`[批量生成] 任务#${index} TTS 失败，将使用静音模式: ${msg}`);
              // TTS 失败不阻断，降级为静音模式
            }
          }

          // Step 2: 提交数字人视频生成
          const result = await dh.generateVideo({
            avatarUrl: taskItem.avatar.avatarUrl,
            text: taskItem.script.text,
            audioUrl,
            duration,
            motionStyle,
            config: providerConfig,
          });

          record.videoTaskId = result.taskId;
          record.status = 'submitted';
          console.log(
            `[批量生成] 任务#${index} 已提交: videoTaskId=${result.taskId}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : '任务提交失败';
          record.status = 'failed';
          record.error = msg;
          console.error(`[批量生成] 任务#${index} 失败: ${msg}`);
        }
      };
    });

    // ---------- 执行并发任务 ----------
    const startTime = Date.now();
    await runWithConcurrency(taskRunners, maxConcurrency);
    const elapsed = Date.now() - startTime;

    // ---------- 统计结果 ----------
    const submitted = taskRecords.filter((r) => r.status === 'submitted');
    const failed = taskRecords.filter((r) => r.status === 'failed');

    console.log(
      `[批量生成] batchId=${batchId} 完成: 成功=${submitted.length} 失败=${failed.length} 耗时=${elapsed}ms`,
    );

    return NextResponse.json({
      success: true,
      batchId,
      totalTasks: allTasks.length,
      submitted: submitted.length,
      failed: failed.length,
      elapsed,
      concurrency: maxConcurrency,
      tasks: taskRecords.map((r) => ({
        id: `${batchId}-${r.index}`,
        index: r.index,
        script: { text: r.script.text, label: r.script.label || `脚本${scripts.indexOf(r.script) + 1}` },
        avatar: { avatarUrl: r.avatar.avatarUrl, label: r.avatar.label || `形象${avatars.indexOf(r.avatar) + 1}` },
        voice: { voice: r.voice.voice, label: r.voice.label || `音色${voices.indexOf(r.voice) + 1}` },
        ttsTaskId: r.ttsTaskId,
        videoTaskId: r.videoTaskId,
        status: r.status,
        error: r.error,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '批量生成失败';
    console.error('[批量生成] 顶层错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ==================== GET: 查询批量任务状态 ====================

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // 查询某个视频任务的状态
    if (action === 'status') {
      const taskId = url.searchParams.get('taskId');
      const apiKey = url.searchParams.get('apiKey') || '';

      if (!taskId) {
        return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
      }

      const dh = new SiliconFlowDigitalHuman({ apiKey });
      const status = await dh.getTaskStatus(taskId);
      return NextResponse.json(status);
    }

    // 批量查询多个任务状态
    if (action === 'batch-status') {
      const taskIdsParam = url.searchParams.get('taskIds');
      const apiKey = url.searchParams.get('apiKey') || '';

      if (!taskIdsParam) {
        return NextResponse.json({ error: '缺少 taskIds（逗号分隔）' }, { status: 400 });
      }

      const taskIds = taskIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (taskIds.length === 0) {
        return NextResponse.json({ error: 'taskIds 为空' }, { status: 400 });
      }
      if (taskIds.length > 50) {
        return NextResponse.json({ error: '单次最多查询 50 个任务状态' }, { status: 400 });
      }

      const dh = new SiliconFlowDigitalHuman({ apiKey });

      // 并发查询所有任务状态（最多 5 个并发）
      const statusRunners = taskIds.map((taskId) => {
        return async () => {
          try {
            const status = await dh.getTaskStatus(taskId);
            return { taskId, ...status };
          } catch (err) {
            return {
              taskId,
              status: 'failed' as const,
              error: err instanceof Error ? err.message : '查询失败',
            };
          }
        };
      });

      const statuses = await runWithConcurrency(statusRunners, 5);

      // 统计
      const completed = statuses.filter((s) => s.status === 'completed').length;
      const processing = statuses.filter((s) => s.status === 'processing' || s.status === 'pending').length;
      const failed = statuses.filter((s) => s.status === 'failed').length;

      return NextResponse.json({
        total: taskIds.length,
        completed,
        processing,
        failed,
        tasks: statuses,
      });
    }

    return NextResponse.json(
      { error: '未知 action，支持 status / batch-status' },
      { status: 400 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : '查询失败';
    console.error('[批量生成-查询] 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
