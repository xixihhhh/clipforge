/**
 * 背景替换 Provider - 基于硅基流动图像编辑 API
 * 支持三种模式：
 *   - blur: 虚化背景（保留主体，模糊背景）
 *   - color: 纯色背景（移除原背景，替换为指定颜色）
 *   - image: 自定义背景图（移除原背景，替换为指定图片）
 */

import { BaseProvider, ProviderError } from './base';
import type { ProviderConfig } from './types';

// ==================== 类型定义 ====================

/** 背景替换模式 */
export type BackgroundMode = 'blur' | 'color' | 'image';

/** 背景替换选项 */
export interface BackgroundReplaceOptions {
  /** 源图片 URL */
  imageUrl: string;
  /** 背景替换模式 */
  mode: BackgroundMode;
  /** mode=color 时的背景颜色，支持 CSS 颜色值（如 #ffffff、rgb(255,255,255)） */
  backgroundColor?: string;
  /** mode=blur 时的虚化程度，1-100，默认 75 */
  blurStrength?: number;
  /** mode=image 时的自定义背景图片 URL */
  backgroundImageUrl?: string;
  /** 是否保留原始图片尺寸，默认 true */
  keepOriginalSize?: boolean;
  /** 配置覆盖 */
  config?: Partial<ProviderConfig>;
}

/** 背景替换结果 */
export interface BackgroundReplaceResult {
  /** 处理后的图片 URL 列表 */
  imageUrls: string[];
  /** 任务 ID（如有） */
  taskId?: string;
  /** 使用的模型 */
  model: string;
  /** 处理耗时（毫秒） */
  duration?: number;
}

// ==================== Provider 实现 ====================

/**
 * 硅基流动背景替换 Provider
 *
 * 工作流程：
 * 1. 根据模式构建合适的请求参数
 * 2. 调用硅基流动图像编辑 API（支持同步返回和异步任务两种模式）
 * 3. 同步模式直接返回图片 URL；异步模式需轮询获取结果
 */
export class SiliconFlowBackground extends BaseProvider {
  readonly id = 'siliconflow-background';
  readonly name = '硅基流动背景替换';
  readonly displayName = '背景替换';
  readonly icon = '🖼️';

  /** 默认使用的模型 */
  private static readonly DEFAULT_MODEL = 'BAAI/bria-2.3';

  private getApiBase(config?: Partial<ProviderConfig>): string {
    return (
      config?.baseUrl ||
      this.config.baseUrl ||
      'https://api.siliconflow.cn/v1'
    ).replace(/\/+$/, '');
  }

  /**
   * 执行背景替换
   */
  async replaceBackground(
    options: BackgroundReplaceOptions,
  ): Promise<BackgroundReplaceResult> {
    const apiKey = options.config?.apiKey || this.config.apiKey;
    if (!apiKey) {
      throw new ProviderError('请先配置 API Key', 'NO_API_KEY', this.id);
    }
    if (!options.imageUrl) {
      throw new ProviderError('请提供图片 URL', 'NO_IMAGE', this.id);
    }

    // 校验 mode=image 时必须提供背景图
    if (options.mode === 'image' && !options.backgroundImageUrl) {
      throw new ProviderError(
        '使用图片模式时请提供背景图 URL',
        'NO_BACKGROUND_IMAGE',
        this.id,
      );
    }

    const base = this.getApiBase(options.config);
    const startTime = Date.now();

    // 根据模式构建 prompt 和额外参数
    const { prompt, extraBody } = this.buildRequestParams(options);

    try {
      const res = await this.rawRequest<{
        images?: Array<{ url?: string }>;
        output?: { image_url?: string; task_id?: string };
        task_id?: string;
        requestId?: string;
        results?: Array<{ url?: string }>;
      }>(`${base}/images/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: SiliconFlowBackground.DEFAULT_MODEL,
          image: options.imageUrl,
          prompt,
          ...extraBody,
        }),
        timeout: 120_000,
      });

      const duration = Date.now() - startTime;

      // 提取结果图片 URL
      const imageUrls = this.extractImageUrls(res);

      if (imageUrls.length === 0) {
        // 可能返回的是异步任务 ID
        const taskId =
          res.task_id || res.requestId || res.output?.task_id || '';
        if (taskId) {
          return {
            imageUrls: [],
            taskId,
            model: SiliconFlowBackground.DEFAULT_MODEL,
            duration,
          };
        }
        throw new ProviderError(
          '背景替换未返回结果图片',
          'NO_RESULT',
          this.id,
        );
      }

      return {
        imageUrls,
        model: SiliconFlowBackground.DEFAULT_MODEL,
        duration,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        `背景替换失败: ${error instanceof Error ? error.message : String(error)}`,
        'BACKGROUND_REPLACE_FAILED',
        this.id,
      );
    }
  }

  /**
   * 查询任务状态（异步模式）
   */
  async getTaskStatus(
    taskId: string,
    config?: Partial<ProviderConfig>,
  ): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    imageUrls?: string[];
    error?: string;
  }> {
    const apiKey = config?.apiKey || this.config.apiKey;
    if (!apiKey) {
      throw new ProviderError('请先配置 API Key', 'NO_API_KEY', this.id);
    }

    const base = this.getApiBase(config);

    const res = await this.rawRequest<Record<string, unknown>>(
      `${base}/images/status/${taskId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    if (this.isErrorResponse(res)) {
      return {
        status: 'failed',
        error: this.extractErrorMessage(res),
      };
    }

    const status = (res.status as string) || 'unknown';
    const statusMap: Record<
      string,
      'pending' | 'processing' | 'completed' | 'failed'
    > = {
      Succeed: 'completed',
      succeed: 'completed',
      completed: 'completed',
      Failed: 'failed',
      failed: 'failed',
      Processing: 'processing',
      processing: 'processing',
      Pending: 'pending',
      pending: 'pending',
    };

    const mappedStatus = statusMap[status] || 'processing';
    const imageUrls =
      mappedStatus === 'completed' ? this.extractImageUrls(res) : undefined;

    return {
      status: mappedStatus,
      imageUrls,
    };
  }

  /**
   * 等待任务完成并返回结果
   */
  async waitForTask(
    taskId: string,
    config?: Partial<ProviderConfig>,
    timeout = 120_000,
  ): Promise<BackgroundReplaceResult> {
    const startTime = Date.now();
    const interval = 3_000;

    while (Date.now() - startTime < timeout) {
      const status = await this.getTaskStatus(taskId, config);

      if (status.status === 'completed') {
        return {
          imageUrls: status.imageUrls || [],
          taskId,
          model: SiliconFlowBackground.DEFAULT_MODEL,
          duration: Date.now() - startTime,
        };
      }

      if (status.status === 'failed') {
        throw new ProviderError(
          `背景替换任务失败: ${status.error || '未知错误'}`,
          'TASK_FAILED',
          this.id,
        );
      }

      await this.sleep(interval);
    }

    throw new ProviderError('背景替换任务超时', 'TIMEOUT', this.id);
  }

  // ==================== 内部方法 ====================

  /**
   * 根据模式构建请求参数
   */
  private buildRequestParams(options: BackgroundReplaceOptions): {
    prompt: string;
    extraBody: Record<string, unknown>;
  } {
    const extraBody: Record<string, unknown> = {};

    switch (options.mode) {
      case 'blur': {
        const strength = Math.min(
          100,
          Math.max(1, options.blurStrength ?? 75),
        );
        return {
          prompt: `blur the background, keep the subject in focus, bokeh effect, background blur strength ${strength}%`,
          extraBody: {
            strength: strength / 100,
            extra: { background_mode: 'blur', blur_strength: strength },
          },
        };
      }

      case 'color': {
        const color = options.backgroundColor || '#ffffff';
        return {
          prompt: `remove the background, replace with solid ${color} background, clean edges around the subject, professional studio photography`,
          extraBody: {
            extra: { background_mode: 'color', background_color: color },
          },
        };
      }

      case 'image': {
        return {
          prompt: 'replace the background, keep the subject unchanged, seamlessly blend with the new background',
          extraBody: {
            extra: {
              background_mode: 'image',
              background_image: options.backgroundImageUrl,
            },
          },
        };
      }

      default:
        throw new ProviderError(
          `不支持的背景模式: ${options.mode}`,
          'INVALID_MODE',
          this.id,
        );
    }
  }

  /**
   * 从 API 响应中提取图片 URL 列表
   */
  private extractImageUrls(res: Record<string, unknown>): string[] {
    const urls: string[] = [];

    // images[].url
    const images = res.images as Array<{ url?: string }> | undefined;
    if (images?.length) {
      for (const img of images) {
        if (img.url) urls.push(img.url);
      }
    }

    // output.image_url
    const output = res.output as
      | { image_url?: string; images?: string[] }
      | undefined;
    if (output?.image_url) urls.push(output.image_url);
    if (output?.images?.length) urls.push(...output.images);

    // results[].url
    const results = res.results as Array<{ url?: string }> | undefined;
    if (results?.length) {
      for (const r of results) {
        if (r.url) urls.push(r.url);
      }
    }

    return urls;
  }

  /**
   * 判断响应是否为错误
   */
  private isErrorResponse(res: Record<string, unknown>): boolean {
    return !!(res.error || res.code);
  }

  /**
   * 从响应中提取错误信息
   */
  private extractErrorMessage(res: Record<string, unknown>): string {
    if (typeof res.error === 'string') return res.error;
    if (typeof res.message === 'string') return res.message;
    return '未知错误';
  }

  /**
   * 发送原始 HTTP 请求（不走 BaseProvider 的 config.baseUrl 拼接）
   */
  private async rawRequest<T = unknown>(
    url: string,
    options: {
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    } = {},
  ): Promise<T> {
    const { method = 'GET', headers = {}, body, timeout = 60_000 } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ProviderError(
          `API 请求失败: ${response.status} ${response.statusText} - ${errorBody}`,
          'API_ERROR',
          this.id,
          response.status,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ProviderError(
          `请求超时（${timeout}ms）`,
          'TIMEOUT',
          this.id,
        );
      }
      throw new ProviderError(
        `网络请求异常: ${error instanceof Error ? error.message : String(error)}`,
        'NETWORK_ERROR',
        this.id,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
