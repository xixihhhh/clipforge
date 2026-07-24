/**
 * Atlas Cloud Provider implementation
 * Built on the Atlas Cloud REST API, supports image and video generation
 * Docs: https://www.atlascloud.ai/docs
 *
 * API protocol (confirmed via official MCP / docs, 2026-06):
 * - Submit image:   POST /model/generateImage  -> { code, data: { id } }
 * - Submit video:   POST /model/generateVideo  -> { code, data: { id } }
 * - Query result:   GET  /model/prediction/{id} -> { id, status, outputs: string[] }
 *   Status values: created | processing | completed | succeeded | failed | timeout
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

// ==================== Atlas Cloud API response types ====================

/** Create-task response (outer code/data wrapper) */
interface AtlasCreateResponse {
  code?: number
  message?: string
  data?: {
    id: string
    [key: string]: unknown
  }
  // some endpoints (enable_sync_mode) return the prediction object directly
  id?: string
  [key: string]: unknown
}

/** Task query response */
interface AtlasPredictionResponse {
  code?: number
  message?: string
  data?: AtlasPrediction
  // also compatible with a response that returns the prediction object directly
  id?: string
  status?: string
  outputs?: string[]
  [key: string]: unknown
}

/** Prediction task object */
interface AtlasPrediction {
  id: string
  model?: string
  status: string
  /** List of generated output URLs (images / videos) */
  outputs?: string[]
  error?: string | { message?: string; code?: string }
  created_at?: string
  has_nsfw_contents?: boolean[]
  [key: string]: unknown
}

// ==================== Model catalog ====================

/**
 * Static model catalog, confirmed from the Atlas Cloud official model list
 * (2026-06, verified via official MCP). Module-level so both listModels()
 * and the mode-capability guard share one source of truth.
 */
const ATLAS_MODELS: Array<Omit<Model, 'provider'>> = [
  // ==================== Video generation ====================
  // --- Doubao Seedance 2.0 (latest, native audio) ---
  { id: 'bytedance/seedance-2.0/text-to-video', name: 'Seedance 2.0 (文生视频)', description: '字节最新视频模型，原生音频，4-15秒，最高1440p', modes: ['text-to-video'], mediaType: 'video', supportsAudio: true },
  { id: 'bytedance/seedance-2.0/image-to-video', name: 'Seedance 2.0 (图生视频)', description: '首帧/尾帧图生视频，原生音频', modes: ['image-to-video'], mediaType: 'video', supportsAudio: true },
  { id: 'bytedance/seedance-2.0/reference-to-video', name: 'Seedance 2.0 (参考生视频)', description: '多模态参考图/视频/音频生成，支持视频编辑', modes: ['image-to-video', 'video-to-video'], mediaType: 'video', supportsAudio: true },
  { id: 'bytedance/seedance-2.0-fast/text-to-video', name: 'Seedance 2.0 Fast (文生视频)', description: 'Seedance 2.0 快速版，原生音频', modes: ['text-to-video'], mediaType: 'video', supportsAudio: true },
  { id: 'bytedance/seedance-2.0-fast/image-to-video', name: 'Seedance 2.0 Fast (图生视频)', description: 'Seedance 2.0 快速版图生视频', modes: ['image-to-video'], mediaType: 'video', supportsAudio: true },
  // --- Doubao Seedance 1.5 ---
  { id: 'bytedance/seedance-v1.5-pro/text-to-video', name: 'Seedance 1.5 Pro (文生视频)', modes: ['text-to-video'], mediaType: 'video', supportsAudio: true },
  { id: 'bytedance/seedance-v1.5-pro/image-to-video', name: 'Seedance 1.5 Pro (图生视频)', modes: ['image-to-video'], mediaType: 'video', supportsAudio: true },
  // --- Kling 3.0 ---
  { id: 'kwaivgi/kling-v3.0-pro/text-to-video', name: 'Kling 3.0 Pro (文生视频)', modes: ['text-to-video'], mediaType: 'video' },
  { id: 'kwaivgi/kling-v3.0-pro/image-to-video', name: 'Kling 3.0 Pro (图生视频)', modes: ['image-to-video'], mediaType: 'video' },
  { id: 'kwaivgi/kling-v3.0-std/text-to-video', name: 'Kling 3.0 Std (文生视频)', modes: ['text-to-video'], mediaType: 'video' },
  { id: 'kwaivgi/kling-v3.0-std/image-to-video', name: 'Kling 3.0 Std (图生视频)', modes: ['image-to-video'], mediaType: 'video' },
  // --- Vidu Q3 ---
  { id: 'vidu/q3-pro/text-to-video', name: 'Vidu Q3 Pro (文生视频)', modes: ['text-to-video'], mediaType: 'video' },
  { id: 'vidu/q3-pro/image-to-video', name: 'Vidu Q3 Pro (图生视频)', modes: ['image-to-video'], mediaType: 'video' },
  { id: 'vidu/q3-pro/start-end-to-video', name: 'Vidu Q3 Pro (首尾帧过渡)', description: '指定首尾帧生成过渡视频', modes: ['image-to-video'], mediaType: 'video' },
  { id: 'vidu/q3-turbo/image-to-video', name: 'Vidu Q3 Turbo (图生视频)', modes: ['image-to-video'], mediaType: 'video' },
  // --- Wan (Wanxiang) ---
  { id: 'alibaba/wan-2.6/image-to-video-flash', name: '万相 2.6 Flash (图生视频)', modes: ['image-to-video'], mediaType: 'video' },
  // ==================== Image generation ====================
  // --- OpenAI GPT Image 2 (latest) ---
  { id: 'openai/gpt-image-2/text-to-image', name: 'GPT Image 2 (文生图)', description: 'OpenAI 最新生图模型，支持任意分辨率，商品图质感好', modes: ['text-to-image'], mediaType: 'image' },
  { id: 'openai/gpt-image-2/edit', name: 'GPT Image 2 (图片编辑)', description: '自然语言精准编辑：换背景、调光线、改文字', modes: ['image-to-image'], mediaType: 'image' },
  // --- Other image generation models ---
  { id: 'bytedance/seedream-v5.0-lite', name: 'Seedream 5.0 Lite (文生图)', modes: ['text-to-image'], mediaType: 'image' },
  { id: 'google/nano-banana-2/text-to-image', name: 'Nano Banana 2 (文生图)', modes: ['text-to-image'], mediaType: 'image' },
]

// ==================== Provider implementation ====================

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
   * Generate an image
   */
  async generateImage(options: ImageOptions): Promise<ImageResult> {
    const body = {
      model: options.modelId,
      prompt: options.prompt,
      // Atlas Cloud uses a "widthxheight" string for dimensions
      ...(options.width && options.height && {
        size: `${options.width}x${options.height}`,
      }),
      ...(options.negativePrompt && { negative_prompt: options.negativePrompt }),
      ...(options.seed !== undefined && { seed: options.seed }),
      // image-to-image / edit mode (e.g. openai/gpt-image-2/edit) passes the reference image as an images array
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

    // async task mode: poll until result is ready
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
   * Submit a video generation task without waiting for the result (two-phase mode).
   * Validates/remaps the model against the requested mode BEFORE any billable call,
   * and returns the provider task ID as soon as Atlas acknowledges the task so the
   * caller can persist it before polling (issue #16).
   */
  async submitVideoTask(options: VideoOptions): Promise<{ taskId: string; modelId: string }> {
    // mode-capability guard: never bill a text-to-video model for an image-to-video request
    const modelId = this.resolveVideoModel(options)

    // models that support audio (e.g. Seedance 2.0) embed the voiceover copy into the prompt
    let prompt = options.prompt
    if (options.audioEnabled && options.voiceover) {
      prompt = `${options.prompt}. 旁白: "${options.voiceover}"`
    }

    const body = {
      model: modelId,
      prompt,
      // first frame for image-to-video mode
      ...(options.firstFrameUrl && { image: options.firstFrameUrl }),
      // last frame (Seedance 2.0 / Vidu start-end transition)
      ...(options.lastFrameUrl && { last_image: options.lastFrameUrl }),
      ...(options.duration && { duration: options.duration }),
      // Atlas Cloud video API uses resolution + ratio instead of width/height
      ...(options.width && options.height && {
        resolution: this.mapResolution(options.width, options.height),
        ratio: this.mapRatio(options.width, options.height),
      }),
      ...(options.seed !== undefined && { seed: options.seed }),
      // audio toggle (Seedance 2.0 generates audio by default; explicitly disable when not enabled)
      generate_audio: options.audioEnabled ?? false,
      watermark: false,
      ...options.extra,
    }

    // Task-creating POST: base.request() will NOT auto-retry it on timeout/network errors
    // (money safety, issue #16). Longer timeout than the 30s default — a slow acknowledge
    // must not be misreported as failure when the server may have accepted the task.
    const response = await this.request<AtlasCreateResponse>('/model/generateVideo', {
      method: 'POST',
      body,
      timeout: 60000,
    })

    return { taskId: this.extractTaskId(response), modelId }
  }

  /**
   * Generate a video (submit + wait). Prefer submitVideoTask + waitForTask when the
   * caller can persist the task ID in between.
   */
  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    const startTime = Date.now()
    const { taskId, modelId } = await this.submitVideoTask(options)

    // video generation takes longer; use a longer polling interval
    const finalStatus = await this.pollTaskStatus(taskId, { interval: 5000 })

    const outputs = this.extractOutputs(finalStatus)

    return {
      taskId,
      videoUrls: outputs,
      duration: options.duration,
      processingTime: Date.now() - startTime,
      modelId,
      hasAudio: options.audioEnabled ?? false,
    }
  }

  /**
   * Query task status
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const response = await this.request<AtlasPredictionResponse>(
      `/model/prediction/${taskId}`
    )

    // compatible with both { code, data: {...} } wrapper format and direct prediction object
    const prediction: AtlasPrediction =
      (response.data as AtlasPrediction | undefined) ??
      (response as unknown as AtlasPrediction)

    const status = this.mapStatus(prediction.status)

    const taskStatus: TaskStatus = {
      taskId: prediction.id || taskId,
      status,
      createdAt: prediction.created_at,
    }

    // parse result when task completes (outputs is a URL array; caller distinguishes image vs video)
    if (status === 'completed' && prediction.outputs && prediction.outputs.length > 0) {
      const urls = prediction.outputs
      // infer media type from file extension; default to video
      const isImage = urls.every((u) => /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(u))
      taskStatus.result = isImage
        ? { taskId: taskStatus.taskId, imageUrls: urls, modelId: prediction.model ?? '' }
        : { taskId: taskStatus.taskId, videoUrls: urls, modelId: prediction.model ?? '' }
    }

    // populate error info when the task fails
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
   * List available models (from the shared static catalog)
   */
  async listModels(mediaType?: MediaType): Promise<Model[]> {
    let models: Model[] = ATLAS_MODELS.map((m) => ({ ...m, provider: this.name }))
    if (mediaType) {
      models = models.filter((m) => m.mediaType === mediaType)
    }
    return models
  }

  // ==================== Private methods ====================

  /**
   * Validate the requested video model against the actual generation intent, remapping to
   * the matching sibling variant when possible. Atlas model IDs follow `family/model/mode`,
   * so the text-to-video and image-to-video variants of one family differ only in the last
   * segment — but they are DIFFERENT billable endpoints.
   *
   * Root cause of issue #16: the default video model auto-picked in settings is a
   * text-to-video variant, and submitting it with a first-frame image silently billed
   * text-to-video while the user clicked "convert image to motion". Now:
   * - first frame present + t2v-only model → remap to the sibling image-to-video model
   *   (throw before submitting if no sibling exists);
   * - image-to-video mode requested but no first frame available → throw before submitting;
   * - unknown/custom model IDs pass through unchanged (nothing to validate against).
   */
  private resolveVideoModel(options: VideoOptions): string {
    const { modelId, firstFrameUrl } = options
    const catalog = new Map(ATLAS_MODELS.map((m) => [m.id, m]))
    const entry = catalog.get(modelId)

    // image-to-video was requested but no usable first frame reached the provider —
    // submitting anyway would bill a video unrelated to the user's image
    if (options.mode === 'image-to-video' && !firstFrameUrl) {
      throw new ProviderError(
        `图生视频缺少首帧图片：请确认图片已生成且可访问（模型 ${modelId} 未提交，未产生费用）`,
        'MISSING_FIRST_FRAME',
        this.name
      )
    }

    if (!entry) return modelId // custom model: no capability info, pass through

    if (firstFrameUrl && !entry.modes.includes('image-to-video')) {
      // remap to the image-to-video sibling of the same family, e.g.
      // bytedance/seedance-2.0/text-to-video -> bytedance/seedance-2.0/image-to-video
      const sibling = modelId.replace(/\/text-to-video$/, '/image-to-video')
      if (sibling !== modelId && catalog.has(sibling)) {
        return sibling
      }
      throw new ProviderError(
        `模型 ${modelId} 不支持图生视频，且没有对应的图生视频变体。请在设置中选择带「图生视频」标识的模型（任务未提交，未产生费用）`,
        'MODEL_MODE_MISMATCH',
        this.name
      )
    }

    if (!firstFrameUrl && !entry.modes.includes('text-to-video')) {
      throw new ProviderError(
        `模型 ${modelId} 是图生视频模型，需要首帧图片才能生成（任务未提交，未产生费用）`,
        'MODEL_MODE_MISMATCH',
        this.name
      )
    }

    return modelId
  }

  /** Extract task ID from the create-task response (compatible with both wrapped and unwrapped formats) */
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

  /** Extract the list of output URLs from the final task status */
  private extractOutputs(finalStatus: TaskStatus): string[] {
    const result = this.requireResult(finalStatus.result)
    const urls = 'imageUrls' in result ? result.imageUrls : result.videoUrls
    if (!urls || urls.length === 0) {
      throw new ProviderError('任务完成但输出为空', 'EMPTY_OUTPUT', this.name)
    }
    return urls
  }

  /** Map Atlas Cloud task status to the unified status enum */
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

  /** Map width/height to the Atlas Cloud resolution tier */
  private mapResolution(width: number, height: number): string {
    const minSide = Math.min(width, height)
    if (minSide >= 1080) return '1080p'
    if (minSide >= 720) return '720p'
    return '480p'
  }

  /** Map width/height to the nearest ratio tier */
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
