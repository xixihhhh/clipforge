/**
 * fal.ai Provider 实现
 * 基于 fal.ai REST API，支持多种图片和视频生成模型
 * 文档参考: https://fal.ai/docs
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

// ==================== fal.ai API 响应类型 ====================

interface FalSubmitResponse {
  request_id: string
  [key: string]: unknown
}

interface FalStatusResponse {
  request_id: string
  status: string
  progress?: number
  response_url?: string
  [key: string]: unknown
}

interface FalResultResponse {
  images?: Array<{ url: string; width?: number; height?: number }>
  video?: { url: string; content_type?: string }
  videos?: Array<{ url: string }>
  seed?: number
  timings?: { inference?: number }
  [key: string]: unknown
}

// ==================== Provider 实现 ====================

export class FalAIProvider extends BaseProvider {
  readonly name = 'fal-ai'
  readonly displayName = 'fal.ai'

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://queue.fal.run',
    })
  }

  /**
   * 获取认证头 - fal.ai 使用 Key 认证
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Key ${this.config.apiKey}`,
    }
  }

  /**
   * 生成图片
   */
  async generateImage(options: ImageOptions): Promise<ImageResult> {
    const w = options.width ?? 0
    const h = options.height ?? 0
    // GPT Image 系列不吃 negative_prompt / guidance / steps
    const isGptImage = options.modelId.includes('gpt-image')
    // gpt-image-1.5：image_size 只接受字符串枚举（1024x1024 / 1536x1024 / 1024x1536）
    const isGptImage15 = options.modelId.includes('gpt-image-1.5')
    // gpt-image-2：image_size 接受 {width,height}（需 16 的倍数）或预设名
    const isGptImage2 = options.modelId.includes('gpt-image-2')
    // 编辑/图生图端点：gpt-image-1.5/edit、seedream/edit 用 image_urls；gpt-image-2/image-to-image 同样支持 image_urls
    const isEdit = options.modelId.includes('/edit') || options.modelId.includes('/image-to-image')

    const round16 = (n: number) => Math.max(16, Math.round(n / 16) * 16)
    const imageSize = (() => {
      if (isGptImage15) {
        if (w > h) return '1536x1024'
        if (h > w) return '1024x1536'
        return '1024x1024'
      }
      if (!w || !h) return undefined
      // gpt-image-2 要求宽高为 16 的倍数
      return isGptImage2
        ? { width: round16(w), height: round16(h) }
        : { width: w, height: h }
    })()

    const body = {
      prompt: options.prompt,
      negative_prompt: isGptImage ? undefined : options.negativePrompt,
      image_size: imageSize,
      num_images: options.count ?? 1,
      guidance_scale: isGptImage ? undefined : options.guidanceScale,
      num_inference_steps: isGptImage ? undefined : options.steps,
      seed: options.seed,
      // 编辑/图生图：多图端点用 image_urls 数组；普通图生图用 image_url
      ...(options.referenceImageUrl && isEdit && {
        image_urls: [options.referenceImageUrl],
      }),
      ...(options.referenceImageUrl && !isEdit && {
        image_url: options.referenceImageUrl,
      }),
      ...options.extra,
    }

    // 提交异步任务
    const submitResponse = await this.request<FalSubmitResponse>(
      `/${options.modelId}`,
      { method: 'POST', body }
    )

    // getTaskStatus 需要 "modelId::requestId" 格式来定位查询端点，这里拼接好再轮询
    const taskId = `${options.modelId}::${submitResponse.request_id}`
    const finalStatus = await this.pollTaskStatus(taskId, {
      interval: 2000,
    })

    if (!finalStatus.result) {
      throw new ProviderError('任务完成但未返回结果', 'NO_RESULT', this.name)
    }

    return finalStatus.result as ImageResult
  }

  /**
   * 生成视频
   */
  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    // 如果启用音频且有配音文案，将配音信息融入 prompt
    let prompt = options.prompt
    if (options.audioEnabled && options.voiceover) {
      // 支持音频的模型（如 Veo 3、MiniMax）可以直接在 prompt 中描述音频
      prompt = `${options.prompt}. The narrator says: "${options.voiceover}"`
    }

    const body = {
      prompt,
      negative_prompt: options.negativePrompt,
      video_size: options.width && options.height
        ? { width: options.width, height: options.height }
        : undefined,
      duration: options.duration,
      fps: options.fps,
      motion_strength: options.motionStrength,
      guidance_scale: options.guidanceScale,
      seed: options.seed,
      // image-to-video 模式
      ...(options.firstFrameUrl && {
        image_url: options.firstFrameUrl,
      }),
      // video-to-video 模式
      ...(options.referenceVideoUrl && {
        video_url: options.referenceVideoUrl,
      }),
      // 音频相关参数（部分模型支持）
      ...(options.audioEnabled && {
        audio: true,
        ...(options.audioPrompt && { audio_prompt: options.audioPrompt }),
      }),
      ...options.extra,
    }

    // 提交异步任务
    const submitResponse = await this.request<FalSubmitResponse>(
      `/${options.modelId}`,
      { method: 'POST', body }
    )

    // getTaskStatus 需要 "modelId::requestId" 格式来定位查询端点，这里拼接好再轮询
    const taskId = `${options.modelId}::${submitResponse.request_id}`
    const finalStatus = await this.pollTaskStatus(taskId, {
      interval: 5000,
    })

    if (!finalStatus.result) {
      throw new ProviderError('任务完成但未返回结果', 'NO_RESULT', this.name)
    }

    return finalStatus.result as VideoResult
  }

  /**
   * 查询任务状态
   * fal.ai 使用 queue API 查询状态
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    // fal.ai 的 taskId 格式为 "modelId::requestId"
    const [modelId, requestId] = this.parseTaskId(taskId)

    const statusResponse = await this.request<FalStatusResponse>(
      `/${modelId}/requests/${requestId}/status`,
      {
        // 使用 fal.ai 的状态查询 baseUrl
        headers: {},
      }
    )

    const status = this.mapStatus(statusResponse.status)

    const taskStatus: TaskStatus = {
      taskId,
      status,
      progress: statusResponse.progress,
    }

    // 任务完成时获取结果
    if (status === 'completed') {
      const result = await this.request<FalResultResponse>(
        `/${modelId}/requests/${requestId}`
      )
      taskStatus.result = this.parseResult(taskId, result, modelId)
    }

    return taskStatus
  }

  /**
   * 获取可用模型列表
   * fal.ai 的模型是动态的，这里返回常用模型
   */
  async listModels(mediaType?: MediaType): Promise<Model[]> {
    // 基于 fal.ai 官方平台确认的模型列表（2026-03）
    const models: Model[] = [
      // ==================== 图片生成 ====================
      // OpenAI GPT Image 2（fal 端点为 openai/gpt-image-2，强提示词遵循、商品质感好）
      {
        id: 'openai/gpt-image-2',
        name: 'GPT Image 2',
        description: 'OpenAI 最新图像模型，强提示词遵循、构图与细节保真（带货商品主图首选）',
        modes: ['text-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'openai/gpt-image-2/image-to-image',
        name: 'GPT Image 2 Edit',
        description: 'GPT Image 2 编辑，精确局部重绘/扩图，适合商品保真',
        modes: ['image-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      // 兼容保留上一代 gpt-image-1.5
      {
        id: 'fal-ai/gpt-image-1.5',
        name: 'GPT Image 1.5',
        description: 'OpenAI 图像模型上一代，强提示词遵循',
        modes: ['text-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'fal-ai/bytedance/seedream/v5/lite/edit',
        name: 'Seedream V5 Lite Edit',
        description: '字节 Seedream 智能图像编辑，多图融合，商品换背景/锁主体',
        modes: ['image-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'fal-ai/flux/schnell',
        name: 'FLUX.1 [schnell]',
        description: '快速文生图，适合原型迭代',
        modes: ['text-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'fal-ai/flux/dev',
        name: 'FLUX.1 [dev]',
        description: '高质量文生图模型',
        modes: ['text-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'fal-ai/flux-pro/v1.1',
        name: 'FLUX.1 Pro v1.1',
        description: '专业级文生图',
        modes: ['text-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'fal-ai/flux-2-pro',
        name: 'FLUX.2 [pro]',
        description: 'FLUX 第二代专业版',
        modes: ['text-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'fal-ai/recraft/v4/pro/text-to-image',
        name: 'Recraft V4 Pro',
        description: '高质量设计风格生图',
        modes: ['text-to-image'],
        mediaType: 'image',
        provider: this.name,
      },

      // ==================== 视频生成 ====================
      // --- 可灵 Kling 系列 ---
      {
        id: 'fal-ai/kling-video/v3/pro/text-to-video',
        name: 'Kling 3.0 Pro (文生视频)',
        description: '可灵 3.0 Pro，支持原生音频、多分镜、人脸绑定',
        modes: ['text-to-video'],
        mediaType: 'video',
        provider: this.name,
        supportsAudio: true,
      },
      {
        id: 'fal-ai/kling-video/v3/pro/image-to-video',
        name: 'Kling 3.0 Pro (图生视频)',
        description: '可灵 3.0 Pro 图生视频，支持原生音频',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
        supportsAudio: true,
      },

      // --- Google Veo 系列 ---
      {
        id: 'fal-ai/veo3',
        name: 'Veo 3',
        description: 'Google Veo 3，原生对话/音效/环境音，支持唇形同步',
        modes: ['text-to-video'],
        mediaType: 'video',
        provider: this.name,
        supportsAudio: true,
      },

      // --- MiniMax 海螺系列 ---
      {
        id: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
        name: 'MiniMax Hailuo-02 (768p)',
        description: 'MiniMax 海螺 02，768p 分辨率，性价比高',
        modes: ['text-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
      {
        id: 'fal-ai/minimax/hailuo-02/standard/image-to-video',
        name: 'MiniMax Hailuo-02 (图生视频)',
        description: 'MiniMax 海螺 02 图生视频',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },

      // --- Vidu 系列（生数科技） ---
      {
        id: 'fal-ai/vidu/q2/image-to-video/pro',
        name: 'Vidu Q2 Pro (图生视频)',
        description: '生数 Vidu Q2 Pro，720p/1080p，支持 BGM',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
      {
        id: 'fal-ai/vidu/start-end-to-video',
        name: 'Vidu 首尾帧过渡',
        description: '指定首帧和尾帧，生成平滑过渡视频（适合转场）',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
      {
        id: 'fal-ai/vidu/reference-to-video',
        name: 'Vidu 参考图生视频',
        description: '基于参考图生成主体一致的视频',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },

      // --- MiniMax 海螺 2.3 系列（最新） ---
      {
        id: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video',
        name: 'Hailuo 2.3 Standard (文生视频)',
        description: '海螺 2.3 标准版 768p，运动物理逼真',
        modes: ['text-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
      {
        id: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video',
        name: 'Hailuo 2.3 Standard (图生视频)',
        description: '海螺 2.3 标准版 768p 图生视频',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
      {
        id: 'fal-ai/minimax/hailuo-2.3/pro/image-to-video',
        name: 'Hailuo 2.3 Pro (图生视频)',
        description: '海螺 2.3 Pro 1080p 高清图生视频',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },

      // --- Luma Ray 2 系列 ---
      {
        id: 'fal-ai/luma-dream-machine/ray-2',
        name: 'Luma Ray 2 (文生视频)',
        description: 'Luma Ray 2，真实运动和物理效果，5s/9s',
        modes: ['text-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
      {
        id: 'fal-ai/luma-dream-machine/ray-2/image-to-video',
        name: 'Luma Ray 2 (图生视频)',
        description: 'Luma Ray 2 图生视频',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },

      // --- 万相 Wan 系列 ---
      {
        id: 'fal-ai/wan/v2.2-a14b/image-to-video',
        name: 'Wan 2.2 (图生视频)',
        description: '阿里万相 2.2，支持 LoRA',
        modes: ['image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
    ]

    if (mediaType) {
      return models.filter((m) => m.mediaType === mediaType)
    }

    return models
  }

  // ==================== 私有方法 ====================

  /** 映射 fal.ai 任务状态 */
  private mapStatus(falStatus: string): TaskStatusEnum {
    const statusMap: Record<string, TaskStatusEnum> = {
      IN_QUEUE: 'pending',
      IN_PROGRESS: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed',
    }
    return statusMap[falStatus] ?? 'pending'
  }

  /**
   * 解析 taskId
   * fal.ai 的任务 ID 编码为 "modelId::requestId"
   */
  private parseTaskId(taskId: string): [string, string] {
    const separatorIndex = taskId.indexOf('::')
    if (separatorIndex === -1) {
      throw new ProviderError(
        '无效的任务 ID 格式，应为 "modelId::requestId"',
        'INVALID_TASK_ID',
        this.name
      )
    }
    return [
      taskId.substring(0, separatorIndex),
      taskId.substring(separatorIndex + 2),
    ]
  }

  /** 解析 fal.ai 返回结果为统一格式 */
  private parseResult(
    taskId: string,
    result: FalResultResponse,
    modelId: string
  ): ImageResult | VideoResult {
    // 图片结果
    if (result.images && result.images.length > 0) {
      return {
        taskId,
        imageUrls: result.images.map((img) => img.url),
        modelId,
        seed: result.seed,
        duration: result.timings?.inference,
      }
    }

    // 视频结果（单个视频）
    if (result.video) {
      return {
        taskId,
        videoUrls: [result.video.url],
        modelId,
        processingTime: result.timings?.inference,
      }
    }

    // 视频结果（多个视频）
    if (result.videos && result.videos.length > 0) {
      return {
        taskId,
        videoUrls: result.videos.map((v) => v.url),
        modelId,
        processingTime: result.timings?.inference,
      }
    }

    throw new ProviderError('无法解析返回结果', 'PARSE_ERROR', this.name)
  }
}
