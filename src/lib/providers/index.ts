/**
 * AI Provider 工厂和注册中心
 * 统一管理所有已注册的 AI 平台 Provider
 */

import type { AIProvider, ProviderConfig, ProviderRegistration } from './types'
import { AtlasCloudProvider } from './atlas-cloud'
import { FalAIProvider } from './fal-ai'
import { VolcEngineProvider } from './volcengine'
import { ReplicateProvider } from './replicate'
import { AlibabaProvider } from './alibaba'
import { SiliconFlowProvider } from './siliconflow'
import { OpenAIProvider } from './openai'

// ==================== Provider 注册表 ====================

/** 已注册的 Provider 列表 */
const providerRegistry: Map<string, ProviderRegistration> = new Map()

/**
 * 注册一个 Provider
 * @param registration Provider 注册信息
 */
function registerProvider(registration: ProviderRegistration): void {
  providerRegistry.set(registration.name, registration)
}

// 注册所有内置 Provider
registerProvider({
  name: 'atlas-cloud',
  displayName: 'Atlas Cloud',
  description: 'Atlas Cloud AI 平台，支持图片和视频生成',
  factory: (config) => new AtlasCloudProvider(config),
})

registerProvider({
  name: 'fal-ai',
  displayName: 'fal.ai',
  description: 'fal.ai 推理平台，支持 FLUX、Kling、Wan 等多种模型',
  factory: (config) => new FalAIProvider(config),
})

registerProvider({
  name: 'volcengine',
  displayName: '火山引擎',
  description: '字节跳动火山引擎，支持可灵（Kling）和豆包 Seedance 等模型',
  factory: (config) => new VolcEngineProvider(config),
})

registerProvider({
  name: 'alibaba',
  displayName: '阿里百炼',
  description: '阿里云百炼大模型平台，支持万相（Wan）视频生成和通义千问图片生成',
  factory: (config) => new AlibabaProvider(config),
})

registerProvider({
  name: 'siliconflow',
  displayName: '硅基流动',
  description: '硅基流动推理平台，支持 FLUX、SD3.5、万相等多种开源模型',
  factory: (config) => new SiliconFlowProvider(config),
})

registerProvider({
  name: 'replicate',
  displayName: 'Replicate',
  description: 'Replicate 模型聚合平台，支持 FLUX、Imagen、Kling、Seedance、Veo 等海量模型',
  factory: (config) => new ReplicateProvider(config),
})

registerProvider({
  name: 'openai',
  displayName: 'OpenAI',
  description: 'OpenAI 官方平台，支持 gpt-image-2 / gpt-image-1.5 图片生成与图生图编辑',
  factory: (config) => new OpenAIProvider(config),
})

// ==================== 工厂函数 ====================

/**
 * 创建 Provider 实例
 * @param config Provider 配置，必须包含 name 字段
 * @returns AI Provider 实例
 * @throws 如果指定的 Provider 不存在
 *
 * @example
 * ```ts
 * const provider = createProvider({
 *   name: 'fal-ai',
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://queue.fal.run',
 * })
 *
 * const result = await provider.generateImage({
 *   modelId: 'fal-ai/flux/dev',
 *   mode: 'text-to-image',
 *   prompt: '一个可爱的猫咪',
 * })
 * ```
 */
export function createProvider(config: ProviderConfig): AIProvider {
  const registration = providerRegistry.get(config.name)

  if (!registration) {
    const available = Array.from(providerRegistry.keys()).join(', ')
    throw new Error(
      `未找到名为 "${config.name}" 的 Provider。可用的 Provider: ${available}`
    )
  }

  return registration.factory(config)
}

/**
 * 获取所有已注册的 Provider 信息
 * @returns Provider 注册信息列表
 */
export function getAvailableProviders(): Array<{
  name: string
  displayName: string
  description: string
}> {
  return Array.from(providerRegistry.values()).map((reg) => ({
    name: reg.name,
    displayName: reg.displayName,
    description: reg.description,
  }))
}

/**
 * 动态注册自定义 Provider
 * @param registration Provider 注册信息
 */
export function registerCustomProvider(registration: ProviderRegistration): void {
  registerProvider(registration)
}

// ==================== 导出类型和类 ====================

export type {
  AIProvider,
  ProviderConfig,
  ProviderRegistration,
  ImageOptions,
  ImageResult,
  VideoOptions,
  VideoResult,
  TaskStatus,
  TaskStatusEnum,
  Model,
  MediaType,
  GenerationMode,
} from './types'

export { BaseProvider, ProviderError } from './base'
export { AtlasCloudProvider } from './atlas-cloud'
export { FalAIProvider } from './fal-ai'
export { VolcEngineProvider } from './volcengine'
export { AlibabaProvider } from './alibaba'
export { SiliconFlowProvider } from './siliconflow'
export { OpenAIProvider } from './openai'
