/**
 * OpenAI 官方 Provider 实现
 * 支持图片生成（文生图 + 图生图编辑）：GPT Image 系列（gpt-image-2 旗舰 / gpt-image-1.5 等），兼容 DALL·E 3/2。
 * 文档参考: https://platform.openai.com/docs/api-reference/images
 *
 * 说明：
 * - 文生图：POST /images/generations（JSON，同步返回）。
 * - 图生图（编辑）：POST /images/edits（multipart/form-data，同步返回），
 *   支持 gpt-image-* 与 dall-e-2；dall-e-3 不支持编辑。
 * - gpt-image-* 系列只返回 base64（b64_json），不支持 response_format；
 *   DALL·E 2/3 支持 response_format=url。本实现统一把 base64 包成 data URI 返回，
 *   下游落库（persistSource）已支持 data: 协议。
 * - gpt-image-2 支持任意分辨率（宽高被 16 整除、比例 1:3~3:1），竖屏带货可直接出 9:16。
 * - 视频（Sora）下载需鉴权（GET /v1/videos/{id}/content 带 Bearer），
 *   而本应用素材落库走的是无鉴权直链下载，故暂不接入 OpenAI 视频，generateVideo 直接报错。
 */

import { BaseProvider, ProviderError } from './base'
import type {
  ProviderConfig,
  ImageOptions,
  ImageResult,
  VideoResult,
  TaskStatus,
  Model,
  MediaType,
} from './types'

// ==================== OpenAI API 响应类型 ====================

interface OpenAIImageResponse {
  created: number
  data: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
  [key: string]: unknown
}

// ==================== Provider 实现 ====================

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai'
  readonly displayName = 'OpenAI'

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
    })
  }

  /**
   * 生成图片（同步接口）
   * 有参考图 / image-to-image 走编辑接口，否则走文生图。
   */
  async generateImage(options: ImageOptions): Promise<ImageResult> {
    if (options.mode === 'image-to-image' || options.referenceImageUrl) {
      return this.editImage(options)
    }
    return this.textToImage(options)
  }

  /**
   * 生成视频（暂不支持）
   * OpenAI Sora 的成片需鉴权下载，本应用素材落库走无鉴权直链，故暂未接入。
   */
  async generateVideo(): Promise<VideoResult> {
    throw new ProviderError(
      'OpenAI 暂未接入视频生成（Sora），请改用 fal.ai / Replicate / 火山引擎 / 阿里百炼 等视频平台',
      'NOT_SUPPORTED',
      this.name
    )
  }

  /**
   * 查询任务状态
   * 图片为同步生成，无异步任务可查
   */
  async getTaskStatus(): Promise<TaskStatus> {
    throw new ProviderError('OpenAI 图片为同步生成，无需查询任务状态', 'NOT_SUPPORTED', this.name)
  }

  /**
   * 获取可用模型列表（2026 当前 GPT Image 系列，均支持文生图 + 图生图编辑）
   */
  async listModels(mediaType?: MediaType): Promise<Model[]> {
    if (mediaType === 'video') return []

    const models: Model[] = [
      {
        id: 'gpt-image-2',
        name: 'GPT Image 2',
        description: 'OpenAI 2026 旗舰图像模型，任意分辨率（含 9:16 竖屏）、文字渲染与商品保真图生图最佳',
        modes: ['text-to-image', 'image-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'gpt-image-1.5',
        name: 'GPT Image 1.5',
        description: '更快更省的 GPT Image 模型，支持图生图编辑',
        modes: ['text-to-image', 'image-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
    ]

    return models
  }

  // ==================== 私有方法 ====================

  /** 文生图：POST /images/generations（JSON） */
  private async textToImage(options: ImageOptions): Promise<ImageResult> {
    const model = options.modelId
    const isGptImage = model.startsWith('gpt-image')
    const isDalle3 = model.startsWith('dall-e-3')

    const body: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      // DALL·E 3 仅支持 n=1；其余按请求数量（gpt-image 支持多张）
      n: isDalle3 ? 1 : (options.count ?? 1),
      size: this.pickSize(model, options.width, options.height),
      // 仅 DALL·E 系列支持 response_format；gpt-image-* 恒返回 b64_json，不能传该字段
      ...(isGptImage ? {} : { response_format: 'url' }),
      ...options.extra,
    }

    const response = await this.request<OpenAIImageResponse>('/images/generations', {
      method: 'POST',
      body,
      timeout: 120000, // 生图较慢，超时设为 2 分钟
    })

    return this.mapResult(model, response)
  }

  /** 图生图（编辑）：POST /images/edits（multipart） */
  private async editImage(options: ImageOptions): Promise<ImageResult> {
    const model = options.modelId
    if (model.startsWith('dall-e-3')) {
      throw new ProviderError('DALL·E 3 不支持图生图（图片编辑），请改用 gpt-image-1', 'NOT_SUPPORTED', this.name)
    }
    if (!options.referenceImageUrl) {
      throw new ProviderError('图生图缺少参考图', 'BAD_REFERENCE', this.name)
    }

    const isDalle2 = model.startsWith('dall-e-2')
    const { blob, filename } = await this.fetchReferenceImage(options.referenceImageUrl)

    const form = new FormData()
    form.append('model', model)
    form.append('prompt', options.prompt)
    form.append('n', String(isDalle2 ? 1 : (options.count ?? 1)))
    form.append('size', this.pickSize(model, options.width, options.height))
    // gpt-image-* 用数组字段 image[]；dall-e-2 用单字段 image
    form.append(isDalle2 ? 'image' : 'image[]', blob, filename)
    // 仅 dall-e-2 支持 response_format；gpt-image-* 恒返回 b64_json
    if (isDalle2) form.append('response_format', 'url')

    const response = await this.postMultipart<OpenAIImageResponse>('/images/edits', form)
    return this.mapResult(model, response)
  }

  /** 解析图片响应：url 直接用，b64_json 包成 data URI */
  private mapResult(model: string, response: OpenAIImageResponse): ImageResult {
    const imageUrls = (response.data ?? [])
      .map((d) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined))
      .filter((u): u is string => Boolean(u))

    if (imageUrls.length === 0) {
      throw new ProviderError('生成成功但未返回图片数据', 'NO_RESULT', this.name)
    }

    return {
      taskId: `openai-img-${response.created ?? Date.now()}`,
      imageUrls,
      modelId: model,
    }
  }

  /**
   * 把参考图（data URI 或 http(s) URL）取成 Blob，供 multipart 上传
   */
  private async fetchReferenceImage(ref: string): Promise<{ blob: Blob; filename: string }> {
    if (ref.startsWith('data:')) {
      const comma = ref.indexOf(',')
      if (comma === -1) throw new ProviderError('参考图 data URI 解析失败', 'BAD_REFERENCE', this.name)
      const mime = ref.slice(5, comma).split(';')[0] || 'image/png'
      const buf = Buffer.from(ref.slice(comma + 1), 'base64')
      return { blob: new Blob([new Uint8Array(buf)], { type: mime }), filename: `image.${this.extFromMime(mime)}` }
    }
    const resp = await fetch(ref)
    if (!resp.ok) throw new ProviderError(`参考图下载失败: ${resp.status}`, 'BAD_REFERENCE', this.name)
    const blob = await resp.blob()
    const mime = blob.type || resp.headers.get('content-type') || 'image/png'
    return { blob, filename: `image.${this.extFromMime(mime)}` }
  }

  /** multipart POST：不手动设 Content-Type，让 fetch 自动带 boundary */
  private async postMultipart<T>(path: string, form: FormData, timeoutMs = 120000): Promise<T> {
    const url = `${this.config.baseUrl}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: controller.signal,
      })
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '')
        throw new ProviderError(
          `API 请求失败: ${resp.status} ${resp.statusText} - ${errBody}`,
          'API_ERROR',
          this.name,
          resp.status
        )
      }
      return (await resp.json()) as T
    } catch (e) {
      if (e instanceof ProviderError) throw e
      const isTimeout = e instanceof DOMException && e.name === 'AbortError'
      throw new ProviderError(
        isTimeout ? `请求超时（${timeoutMs}ms）` : `网络请求异常: ${e instanceof Error ? e.message : String(e)}`,
        isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        this.name
      )
    } finally {
      clearTimeout(timer)
    }
  }

  /** MIME → 文件扩展名 */
  private extFromMime(mime: string): string {
    if (mime.includes('webp')) return 'webp'
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
    return 'png'
  }

  /**
   * 把请求的宽高映射成 OpenAI 各模型允许的 size 字符串（按横/竖/方就近取值）
   */
  private pickSize(model: string, width?: number, height?: number): string {
    const w = width ?? 1024
    const h = height ?? 1024
    const ratio = w / h
    // DALL·E 3 允许：1024x1024 / 1792x1024 / 1024x1792
    if (model.startsWith('dall-e-3')) {
      if (ratio > 1.2) return '1792x1024'
      if (ratio < 0.83) return '1024x1792'
      return '1024x1024'
    }
    // DALL·E 2 仅方图
    if (model.startsWith('dall-e-2')) return '1024x1024'
    // gpt-image-2 / 2-2026-*：支持任意分辨率，按真实比例就近取（带货可直接出 9:16）
    if (model.startsWith('gpt-image-2')) return this.fitArbitrarySize(w, h)
    // 其余 gpt-image-*（1 / 1.5 / mini）：标准三档 1024x1024 / 1536x1024 / 1024x1536
    if (ratio > 1.2) return '1536x1024'
    if (ratio < 0.83) return '1024x1536'
    return '1024x1024'
  }

  /**
   * gpt-image-2 任意分辨率适配：把长边收到 1536（控成本/时延），
   * 宽高对齐到 16 的倍数，并把比例夹到 1:3 ~ 3:1（API 约束）
   */
  private fitArbitrarySize(width: number, height: number): string {
    const LONG = 1536
    let w = width
    let h = height
    const longest = Math.max(w, h)
    if (longest > LONG) {
      const s = LONG / longest
      w *= s
      h *= s
    }
    const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16)
    w = round16(w)
    h = round16(h)
    // 比例夹到 1:3 ~ 3:1
    if (w / h > 3) w = round16(h * 3)
    if (h / w > 3) h = round16(w * 3)
    return `${w}x${h}`
  }
}
