/**
 * Agnes AI (Sapiens AI) Provider 实现
 * 基于 OpenAI 兼容 API，支持图片和视频生成
 * 文档: https://agnes-ai.com/docs
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

// ==================== Agnes API 响应类型 ====================

interface AgnesImageResponse {
  created: number
  data: Array<{ url: string; b64_json?: string }>
}

interface AgnesVideoSubmitResponse {
  task_id: string
  status: string
}

interface AgnesVideoStatusResponse {
  task_id: string
  status: string
  data?: {
    status?: string
    progress?: number
    data?: {
      remixed_from_video_id?: string
      url?: string
      error?: string
    }
    error?: string
  }
}

// ==================== Provider 实现 ====================

export class AgnesProvider extends BaseProvider {
  readonly name = 'agnes'
  readonly displayName = 'Agnes AI (Sapiens AI)'

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://apihub.agnes-ai.com/v1',
    })
  }

  /**
   * 图生图 / 文生图
   * 支持 Image-to-Image: 通过 extra_body.image 传入参考图
   */
  async generateImage(options: ImageOptions): Promise<ImageResult> {
    const body: Record<string, unknown> = {
      model: options.modelId || 'agnes-image-2.1-flash',
      prompt: options.prompt,
      size: options.width && options.height ? `${options.width}x${options.height}` : '1024x1024',
    }

    // 图生图：传入参考图 URL
    if (options.imageUrl) {
      body.extra_body = {
        image: [options.imageUrl],
        response_format: 'url',
      }
    }

    const res = await this.request<AgnesImageResponse>('/images/generations', {
      method: 'POST',
      body,
    })

    return {
      url: res.data?.[0]?.url || '',
      b64Json: res.data?.[0]?.b64_json || undefined,
    }
  }

  /**
   * 文生视频 / 图生视频
   * Agnes Video V2.0 异步任务：提交 → 轮询 → 获取结果
   */
  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    // 1. 提交视频生成任务
    const submitBody: Record<string, unknown> = {
      model: options.modelId || 'agnes-video-v2.0',
      prompt: options.prompt || '视频',
      n: 1,
    }

    if (options.imageUrl) {
      submitBody.image = options.imageUrl
    }

    const submitRes = await this.request<AgnesVideoSubmitResponse>('/video/generations', {
      method: 'POST',
      body: submitBody,
      timeout: 60000,
    })

    const taskId = submitRes.task_id
    if (!taskId) {
      throw new ProviderError('未获取到视频任务 ID', 'NO_TASK_ID', this.name)
    }

    // 2. 轮询任务状态（最长等 10 分钟）
    const taskStatus = await this.pollTaskStatus(taskId, {
      interval: 5000,
      maxAttempts: 120,
      isTerminal: (s) => ['completed', 'failed', 'cancelled', 'SUCCESS', 'FAILED'].includes(s),
    })

    // 3. 从状态中提取视频 URL
    const data = taskStatus.rawData as AgnesVideoStatusResponse | undefined
    const videoUrl =
      data?.data?.data?.remixed_from_video_id ||
      data?.data?.data?.url ||
      ''

    return {
      url: videoUrl,
      taskId,
      duration: 0,
    }
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const res = await this.request<AgnesVideoStatusResponse>(`/video/generations/${taskId}`)

    const rawStatus = res.data?.status || res.status || 'unknown'
    let mappedStatus: TaskStatusEnum

    switch (rawStatus) {
      case 'completed':
      case 'SUCCESS':
        mappedStatus = 'completed'
        break
      case 'failed':
      case 'FAILED':
        mappedStatus = 'failed'
        break
      case 'queued':
      case 'NOT_START':
      case 'IN_PROGRESS':
        mappedStatus = 'processing'
        break
      default:
        mappedStatus = 'pending'
    }

    return {
      taskId,
      status: mappedStatus,
      progress: res.data?.progress || 0,
      error: res.data?.data?.error || undefined,
      rawData: res,
    }
  }

  /**
   * 列出可用模型
   */
  async listModels(mediaType?: MediaType): Promise<Model[]> {
    const res = await this.request<{ data: Array<{ id: string }> }>('/models')

    return (res.data || [])
      .filter((m) => {
        if (!mediaType) return true
        const id = m.id.toLowerCase()
        if (mediaType === 'image') return id.includes('image')
        if (mediaType === 'video') return id.includes('video')
        return true
      })
      .map((m) => ({
        id: m.id,
        name: m.id,
        supportedModes: m.id.includes('image')
          ? ['text-to-image', 'image-to-image']
          : m.id.includes('video')
            ? ['text-to-video', 'image-to-video']
            : ['text-to-image'],
      }))
  }
}
