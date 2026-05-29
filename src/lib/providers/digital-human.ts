/**
 * 数字人 Provider - 通用图生视频数字人驱动
 * 支持硅基流动 Wan、可灵等图生视频模型实现数字人口播效果
 */

import {
  BaseProvider,
  ProviderError,
  sleep,
} from './base';
import type {
  ProviderConfig,
  TaskStatus,
} from './types';

/** 数字人选项 */
export interface DigitalHumanOptions {
  /** 数字人形象图片 URL */
  avatarUrl: string;
  /** 口播文本 */
  text: string;
  /** TTS 音频 URL（可选，不传则静音） */
  audioUrl?: string;
  /** 视频时长（秒） */
  duration?: number;
  /** 画面尺寸 */
  resolution?: '480p' | '720p' | '1080p';
  /** 动作风格 */
  motionStyle?: 'talking' | 'gesturing' | 'presenting';
  /** 配置覆盖 */
  config?: Partial<ProviderConfig>;
}

/** 数字人结果 */
export interface DigitalHumanResult {
  /** 任务 ID */
  taskId: string;
  /** 视频 URL（同步模式直接返回） */
  videoUrl?: string;
  /** 音频 URL */
  audioUrl?: string;
  /** 预计耗时（秒） */
  estimatedTime?: number;
}

/** TTS 选项 */
export interface TTSOptions {
  text: string;
  voice?: string;
  speed?: number;
  format?: 'mp3' | 'wav';
  config?: Partial<ProviderConfig>;
}

/** TTS 结果 */
export interface TTSResult {
  audioUrl: string;
  duration?: number;
}

/**
 * 数字人 Provider 接口
 */
export interface DigitalHumanProvider {
  /** 平台 ID */
  readonly id: string;
  /** 平台名称 */
  readonly name: string;
  /** 平台图标 */
  readonly icon: string;

  /** 获取可用数字人形象列表 */
  getAvatars(config?: Partial<ProviderConfig>): Promise<DigitalHumanAvatar[]>;
  /** 生成数字人口播视频 */
  generateVideo(options: DigitalHumanOptions): Promise<DigitalHumanResult>;
  /** 文字转语音 */
  generateTTS(options: TTSOptions): Promise<TTSResult>;
  /** 查询任务状态 */
  getTaskStatus(taskId: string, config?: Partial<ProviderConfig>): Promise<TaskStatus>;
  /** 等待任务完成 */
  waitForTask(taskId: string, config?: Partial<ProviderConfig>, timeout?: number): Promise<TaskStatus>;
}

/** 数字人形象 */
export interface DigitalHumanAvatar {
  id: string;
  name: string;
  thumbnailUrl: string;
  gender: 'male' | 'female';
  style: string;
  description?: string;
}

/**
 * 硅基流动数字人 Provider
 * 使用 Wan 模型实现图生视频数字人效果
 */
export class SiliconFlowDigitalHuman extends BaseProvider implements DigitalHumanProvider {
  readonly id = 'siliconflow-dh';
  readonly name = '硅基流动数字人';
  readonly icon = '🤖';

  private getApiBase(config?: Partial<ProviderConfig>): string {
    return (config?.baseUrl || this.config.baseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  }

  /** 获取可用数字人形象（内置预设） */
  async getAvatars(_config?: Partial<ProviderConfig>): Promise<DigitalHumanAvatar[]> {
    return [
      { id: 'preset-female-1', name: '职场女性', thumbnailUrl: '', gender: 'female', style: 'professional', description: '适合商务/职场类带货' },
      { id: 'preset-male-1', name: '阳光男生', thumbnailUrl: '', gender: 'male', style: 'casual', description: '适合数码/运动类带货' },
      { id: 'preset-female-2', name: '甜美主播', thumbnailUrl: '', gender: 'female', style: 'cute', description: '适合美妆/食品类带货' },
      { id: 'preset-male-2', name: '成熟男士', thumbnailUrl: '', gender: 'male', style: 'mature', description: '适合家居/金融类带货' },
    ];
  }

  /** 生成数字人口播视频（异步任务） */
  async generateVideo(options: DigitalHumanOptions): Promise<DigitalHumanResult> {
    const apiKey = options.config?.apiKey || this.config.apiKey;
    if (!apiKey) throw new ProviderError('请先配置硅基流动 API Key', 'NO_API_KEY', this.id);
    if (!options.avatarUrl) throw new ProviderError('请提供数字人形象图片', 'NO_AVATAR', this.id);

    const base = this.getApiBase(options.config);
    const duration = options.duration || 5;
    const prompt = this.buildPrompt(options);

    // 提交图生视频任务
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
        }),
      },
      { apiKey, baseUrl: base },
    );

    if (this.isError(res)) {
      throw new ProviderError(
        `数字人视频生成失败: ${this.getErrorMessage(res)}`,
        'GENERATION_FAILED',
        this.id,
      );
    }

    const taskId = res.requestId || res.task_id || res.id || '';
    if (!taskId) {
      throw new ProviderError('任务提交失败，未返回 taskId', 'NO_TASK_ID', this.id);
    }

    return {
      taskId,
      estimatedTime: duration * 10,
    };
  }

  /** 文字转语音（使用 OpenAI 兼容 TTS 接口） */
  async generateTTS(options: TTSOptions): Promise<TTSResult> {
    const apiKey = options.config?.apiKey || this.config.apiKey;
    if (!apiKey) throw new ProviderError('请先配置 API Key', 'NO_API_KEY', this.id);
    if (!options.text) throw new ProviderError('请提供口播文本', 'NO_TEXT', this.id);

    const base = this.getApiBase(options.config);
    const voice = options.voice || 'female-tianmei';

    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        input: options.text,
        voice,
        response_format: options.format || 'mp3',
        speed: options.speed || 1.0,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '未知错误');
      throw new ProviderError(`TTS 生成失败 (${res.status}): ${errText.slice(0, 200)}`, 'TTS_FAILED', this.id, res.status);
    }

    // 返回 base64 data URI（避免 blob URL 内存泄漏）
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const audioUrl = `data:audio/mp3;base64,${base64}`;

    return { audioUrl, duration: Math.ceil(options.text.length * 0.15) };
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

    return {
      status: statusMap[status] || 'processing',
      progress: statusMap[status] === 'completed' ? 100 : 50,
      result: videoUrl ? { videoUrl, mimeType: 'video/mp4' } : undefined,
    };
  }

  /** 等待任务完成 */
  async waitForTask(
    taskId: string,
    config?: Partial<ProviderConfig>,
    timeout = 300000,
  ): Promise<TaskStatus> {
    const startTime = Date.now();
    const pollInterval = 5000;

    while (Date.now() - startTime < timeout) {
      const status = await this.getTaskStatus(taskId, config);

      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        return status;
      }

      await sleep(pollInterval);
    }

    throw new ProviderError('数字人视频生成超时', 'TIMEOUT', this.id);
  }

  /** 构建数字人 prompt */
  private buildPrompt(options: DigitalHumanOptions): string {
    const styleMap: Record<string, string> = {
      talking: 'person talking, lip sync, natural gestures, looking at camera',
      gesturing: 'person gesturing while speaking, expressive hand movements, looking at camera',
      presenting: 'person presenting product, confident posture, professional look, looking at camera',
    };
    const motion = options.motionStyle || 'talking';
    return `high quality, ${styleMap[motion]}, smooth animation, cinematic lighting, professional video`;
  }
}
