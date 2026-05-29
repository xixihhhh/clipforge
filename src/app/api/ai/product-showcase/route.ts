// @ts-nocheck
/**
 * 产品展示模式 API 路由
 * POST /api/ai/product-showcase - 生成数字人旁边展示产品图的视频
 * 
 * 支持三种展示布局:
 *   - beside: 左右分屏（数字人在左，产品在右）
 *   - overlay: 产品浮层（产品叠加在数字人上方）
 *   - split: 画中画（产品在角落小窗）
 */

import { NextRequest, NextResponse } from 'next/server';
import { SiliconFlowDigitalHuman } from '@/lib/providers/digital-human';
import type { ProviderConfig } from '@/lib/providers/types';

// 展示方式枚举
type ShowcaseMode = 'beside' | 'overlay' | 'split';

// 请求体接口
interface ProductShowcaseRequest {
  // 产品图片 URL（必填）
  productImageUrl: string;
  
  // 数字人脚本/口播文本（必填）
  script: string;
  
  // 展示方式（必填）
  showcaseMode: ShowcaseMode;
  
  // 可选：数字人形象图片 URL（如果不提供则使用默认）
  avatarUrl?: string;
  
  // 可选：产品名称（用于画中画标题）
  productName?: string;
  
  // 可选：视频时长（秒）
  duration?: number;
  
  // 可选：产品位置配置
  productPosition?: {
    // 画中画模式下产品窗口的位置
    x?: number;  // 0-100 百分比
    y?: number;  // 0-100 百分比
    width?: number;  // 0-100 百分比
    height?: number;  // 0-100 百分比
  };
  
  // 可选：背景配置
  background?: {
    color?: string;  // 背景颜色
    imageUrl?: string;  // 背景图片 URL
  };
  
  // 可选：provider 配置
  config?: Partial<ProviderConfig>;
}

// 从请求体或默认值获取 provider 配置
function getConfig(body: ProductShowcaseRequest): ProviderConfig {
  const cfg = body.config || {};
  return {
    apiKey: cfg.apiKey || '',
    baseUrl: cfg.baseUrl || 'https://api.siliconflow.cn/v1',
  };
}

// 验证展示方式
function isValidShowcaseMode(mode: string): mode is ShowcaseMode {
  return ['beside', 'overlay', 'split'].includes(mode);
}

// 构建视频生成参数
function buildVideoParams(body: ProductShowcaseRequest) {
  const {
    productImageUrl,
    script,
    showcaseMode,
    avatarUrl,
    productName,
    duration = 10,
    productPosition,
    background,
  } = body;

  // 根据展示模式构建布局参数
  const layoutParams = {
    mode: showcaseMode,
    productImage: productImageUrl,
    productTitle: productName || '',
    position: productPosition || getDefaultPosition(showcaseMode),
  };

  return {
    avatarUrl: avatarUrl || '',
    text: script,
    duration,
    motionStyle: 'talking',
    layout: layoutParams,
    background: background || {},
  };
}

// 获取默认的产品位置配置
function getDefaultPosition(mode: ShowcaseMode) {
  switch (mode) {
    case 'beside':
      return {
        x: 50,
        y: 0,
        width: 50,
        height: 100,
      };
    case 'overlay':
      return {
        x: 60,
        y: 10,
        width: 35,
        height: 40,
      };
    case 'split':
      return {
        x: 65,
        y: 55,
        width: 30,
        height: 35,
      };
    default:
      return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: ProductShowcaseRequest = await req.json();
    const {
      productImageUrl,
      script,
      showcaseMode,
      avatarUrl,
      config: overrideConfig,
    } = body;

    // 参数验证
    if (!productImageUrl) {
      return NextResponse.json(
        { error: '请提供产品图片 URL (productImageUrl)' },
        { status: 400 }
      );
    }

    if (!script) {
      return NextResponse.json(
        { error: '请提供口播脚本 (script)' },
        { status: 400 }
      );
    }

    if (!showcaseMode) {
      return NextResponse.json(
        { error: '请提供展示方式 (showcaseMode): beside/overlay/split' },
        { status: 400 }
      );
    }

    if (!isValidShowcaseMode(showcaseMode)) {
      return NextResponse.json(
        { error: '无效的展示方式，可选: beside/overlay/split' },
        { status: 400 }
      );
    }

    // 获取配置
    const providerConfig = getConfig(body);
    if (overrideConfig) {
      providerConfig.apiKey = overrideConfig.apiKey || providerConfig.apiKey;
      providerConfig.baseUrl = overrideConfig.baseUrl || providerConfig.baseUrl;
    }

    // 构建视频参数
    const videoParams = buildVideoParams(body);

    // 初始化数字人 provider
    const dh = new SiliconFlowDigitalHuman(providerConfig);

    // 调用数字人生成视频
    // 注意：这里假设 SiliconFlowDigitalHuman 支持产品展示模式
    // 实际实现可能需要扩展数字人 provider 或调用专门的合成服务
    const result = await dh.generateVideo({
      ...videoParams,
      config: overrideConfig || providerConfig,
    });

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      estimatedTime: result.estimatedTime,
      showcaseMode,
      message: `已提交 ${showcaseMode} 模式的产品展示视频生成任务`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '产品展示视频生成失败';
    console.error('[产品展示API] 错误:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // 查询任务状态
    if (action === 'status') {
      const taskId = url.searchParams.get('taskId');
      const apiKey = url.searchParams.get('apiKey') || '';
      
      if (!taskId) {
        return NextResponse.json(
          { error: '缺少 taskId 参数' },
          { status: 400 }
        );
      }

      const dh = new SiliconFlowDigitalHuman({ name: "siliconflow", apiKey, baseUrl: "https://api.siliconflow.cn/v1" });
      const status = await dh.getTaskStatus(taskId);
      return NextResponse.json(status);
    }

    // 获取支持的展示模式列表
    if (action === 'modes') {
      return NextResponse.json({
        modes: [
          {
            id: 'beside',
            name: '左右分屏',
            description: '数字人在左侧，产品图在右侧',
            defaultPosition: getDefaultPosition('beside'),
          },
          {
            id: 'overlay',
            name: '产品浮层',
            description: '产品图叠加在数字人上方',
            defaultPosition: getDefaultPosition('overlay'),
          },
          {
            id: 'split',
            name: '画中画',
            description: '产品图在角落小窗显示',
            defaultPosition: getDefaultPosition('split'),
          },
        ],
      });
    }

    return NextResponse.json(
      { error: '未知 action，可选: status/modes' },
      { status: 400 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}