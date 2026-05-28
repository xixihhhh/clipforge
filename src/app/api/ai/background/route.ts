/**
 * 背景替换 API 路由
 * POST /api/ai/background - 提交背景替换任务
 * GET  /api/ai/background - 查询任务状态
 *
 * 支持三种模式：
 *   - blur:  虚化背景（保留主体，模糊背景）
 *   - color: 纯色背景（移除原背景，替换为指定颜色）
 *   - image: 自定义背景图（移除原背景，替换为指定图片）
 */

import { NextRequest, NextResponse } from 'next/server';
import { SiliconFlowBackground } from '@/lib/providers/background';
import type { BackgroundMode, BackgroundReplaceOptions } from '@/lib/providers/background';
import type { ProviderConfig } from '@/lib/providers/types';

// ==================== 类型 ====================

interface PostBody {
  /** 源图片 URL（必填） */
  imageUrl: string;
  /** 背景替换模式（必填）：blur | color | image */
  mode: BackgroundMode;
  /** mode=color 时的背景颜色（CSS 颜色值） */
  backgroundColor?: string;
  /** mode=blur 时的虚化程度 1-100，默认 75 */
  blurStrength?: number;
  /** mode=image 时的自定义背景图片 URL */
  backgroundImageUrl?: string;
  /** 是否保留原始图片尺寸 */
  keepOriginalSize?: boolean;
  /** 是否等待任务完成（轮询），默认 true */
  waitForResult?: boolean;
  /** 轮询超时（毫秒），默认 120000 */
  timeout?: number;
  /** API 配置覆盖 */
  config?: Partial<ProviderConfig>;
}

// ==================== 参数校验 ====================

const VALID_MODES: BackgroundMode[] = ['blur', 'color', 'image'];

function validateBody(body: Record<string, unknown>): string | null {
  if (!body.imageUrl || typeof body.imageUrl !== 'string') {
    return '请提供图片 URL（imageUrl）';
  }

  if (!body.mode || !VALID_MODES.includes(body.mode as BackgroundMode)) {
    return `模式（mode）必须为以下之一：${VALID_MODES.join(', ')}`;
  }

  if (body.mode === 'image' && (!body.backgroundImageUrl || typeof body.backgroundImageUrl !== 'string')) {
    return '使用图片模式（image）时请提供背景图 URL（backgroundImageUrl）';
  }

  if (
    body.mode === 'color' &&
    body.backgroundColor &&
    typeof body.backgroundColor !== 'string'
  ) {
    return '背景颜色（backgroundColor）必须为字符串';
  }

  if (
    body.mode === 'blur' &&
    body.blurStrength !== undefined &&
    (typeof body.blurStrength !== 'number' ||
      body.blurStrength < 1 ||
      body.blurStrength > 100)
  ) {
    return '虚化程度（blurStrength）必须为 1-100 之间的数字';
  }

  return null;
}

// ==================== 获取 Provider 配置 ====================

function getProviderConfig(body: Record<string, unknown>): ProviderConfig {
  const cfg = (body.config as Partial<ProviderConfig>) || {};
  return {
    name: 'siliconflow',
    apiKey: cfg.apiKey || '',
    baseUrl: cfg.baseUrl || 'https://api.siliconflow.cn/v1',
    apiEndpoint: cfg.apiEndpoint || cfg.baseUrl || 'https://api.siliconflow.cn/v1',
  };
}

// ==================== POST 提交背景替换 ====================

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PostBody;

    // 参数校验
    const validationError = validateBody(body as unknown as Record<string, unknown>);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const providerConfig = getProviderConfig(body as unknown as Record<string, unknown>);
    if (!providerConfig.apiKey) {
      return NextResponse.json({ error: '请先配置 API Key' }, { status: 400 });
    }

    const bg = new SiliconFlowBackground(providerConfig);

    const options: BackgroundReplaceOptions = {
      imageUrl: body.imageUrl,
      mode: body.mode,
      backgroundColor: body.backgroundColor,
      blurStrength: body.blurStrength,
      backgroundImageUrl: body.backgroundImageUrl,
      keepOriginalSize: body.keepOriginalSize ?? true,
    };

    // 执行背景替换
    const result = await bg.replaceBackground(options);

    // 如果返回了异步任务 ID 且需要等待结果
    if (result.taskId && result.imageUrls.length === 0) {
      const shouldWait = body.waitForResult !== false;

      if (shouldWait) {
        // 轮询等待任务完成
        const finalResult = await bg.waitForTask(
          result.taskId,
          providerConfig,
          body.timeout ?? 120_000,
        );
        return NextResponse.json({
          success: true,
          imageUrls: finalResult.imageUrls,
          taskId: result.taskId,
          model: finalResult.model,
          duration: finalResult.duration,
        });
      }

      // 不等待，直接返回任务 ID
      return NextResponse.json({
        success: true,
        imageUrls: [],
        taskId: result.taskId,
        model: result.model,
        message: '任务已提交，请通过 GET 接口查询状态',
      });
    }

    // 同步返回结果
    return NextResponse.json({
      success: true,
      imageUrls: result.imageUrls,
      model: result.model,
      duration: result.duration,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '背景替换失败';
    console.error('[背景替换API] 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ==================== GET 查询任务状态 ====================

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const taskId = url.searchParams.get('taskId');
    const apiKey = url.searchParams.get('apiKey') || '';

    if (!taskId) {
      return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
    }

    const bg = new SiliconFlowBackground({ apiKey } as ProviderConfig);
    const status = await bg.getTaskStatus(taskId);

    return NextResponse.json(status);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '查询失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
