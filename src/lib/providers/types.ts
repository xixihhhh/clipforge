/**
 * AI Provider unified type definitions
 * Defines common interfaces and data types for all AI platforms
 */

// ==================== enums ====================

/** Generation mode */
export type GenerationMode =
  | 'text-to-image'     // text to image
  | 'image-to-image'    // image to image (style transfer, etc.)
  | 'text-to-video'     // text to video
  | 'image-to-video'    // image to video
  | 'video-to-video'    // video to video (style transfer, etc.)

/** Task status enum */
export type TaskStatusEnum =
  | 'pending'       // queued
  | 'processing'    // generating
  | 'completed'     // done
  | 'failed'        // failed
  | 'cancelled'     // cancelled

/** Media type */
export type MediaType = 'image' | 'video'

// ==================== config types ====================

/** Provider configuration */
export interface ProviderConfig {
  /** Platform identifier name */
  name: string
  /** API key */
  apiKey: string
  /** API base URL */
  baseUrl: string
  /** Request timeout in milliseconds; default 30000 */
  timeout?: number
  /** Additional request headers */
  headers?: Record<string, string>
  /** Platform-specific configuration */
  extra?: Record<string, unknown>
}

// ==================== model types ====================

/** Model information */
export interface Model {
  /** Model ID */
  id: string
  /** Model name */
  name: string
  /** Model description */
  description?: string
  /** Supported generation modes */
  modes: GenerationMode[]
  /** Supported media type */
  mediaType: MediaType
  /** Platform this model belongs to */
  provider: string
  /** Whether the model supports generating video with an audio track (voiceover/sound effects) */
  supportsAudio?: boolean
  /** Additional model metadata */
  extra?: Record<string, unknown>
}

// ==================== image-related types ====================

/** Image generation options */
export interface ImageOptions {
  /** Model ID to use */
  modelId: string
  /** Generation mode */
  mode: 'text-to-image' | 'image-to-image'
  /** Text prompt */
  prompt: string
  /** Negative prompt */
  negativePrompt?: string
  /** Output width */
  width?: number
  /** Output height */
  height?: number
  /** Number of images to generate */
  count?: number
  /** Reference image URL (image-to-image mode) */
  referenceImageUrl?: string
  /** Guidance scale; controls how closely the output follows the prompt */
  guidanceScale?: number
  /** Number of inference steps */
  steps?: number
  /** Random seed */
  seed?: number
  /** Additional parameters */
  extra?: Record<string, unknown>
}

/** Image generation result */
export interface ImageResult {
  /** Task ID */
  taskId: string
  /** List of generated image URLs */
  imageUrls: string[]
  /** Generation time (milliseconds) */
  duration?: number
  /** Model ID */
  modelId: string
  /** Seed value used */
  seed?: number
  /** Additional response data */
  extra?: Record<string, unknown>
}

// ==================== video-related types ====================

/** Video generation options */
export interface VideoOptions {
  /** Model ID to use */
  modelId: string
  /** Generation mode */
  mode: 'text-to-video' | 'image-to-video' | 'video-to-video'
  /** Text prompt */
  prompt: string
  /** Negative prompt */
  negativePrompt?: string
  /** Output width */
  width?: number
  /** Output height */
  height?: number
  /** Video duration (seconds) */
  duration?: number
  /** Frame rate */
  fps?: number
  /** First-frame image URL (image-to-video mode) */
  firstFrameUrl?: string
  /** Last-frame image URL (supported by some platforms) */
  lastFrameUrl?: string
  /** Reference video URL (video-to-video mode) */
  referenceVideoUrl?: string
  /** Motion strength; controls the magnitude of motion in the video */
  motionStrength?: number
  /** Guidance scale */
  guidanceScale?: number
  /** Random seed */
  seed?: number
  /** Voiceover script (models that support audio will produce a video with narration) */
  voiceover?: string
  /** Audio prompt (describes sound effects / music style; supported by some models) */
  audioPrompt?: string
  /** Whether to enable audio generation */
  audioEnabled?: boolean
  /** Additional parameters */
  extra?: Record<string, unknown>
}

/** Video generation result */
export interface VideoResult {
  /** Task ID */
  taskId: string
  /** List of generated video URLs */
  videoUrls: string[]
  /** Cover image URL */
  coverImageUrl?: string
  /** Video duration (seconds) */
  duration?: number
  /** Generation time (milliseconds) */
  processingTime?: number
  /** Model ID */
  modelId: string
  /** Whether the video contains an audio track */
  hasAudio?: boolean
  /** Additional response data */
  extra?: Record<string, unknown>
}

// ==================== task status types ====================

/** Task status information */
export interface TaskStatus {
  /** Task ID */
  taskId: string
  /** Current status */
  status: TaskStatusEnum
  /** Progress percentage (0-100) */
  progress?: number
  /** Result data (when completed) */
  result?: ImageResult | VideoResult
  /** Error message (when failed) */
  error?: string
  /** Error code */
  errorCode?: string
  /** Task creation time */
  createdAt?: string
  /** Task last-updated time */
  updatedAt?: string
  /** Additional info */
  extra?: Record<string, unknown>
}

// ==================== Provider interface ====================

/** AI Provider unified interface */
export interface AIProvider {
  /** Platform identifier name */
  readonly name: string

  /** Platform display name */
  readonly displayName: string

  /**
   * Generate an image
   * @param options Image generation options
   * @returns Image generation result or task ID (async mode)
   */
  generateImage(options: ImageOptions): Promise<ImageResult>

  /**
   * Generate a video
   * @param options Video generation options
   * @returns Video generation result or task ID (async mode)
   */
  generateVideo(options: VideoOptions): Promise<VideoResult>

  /**
   * Query task status
   * @param taskId Task ID
   * @returns Task status information
   */
  getTaskStatus(taskId: string): Promise<TaskStatus>

  /**
   * Submit a video generation task WITHOUT waiting for the result (two-phase mode).
   * Returns as soon as the provider acknowledges the task, so the caller can persist
   * the task ID before any polling starts — a poll failure then never loses a paid task
   * (issue #16). `modelId` is the model actually submitted (may differ from the request
   * when the provider remaps it, e.g. text-to-video → image-to-video).
   * Optional: providers without async task support keep using generateVideo only.
   */
  submitVideoTask?(options: VideoOptions): Promise<{ taskId: string; modelId: string }>

  /**
   * Wait for a previously submitted task to finish (companion to submitVideoTask).
   * Transient status-query failures are tolerated instead of aborting — only a
   * definitive terminal state (or persistent query failure) ends the wait.
   */
  waitForTask?(taskId: string, options?: { interval?: number; maxAttempts?: number }): Promise<TaskStatus>

  /**
   * Get the list of available models
   * @param mediaType Optional media type filter
   * @returns List of models
   */
  listModels(mediaType?: MediaType): Promise<Model[]>
}

// ==================== factory types ====================

/** Provider registration entry */
export interface ProviderRegistration {
  /** Platform identifier name */
  name: string
  /** Platform display name */
  displayName: string
  /** Platform description */
  description: string
  /** Factory function */
  factory: (config: ProviderConfig) => AIProvider
}
