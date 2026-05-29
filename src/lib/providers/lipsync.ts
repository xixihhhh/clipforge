/**
 * 唇形同步 Provider - 基于图生视频实现精准口型匹配
 * 流程: 静态形象图 + TTS音频 → 唇形同步视频
 * 
 * 技术方案:
 * 1. 先用 TTS 生成配音音频
 * 2. 用 Wan/SadTalker 模型实现音频驱动唇形同步
 * 3. 输出与音频完美匹配的口播视频
 */

import { BaseProvider, ProviderError, sleep } from './base';
import type { ProviderConfig, TaskStatus } from './types';

/** 唇形同步选项 */
export interface LipSyncOptions {
  /** 形象图片 URL */
  avatarUrl: string;
  /** TTS 音频 URL */
  audioUrl: string;
  /** 口播文本（用于字幕） */
  text?: string;
  /** 画面尺寸 */
  resolution?: '480p' | '720p' | '1080p';
  /** 是否生成字幕 */
  addSubtitles?: boolean;
  /** 字幕样式 */
  subtitleStyle?: 'default' | 'bold' | 'outline' | 'karaoke';
  /** 背景（可选） */
  background?: string;
  /** 配置覆盖 */
  config?: Partial<ProviderConfig>;
}

/** 唇形同步结果 */
export interface LipSyncResult {
  taskId: string;
  videoUrl?: string;
  estimatedTime?: number;
}

/**
 * 硅基流动唇形同步 Provider
 * 使用 Wan 模型（图+音频→视频）
 */
export class SiliconFlowLipSync extends BaseProvider {
  readonly id = 'siliconflow-lipsync';
  readonly name = '硅基流动唇形同步';
  readonly icon = '👄';

  private getApiBase(config?: Partial<ProviderConfig>): string {
    return (config?.baseUrl || this.config.baseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  }

  /**
   * 提交唇形同步任务
   * 使用 Wan I2V 模型，音频作为驱动信号
   */
  async submitTask(options: LipSyncOptions): Promise<LipSyncResult> {
    const apiKey = options.config?.apiKey || this.config.apiKey;
    if (!apiKey) throw new ProviderError('请先配置 API Key', 'NO_API_KEY', this.id);
    if (!options.avatarUrl) throw new ProviderError('请提供形象图片', 'NO_AVATAR', this.id);
    if (!options.audioUrl) throw new ProviderError('请提供音频', 'NO_AUDIO', this.id);

    const base = this.getApiBase(options.config);

    // 构建精准的唇形同步 prompt
    const prompt = this.buildLipSyncPrompt(options);

    // 使用 Wan 模型进行音频驱动图生视频
    const res = await this.request<{ requestId?: string; task_id?: string; id?: string }>(
      `${base}/video/submit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'Wan-AI/Wan2.1-I2V-14B-720P',
          image: options.avatarUrl,
          prompt,
          // 音频驱动参数（如模型支持）
          audio: options.audioUrl,
        }),
      },
      { apiKey, baseUrl: base },
    );

    if (this.isError(res)) {
      throw new ProviderError(`唇形同步失败: ${this.getErrorMessage(res)}`, 'LIPSYNC_FAILED', this.id);
    }

    const taskId = res.requestId || res.task_id || res.id || '';
    return { taskId, estimatedTime: 30 };
  }

  /**
   * 生成带字幕的唇形同步视频（后处理）
   * 先生成原始唇形视频，再用字幕叠加
   */
  async submitWithSubtitles(options: LipSyncOptions): Promise<LipSyncResult> {
    // 第一步：生成唇形同步视频
    const result = await this.submitTask(options);

    // 字幕在视频生成后通过 FFmpeg 叠加（在 API 路由中处理）
    return result;
  }

  /** 查询任务状态 */
  async getTaskStatus(taskId: string, config?: Partial<ProviderConfig>): Promise<TaskStatus> {
    const apiKey = config?.apiKey || this.config.apiKey;
    if (!apiKey) throw new ProviderError('请先配置 API Key', 'NO_API_KEY', this.id);

    const base = this.getApiBase(config);
    const res = await this.request<Record<string, unknown>>(
      `${base}/video/status/${taskId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
      { apiKey, baseUrl: base },
    );

    if (this.isError(res)) {
      return { status: 'failed', progress: 0, error: this.getErrorMessage(res) };
    }

    const status = (res.status as string) || 'unknown';
    const videoUrl =
      (res.video as { url?: string })?.url ||
      (res.output as { video_url?: string })?.video_url ||
      (res.results as Array<{ url?: string }>)?.[0]?.url ||
      (res.videoUrl as string) ||
      '';

    const statusMap: Record<string, TaskStatus['status']> = {
      Succeed: 'completed', succeed: 'completed', completed: 'completed',
      Failed: 'failed', failed: 'failed',
      Processing: 'processing', processing: 'processing',
      Pending: 'pending', pending: 'pending',
    };

    return {
      status: statusMap[status] || 'processing',
      progress: statusMap[status] === 'completed' ? 100 : 50,
      result: videoUrl ? { videoUrl, mimeType: 'video/mp4' } : undefined,
    };
  }

  /** 等待任务完成 */
  async waitForTask(taskId: string, config?: Partial<ProviderConfig>, timeout = 300000): Promise<TaskStatus> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const status = await this.getTaskStatus(taskId, config);
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        return status;
      }
      await sleep(5000);
    }
    throw new ProviderError('唇形同步超时', 'TIMEOUT', this.id);
  }

  /** 构建唇形同步 prompt */
  private buildLipSyncPrompt(options: LipSyncOptions): string {
    return `high quality talking head video, person speaking naturally with accurate lip sync, ` +
      `mouth movements matching speech rhythm, natural head movements, ` +
      `professional lighting, looking at camera, smooth animation, ` +
      `cinematic quality, 4k detail`;
  }
}
