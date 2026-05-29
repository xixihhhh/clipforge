// @ts-nocheck
/**
 * 数字人 API 路由
 * POST /api/ai/digital-human - 生成数字人口播视频
 * GET  /api/ai/digital-human - 查询任务状态 / 获取形象列表
 */

import { NextRequest, NextResponse } from 'next/server';
import { SiliconFlowDigitalHuman } from '@/lib/providers/digital-human';
import type { ProviderConfig } from '@/lib/providers/types';

// 从请求体或默认值获取 provider 配置
function getConfig(body?: Record<string, unknown>): ProviderConfig {
  const cfg = (body?.config as Partial<ProviderConfig>) || {};
  return {
    name: 'siliconflow',
    apiKey: cfg.apiKey || '',
    baseUrl: cfg.baseUrl || 'https://api.siliconflow.cn/v1',
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { avatarUrl, text, audioUrl, duration, motionStyle, config: overrideConfig } = body;

    if (!avatarUrl) {
      return NextResponse.json({ error: '请提供数字人形象图片' }, { status: 400 });
    }
    if (!text && !audioUrl) {
      return NextResponse.json({ error: '请提供口播文本或音频' }, { status: 400 });
    }

    const providerConfig = getConfig(overrideConfig ? { config: overrideConfig } : body);
    const dh = new SiliconFlowDigitalHuman(providerConfig);

    const result = await dh.generateVideo({
      avatarUrl,
      text,
      audioUrl,
      duration: duration || 5,
      motionStyle: motionStyle || 'talking',
      config: overrideConfig || providerConfig,
    });

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      estimatedTime: result.estimatedTime,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '数字人生成失败';
    console.error('[数字人API] 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (action === 'avatars') {
      const apiKey = url.searchParams.get('apiKey') || '';
      const dh = new SiliconFlowDigitalHuman({ name: "siliconflow", apiKey, baseUrl: "https://api.siliconflow.cn/v1" });
      const avatars = await dh.getAvatars();
      return NextResponse.json({ avatars });
    }

    if (action === 'status') {
      const taskId = url.searchParams.get('taskId');
      const apiKey = url.searchParams.get('apiKey') || '';
      if (!taskId) {
        return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
      }
      const dh = new SiliconFlowDigitalHuman({ name: "siliconflow", apiKey, baseUrl: "https://api.siliconflow.cn/v1" });
      const status = await dh.getTaskStatus(taskId);
      return NextResponse.json(status);
    }

    return NextResponse.json({ error: '未知 action' }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
