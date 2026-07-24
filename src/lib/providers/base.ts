/**
 * AI Provider base abstract class
 * Provides common HTTP request, error handling, and task polling capabilities
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

/** API request error */
export class ProviderError extends Error {
  /** Error code */
  code: string
  /** HTTP status code */
  statusCode?: number
  /** Provider name */
  provider: string
  /**
   * Provider task ID attached when the error happened AFTER a paid task was already
   * created (e.g. polling failed). Lets callers persist/recover the task instead of
   * silently dropping something the user already paid for (issue #16).
   */
  taskId?: string

  constructor(message: string, code: string, provider: string, statusCode?: number) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.provider = provider
    this.statusCode = statusCode
  }
}

/** Base Provider abstract class */
export abstract class BaseProvider implements AIProvider {
  abstract readonly name: string
  abstract readonly displayName: string

  protected config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  // ==================== abstract methods (subclasses must implement) ====================

  abstract generateImage(options: ImageOptions): Promise<ImageResult>
  abstract generateVideo(options: VideoOptions): Promise<VideoResult>
  abstract getTaskStatus(taskId: string): Promise<TaskStatus>
  abstract listModels(mediaType?: MediaType): Promise<Model[]>

  // ==================== common utility methods ====================

  /**
   * Send an HTTP request
   * @param path API path (relative to baseUrl)
   * @param options Request options
   * @returns Parsed JSON data
   */
  protected async request<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      body?: unknown
      headers?: Record<string, string>
      timeout?: number
      /**
       * Whether this request is idempotent (safe to auto-retry).
       * Defaults to `method === 'GET'`.
       *
       * Money-safety rule (issue #16): a POST that creates a billable task must NEVER be
       * auto-retried on timeout/network errors/5xx — the client aborting says nothing about
       * whether the server accepted the task, so a blind retry can silently create duplicate
       * paid jobs. Non-idempotent requests are only retried on HTTP 429, which guarantees the
       * server rejected the request without processing it.
       */
      idempotent?: boolean
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, headers = {}, timeout } = options
    const idempotent = options.idempotent ?? method === 'GET'
    const url = `${this.config.baseUrl}${path}`
    const requestTimeout = timeout ?? this.config.timeout ?? 30000

    // build request headers
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...this.config.headers,
      ...headers,
    }

    // auto-retry on transient errors, up to 2 retries with exponential backoff.
    // Idempotent requests (GET) retry on 429 / 5xx / network failure / timeout;
    // non-idempotent requests (task-creating POST) retry ONLY on 429 — see `idempotent` doc above.
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
          // 429 = request rejected before processing, always safe to retry;
          // 5xx may have side effects on the server, so only idempotent requests retry
          if ((response.status === 429 || (response.status >= 500 && idempotent)) && attempt < maxRetries) {
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
        // non-transient errors like 4xx: throw immediately without retry
        if (error instanceof ProviderError && error.statusCode && error.statusCode < 500 && error.statusCode !== 429) {
          throw error
        }
        const isTimeout = error instanceof DOMException && error.name === 'AbortError'
        // For a non-idempotent request, a client-side timeout does NOT mean the server-side
        // task failed or was never billed — surface that explicitly instead of a bare timeout
        const timeoutMessage = idempotent
          ? `请求超时（${requestTimeout}ms）`
          : `请求超时（${requestTimeout}ms）——注意：服务端可能已受理该任务并计费，请先查询任务状态，不要直接重试提交`
        lastError = isTimeout
          ? new ProviderError(timeoutMessage, 'TIMEOUT', this.name)
          : error instanceof ProviderError
            ? error
            : new ProviderError(`网络请求异常: ${error instanceof Error ? error.message : String(error)}`, 'NETWORK_ERROR', this.name)
        // network/timeout errors: only idempotent requests may back off and retry
        // (a non-idempotent POST could have reached the server — retrying risks duplicate paid tasks)
        if (idempotent && attempt < maxRetries) {
          await this.sleep(500 * Math.pow(2, attempt))
          continue
        }
        throw lastError
      } finally {
        clearTimeout(timeoutId)
      }
    }
    // should never reach here — fallback guard
    throw lastError instanceof Error ? lastError : new ProviderError('请求失败', 'UNKNOWN', this.name)
  }

  /**
   * Get authentication headers
   * Subclasses can override to customize the authentication scheme
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    }
  }

  /**
   * Poll task status until completion
   * @param taskId Task ID
   * @param options Polling options
   * @returns Final task status
   */
  protected async pollTaskStatus(
    taskId: string,
    options: {
      /** Polling interval in milliseconds, default 3000 */
      interval?: number
      /** Maximum number of poll attempts, default 200 */
      maxAttempts?: number
      /** Max consecutive status-query failures tolerated before giving up, default 5 */
      maxConsecutiveErrors?: number
      /** Terminal state check; defaults to checking for completed/failed/cancelled */
      isTerminal?: (status: TaskStatusEnum) => boolean
    } = {}
  ): Promise<TaskStatus> {
    const {
      interval = 3000,
      maxAttempts = 200,
      maxConsecutiveErrors = 5,
      isTerminal = (s) => ['completed', 'failed', 'cancelled'].includes(s),
    } = options

    // A transient status-query failure must NOT abort the wait: the task keeps running (and
    // billing) server-side regardless of whether our GET succeeded (issue #16). Only give up
    // after several consecutive failures, and even then report "status unknown", not "failed".
    let consecutiveErrors = 0
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let status: TaskStatus
      try {
        status = await this.getTaskStatus(taskId)
        consecutiveErrors = 0
      } catch (error) {
        consecutiveErrors++
        if (consecutiveErrors >= maxConsecutiveErrors) {
          const err = new ProviderError(
            `任务状态查询连续失败 ${consecutiveErrors} 次（任务 ${taskId} 可能仍在云端执行，未必失败）: ${error instanceof Error ? error.message : String(error)}`,
            'STATUS_UNKNOWN',
            this.name
          )
          err.taskId = taskId
          throw err
        }
        await this.sleep(interval)
        continue
      }

      if (isTerminal(status.status)) {
        if (status.status === 'failed') {
          const err = new ProviderError(
            `任务失败: ${status.error ?? '未知错误'}`,
            status.errorCode ?? 'TASK_FAILED',
            this.name
          )
          err.taskId = taskId
          throw err
        }
        return status
      }

      // wait for the specified interval before the next poll
      await this.sleep(interval)
    }

    const err = new ProviderError(
      `任务轮询超时，已尝试 ${maxAttempts} 次（任务 ${taskId} 可能仍在云端执行）`,
      'POLL_TIMEOUT',
      this.name
    )
    err.taskId = taskId
    throw err
  }

  /**
   * Public wrapper around pollTaskStatus — the two-phase entry point paired with
   * submitVideoTask (see AIProvider.waitForTask). Kept separate so external callers
   * (API routes resuming a persisted task) don't need access to the protected poller.
   */
  async waitForTask(
    taskId: string,
    options: { interval?: number; maxAttempts?: number } = {}
  ): Promise<TaskStatus> {
    return this.pollTaskStatus(taskId, options)
  }

  /**
   * Assert that an async task has a result after completion, or throw a unified NO_RESULT error.
   * Consolidates the repeated `if (!finalStatus.result) throw` guard across providers — reduces it
   * from 3 lines to 1, enforces a consistent error code, and eliminates the risk of a provider
   * silently failing by forgetting the guard (audits found duplicate bugs from per-provider implementations).
   */
  protected requireResult<T>(result: T | undefined | null, message = '任务完成但未返回结果', code = 'NO_RESULT'): T {
    if (result == null) throw new ProviderError(message, code, this.name)
    return result
  }

  /**
   * Sleep for a given duration
   * @param ms Duration in milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Upload a file to a given URL and return its remote address
   * Some platforms require images/videos to be uploaded before use
   * @param fileUrl Local or remote file URL
   * @param uploadPath Upload API path
   * @returns Remote file URL after upload
   */
  protected async uploadMedia(fileUrl: string, uploadPath: string): Promise<string> {
    // default implementation: return the original URL as-is (assumes platform supports remote URLs)
    // subclasses can override this method to implement platform-specific upload logic
    return fileUrl
  }
}
