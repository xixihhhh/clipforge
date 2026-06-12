/**
 * Atlas Cloud Provider 实现
 * 基于 Atlas Cloud REST API，支持图片和视频生成
 * 文档参考: https://www.atlascloud.ai/docs
 *
 * API 协议（已通过官方 MCP/文档实测确认，2026-06）：
 * - 提交生图:   POST /model/generateImage  -> { code, data: { id } }
 * - 提交生视频: POST /model/generateVideo  -> { code, data: { id } }
 * - 查询结果:   GET  /model/prediction/{id} -> { id, status, outputs: string[] }
 *   状态值: created | processing | completed | succeeded | failed | timeout
 */

import { BaseProvider, ProviderError } from './base'
import type {
  ProviderConfig,
  ImageOptions,
  ImageResult,
  VideoOptions,
  VideoResult,
  TaskStatus,
  TaskStatusEnum,
  Model,
  MediaType,
} from './types'

// ==================== Atlas Cloud API 响应类型 ====================

/** 创建任务响应（外层 code/data 包裹） */
interface AtlasCreateResponse {
  code?: number
  message?: string
  data?: {
    id: string
    [key: string]: unknown
  }
  // 部分接口（enable_sync_mode）会直接返回 prediction 对象
  id?: string
  [key: string]: unknown
}

/** 任务查询响应 */
interface AtlasPredictionResponse {
  code?: number
  message?: string
  data?: AtlasPrediction
  // 兼容直接返回 prediction 对象的情况
  id?: string
  status?: string
  outputs?: string[]
  [key: string]: unknown
}

/** 预测任务对象 */
interface AtlasPrediction {
  id: string
  model?: string
  status: string
  /** 生成结果 URL 列表（图片/视频） */
  outputs?: string[]
  error?: string | { message?: string; code?: string }
  created_at?: string
  has_nsfw_contents?: boolean[]
  [key: string]: unknown
}

// ==================== Provider 实现 ====================

export class AtlasCloudProvider extends BaseProvider {
  readonly name = 'atlas-cloud'
  readonly displayName = 'Atlas Cloud'

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://api.atlascloud.ai/api/v1',
    })
  }

  /**
   * 生成图片
   */
  async generateImage(options: ImageOptions): Promise<ImageResult> {
    const body = {
      model: options.modelId,
      prompt: options.prompt,
      // Atlas Cloud 使用 "宽x高" 字符串表示尺寸
      ...(options.width && options.height && {
        size: `${options.width}x${options.height}`,
      }),
      ...(options.negativePrompt && { negative_prompt: options.negativePrompt }),
      ...(options.seed !== undefined && { seed: options.seed }),
      // image-to-image / 编辑模式（如 openai/gpt-image-2/edit）使用 images 数组传参考图
      ...(options.referenceImageUrl && {
        images: [options.referenceImageUrl],
      }),
      ...options.extra,
    }

    const startTime = Date.now()
    const response = await this.request<AtlasCreateResponse>('/model/generateImage', {
      method: 'POST',
      body,
    })

    const taskId = this.extractTaskId(response)

    // 异步任务模式，轮询获取结果
    const finalStatus = await this.pollTaskStatus(taskId, { interval: 2000 })

    const outputs = this.extractOutputs(finalStatus)

    return {
      taskId,
      imageUrls: outputs,
      modelId: options.modelId,
      duration: Date.now() - startTime,
    }
  }

  /**
   * 生成视频
   */
  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    // 支持音频的模型（如 Seedance 2.0）将配音文案融入 prompt
    let prompt = options.prompt
    if (options.audioEnabled && options.voiceover) {
      prompt = `${options.prompt}. 旁白: "${options.voiceover}"`
    }

    const body = {
      model: options.modelId,
      prompt,
      // image-to-video 模式的首帧图
      ...(options.firstFrameUrl && { image: options.firstFrameUrl }),
      // 尾帧图（Seedance 2.0 / Vidu 首尾帧过渡）
      ...(options.lastFrameUrl && { last_image: options.lastFrameUrl }),
      ...(options.duration && { duration: options.duration }),
      // Atlas Cloud 视频接口使用 resolution + ratio 而非 width/height
      ...(options.width && options.height && {
        resolution: this.mapResolution(options.width, options.height),
        ratio: this.mapRatio(options.width, options.height),
      }),
      ...(options.seed !== undefined && { seed: options.seed }),
      // 音频开关（Seedance 2.0 默认生成音频，未启用时显式关闭）
      generate_audio: options.audioEnabled ?? false,
      watermark: false,
      ...options.extra,
    }

    const startTime = Date.now()
    const response = await this.request<AtlasCreateResponse>('/model/generateVideo', {
      method: 'POST',
      body,
    })

    const taskId = this.extractTaskId(response)

    // 视频生成耗时较长，拉长轮询间隔
    const finalStatus = await this.pollTaskStatus(taskId, { interval: 5000 })

    const outputs = this.extractOutputs(finalStatus)

    return {
      taskId,
      videoUrls: outputs,
      duration: options.duration,
      processingTime: Date.now() - startTime,
      modelId: options.modelId,
      hasAudio: options.audioEnabled ?? false,
    }
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const response = await this.request<AtlasPredictionResponse>(
      `/model/prediction/${taskId}`
    )

    // 兼容 { code, data: {...} } 包裹和直接返回 prediction 两种格式
    const prediction: AtlasPrediction =
      (response.data as AtlasPrediction | undefined) ??
      (response as unknown as AtlasPrediction)

    const status = this.mapStatus(prediction.status)

    const taskStatus: TaskStatus = {
      taskId: prediction.id || taskId,
      status,
      createdAt: prediction.created_at,
    }

    // 任务完成时解析结果（outputs 为 URL 数组，由调用方区分图片/视频）
    if (status === 'completed' && prediction.outputs && prediction.outputs.length > 0) {
      const urls = prediction.outputs
      // 简单按扩展名判断媒体类型，默认视频
      const isImage = urls.every((u) => /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(u))
      taskStatus.result = isImage
        ? { taskId: taskStatus.taskId, imageUrls: urls, modelId: prediction.model ?? '' }
        : { taskId: taskStatus.taskId, videoUrls: urls, modelId: prediction.model ?? '' }
    }

    // 任务失败时填充错误信息
    if (status === 'failed') {
      if (typeof prediction.error === 'string') {
        taskStatus.error = prediction.error
      } else if (prediction.error) {
        taskStatus.error = prediction.error.message
        taskStatus.errorCode = prediction.error.code
      } else {
        taskStatus.error = '生成失败'
      }
    }

    return taskStatus
  }

  /**
   * 获取可用模型列表
   * 基于 Atlas Cloud 官方模型列表确认（2026-06，通过官方 MCP 实测）
   */
  async listModels(mediaType?: MediaType): Promise<Model[]> {
    let models: Model[] = [
      // ==================== 视频生成 ====================
      // --- 豆包 Seedance 2.0（最新，原生音频） ---
      { id: 'bytedance/seedance-2.0/text-to-video', name: 'Seedance 2.0 (文生视频)', description: '字节最新视频模型，原生音频，4-15秒，最高1440p', modes: ['text-to-video'], mediaType: 'video', provider: this.name, supportsAudio: true },
      { id: 'bytedance/seedance-2.0/image-to-video', name: 'Seedance 2.0 (图生视频)', description: '首帧/尾帧图生视频，原生音频', modes: ['image-to-video'], mediaType: 'video', provider: this.name, supportsAudio: true },
      { id: 'bytedance/seedance-2.0/reference-to-video', name: 'Seedance 2.0 (参考生视频)', description: '多模态参考图/视频/音频生成，支持视频编辑', modes: ['image-to-video', 'video-to-video'], mediaType: 'video', provider: this.name, supportsAudio: true },
      { id: 'bytedance/seedance-2.0-fast/text-to-video', name: 'Seedance 2.0 Fast (文生视频)', description: 'Seedance 2.0 快速版，原生音频', modes: ['text-to-video'], mediaType: 'video', provider: this.name, supportsAudio: true },
      { id: 'bytedance/seedance-2.0-fast/image-to-video', name: 'Seedance 2.0 Fast (图生视频)', description: 'Seedance 2.0 快速版图生视频', modes: ['image-to-video'], mediaType: 'video', provider: this.name, supportsAudio: true },
      // --- 豆包 Seedance 1.5 ---
      { id: 'bytedance/seedance-v1.5-pro/text-to-video', name: 'Seedance 1.5 Pro (文生视频)', modes: ['text-to-video'], mediaType: 'video', provider: this.name, supportsAudio: true },
      { id: 'bytedance/seedance-v1.5-pro/image-to-video', name: 'Seedance 1.5 Pro (图生视频)', modes: ['image-to-video'], mediaType: 'video', provider: this.name, supportsAudio: true },
      // --- 可灵 Kling 3.0 ---
      { id: 'kwaivgi/kling-v3.0-pro/text-to-video', name: 'Kling 3.0 Pro (文生视频)', modes: ['text-to-video'], mediaType: 'video', provider: this.name },
      { id: 'kwaivgi/kling-v3.0-pro/image-to-video', name: 'Kling 3.0 Pro (图生视频)', modes: ['image-to-video'], mediaType: 'video', provider: this.name },
      { id: 'kwaivgi/kling-v3.0-std/text-to-video', name: 'Kling 3.0 Std (文生视频)', modes: ['text-to-video'], mediaType: 'video', provider: this.name },
      { id: 'kwaivgi/kling-v3.0-std/image-to-video', name: 'Kling 3.0 Std (图生视频)', modes: ['image-to-video'], mediaType: 'video', provider: this.name },
      // --- Vidu Q3 ---
      { id: 'vidu/q3-pro/text-to-video', name: 'Vidu Q3 Pro (文生视频)', modes: ['text-to-video'], mediaType: 'video', provider: this.name },
      { id: 'vidu/q3-pro/image-to-video', name: 'Vidu Q3 Pro (图生视频)', modes: ['image-to-video'], mediaType: 'video', provider: this.name },
      { id: 'vidu/q3-pro/start-end-to-video', name: 'Vidu Q3 Pro (首尾帧过渡)', description: '指定首尾帧生成过渡视频', modes: ['image-to-video'], mediaType: 'video', provider: this.name },
      { id: 'vidu/q3-turbo/image-to-video', name: 'Vidu Q3 Turbo (图生视频)', modes: ['image-to-video'], mediaType: 'video', provider: this.name },
      // --- 万相 Wan ---
      { id: 'alibaba/wan-2.6/image-to-video-flash', name: '万相 2.6 Flash (图生视频)', modes: ['image-to-video'], mediaType: 'video', provider: this.name },
      // ==================== 图片生成 ====================
      // --- OpenAI GPT Image 2（最新） ---
      { id: 'openai/gpt-image-2/text-to-image', name: 'GPT Image 2 (文生图)', description: 'OpenAI 最新生图模型，支持任意分辨率，商品图质感好', modes: ['text-to-image'], mediaType: 'image', provider: this.name },
      { id: 'openai/gpt-image-2/edit', name: 'GPT Image 2 (图片编辑)', description: '自然语言精准编辑：换背景、调光线、改文字', modes: ['image-to-image'], mediaType: 'image', provider: this.name },
      // --- 其他生图模型 ---
      { id: 'bytedance/seedream-v5.0-lite', name: 'Seedream 5.0 Lite (文生图)', modes: ['text-to-image'], mediaType: 'image', provider: this.name },
      { id: 'google/nano-banana-2/text-to-image', name: 'Nano Banana 2 (文生图)', modes: ['text-to-image'], mediaType: 'image', provider: this.name },
    ]

    if (mediaType) {
      models = models.filter((m) => m.mediaType === mediaType)
    }
    return models
  }

  // ==================== 私有方法 ====================

  /** 从创建任务响应中提取任务 ID（兼容包裹/非包裹两种格式） */
  private extractTaskId(response: AtlasCreateResponse): string {
    const taskId = response.data?.id ?? response.id
    if (!taskId) {
      throw new ProviderError(
        `Atlas Cloud 未返回任务 ID: ${JSON.stringify(response).slice(0, 200)}`,
        'NO_TASK_ID',
        this.name
      )
    }
    return taskId
  }

  /** 从最终任务状态中提取输出 URL 列表 */
  private extractOutputs(finalStatus: TaskStatus): string[] {
    const result = finalStatus.result
    if (!result) {
      throw new ProviderError('任务完成但未返回结果', 'NO_RESULT', this.name)
    }
    const urls = 'imageUrls' in result ? result.imageUrls : result.videoUrls
    if (!urls || urls.length === 0) {
      throw new ProviderError('任务完成但输出为空', 'EMPTY_OUTPUT', this.name)
    }
    return urls
  }

  /** 映射 Atlas Cloud 任务状态到统一状态 */
  private mapStatus(atlasStatus: string): TaskStatusEnum {
    const statusMap: Record<string, TaskStatusEnum> = {
      created: 'pending',
      starting: 'pending',
      queued: 'pending',
      processing: 'processing',
      running: 'processing',
      succeeded: 'completed',
      completed: 'completed',
      failed: 'failed',
      timeout: 'failed',
      canceled: 'cancelled',
      cancelled: 'cancelled',
    }
    return statusMap[atlasStatus] ?? 'pending'
  }

  /** 根据宽高映射到 Atlas Cloud 的 resolution 档位 */
  private mapResolution(width: number, height: number): string {
    const minSide = Math.min(width, height)
    if (minSide >= 1080) return '1080p'
    if (minSide >= 720) return '720p'
    return '480p'
  }

  /** 根据宽高映射到最接近的 ratio 档位 */
  private mapRatio(width: number, height: number): string {
    const candidates: Array<[string, number]> = [
      ['16:9', 16 / 9],
      ['4:3', 4 / 3],
      ['1:1', 1],
      ['3:4', 3 / 4],
      ['9:16', 9 / 16],
      ['21:9', 21 / 9],
    ]
    const target = width / height
    let best = candidates[0]
    for (const c of candidates) {
      if (Math.abs(c[1] - target) < Math.abs(best[1] - target)) best = c
    }
    return best[0]
  }
}
