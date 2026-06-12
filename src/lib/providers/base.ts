/**
 * AI Provider 基础抽象类
 * 提供通用的 HTTP 请求、错误处理、任务轮询等能力
 */

import type {
  AIProvider,
  ProviderConfig,
  ImageOptions,
  ImageResult,
  VideoOptions,
  VideoResult,
  TaskStatus,
  Model,
  MediaType,
  TaskStatusEnum,
} from './types'

/** API 请求错误 */
export class ProviderError extends Error {
  /** 错误码 */
  code: string
  /** HTTP 状态码 */
  statusCode?: number
  /** 所属平台 */
  provider: string

  constructor(message: string, code: string, provider: string, statusCode?: number) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.provider = provider
    this.statusCode = statusCode
  }
}

/** 基础 Provider 抽象类 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly name: string
  abstract readonly displayName: string

  protected config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  // ==================== 抽象方法（子类必须实现） ====================

  abstract generateImage(options: ImageOptions): Promise<ImageResult>
  abstract generateVideo(options: VideoOptions): Promise<VideoResult>
  abstract getTaskStatus(taskId: string): Promise<TaskStatus>
  abstract listModels(mediaType?: MediaType): Promise<Model[]>

  // ==================== 通用工具方法 ====================

  /**
   * 发送 HTTP 请求
   * @param path API 路径（相对于 baseUrl）
   * @param options 请求选项
   * @returns 解析后的 JSON 数据
   */
  protected async request<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: unknown
      headers?: Record<string, string>
      timeout?: number
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, headers = {}, timeout } = options
    const url = `${this.config.baseUrl}${path}`
    const requestTimeout = timeout ?? this.config.timeout ?? 30000

    // 构建请求头
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...this.config.headers,
      ...headers,
    }

    // 瞬时错误自动重试（429 限流、5xx、网络异常、超时），最多 2 次重试，指数退避
    const maxRetries = 2
    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout)
      try {
        const response = await fetch(url, {
          method,
          headers: mergedHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '')
          // 429/5xx 属可重试瞬时错误
          if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
            lastError = new ProviderError(
              `API 请求失败: ${response.status} ${response.statusText}`,
              'API_ERROR',
              this.name,
              response.status
            )
            await this.sleep(500 * Math.pow(2, attempt))
            continue
          }
          throw new ProviderError(
            `API 请求失败: ${response.status} ${response.statusText} - ${errorBody}`,
            'API_ERROR',
            this.name,
            response.status
          )
        }

        return (await response.json()) as T
      } catch (error) {
        clearTimeout(timeoutId)
        // 4xx 等非瞬时错误：直接抛出不重试
        if (error instanceof ProviderError && error.statusCode && error.statusCode < 500 && error.statusCode !== 429) {
          throw error
        }
        const isTimeout = error instanceof DOMException && error.name === 'AbortError'
        lastError = isTimeout
          ? new ProviderError(`请求超时（${requestTimeout}ms）`, 'TIMEOUT', this.name)
          : error instanceof ProviderError
            ? error
            : new ProviderError(`网络请求异常: ${error instanceof Error ? error.message : String(error)}`, 'NETWORK_ERROR', this.name)
        // 网络/超时/瞬时错误：还有重试机会就退避后重试
        if (attempt < maxRetries) {
          await this.sleep(500 * Math.pow(2, attempt))
          continue
        }
        throw lastError
      } finally {
        clearTimeout(timeoutId)
      }
    }
    // 理论不会走到，兜底
    throw lastError instanceof Error ? lastError : new ProviderError('请求失败', 'UNKNOWN', this.name)
  }

  /**
   * 获取认证请求头
   * 子类可覆盖以自定义认证方式
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    }
  }

  /**
   * 轮询任务状态直到完成
   * @param taskId 任务 ID
   * @param options 轮询选项
   * @returns 最终的任务状态
   */
  protected async pollTaskStatus(
    taskId: string,
    options: {
      /** 轮询间隔（毫秒），默认 3000 */
      interval?: number
      /** 最大轮询次数，默认 200 */
      maxAttempts?: number
      /** 完成状态判断，默认检查 completed/failed/cancelled */
      isTerminal?: (status: TaskStatusEnum) => boolean
    } = {}
  ): Promise<TaskStatus> {
    const {
      interval = 3000,
      maxAttempts = 200,
      isTerminal = (s) => ['completed', 'failed', 'cancelled'].includes(s),
    } = options

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getTaskStatus(taskId)

      if (isTerminal(status.status)) {
        if (status.status === 'failed') {
          throw new ProviderError(
            `任务失败: ${status.error ?? '未知错误'}`,
            status.errorCode ?? 'TASK_FAILED',
            this.name
          )
        }
        return status
      }

      // 等待指定间隔后继续轮询
      await this.sleep(interval)
    }

    throw new ProviderError(
      `任务轮询超时，已尝试 ${maxAttempts} 次`,
      'POLL_TIMEOUT',
      this.name
    )
  }

  /**
   * 延迟执行
   * @param ms 延迟毫秒数
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 上传文件到指定 URL 获取远程地址
   * 部分平台需要先上传图片/视频素材
   * @param fileUrl 本地或远程文件 URL
   * @param uploadPath 上传 API 路径
   * @returns 上传后的远程文件 URL
   */
  protected async uploadMedia(fileUrl: string, uploadPath: string): Promise<string> {
    // 默认实现：直接返回原始 URL（假设平台支持远程 URL）
    // 子类可覆盖此方法实现平台特定的上传逻辑
    return fileUrl
  }
}
