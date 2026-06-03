/**
 * AI Provider 工厂和注册中心
 * 统一管理所有已注册的 AI 平台 Provider
 */

import type { AIProvider, ProviderConfig, ProviderRegistration } from './types'
import { AtlasCloudProvider } from './atlas-cloud'
import { FalAIProvider } from './fal-ai'
import { VolcEngineProvider } from './volcengine'
import { AlibabaProvider } from './alibaba'
import { SiliconFlowProvider } from './siliconflow'
import { SiliconFlowDigitalHuman } from './digital-human'
import { SiliconFlowLipSync } from './lipsync'
import { SiliconFlowVoiceClone } from './voice-clone'
import { SiliconFlowBackground } from './background'
import { AgnesProvider } from './agnes'

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
  name: 'agnes',
  displayName: 'Agnes AI (Sapiens AI)',
  description: 'Sapiens AI 多模态 AI 平台，支持文本、图生图、文生视频、图生视频',
  defaultConfig: { baseUrl: 'https://apihub.agnes-ai.com/v1' },
  factory: (config) => new AgnesProvider(config),
})

registerProvider({
  name: 'siliconflow',
  displayName: '硅基流动',
  description: '硅基流动推理平台，支持 FLUX、SD3.5、万相等多种开源模型',
  factory: (config) => new SiliconFlowProvider(config),
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
export { SiliconFlowLipSync } from './lipsync'
export { SiliconFlowVoiceClone } from './voice-clone'
export { SiliconFlowBackground } from './background'
export { AgnesProvider } from './agnes'

// ==================== 数字人 Provider ====================
registerProvider({
  id: 'siliconflow-dh',
  name: '硅基流动数字人',
  icon: '🤖',
  description: '基于 Wan 模型的图生视频数字人口播',
  category: 'digital-human' as const,
  factory: (config) => new SiliconFlowDigitalHuman(config),
  defaultConfig: { baseUrl: 'https://api.siliconflow.cn/v1' },
  supportedModes: ['image-to-video' as const],
  models: [
    {
      id: 'wan-i2v-14b',
      name: 'Wan2.1-I2V-14B-720P',
      description: '高质量图生视频，适合数字人口播',
      supportedModes: ['image-to-video' as const],
      pricing: { unit: '次', price: 0.5, currency: 'CNY' },
    },
  ],
})

registerProvider({
  id: 'siliconflow-lipsync',
  name: '硅基流动唇形同步',
  icon: '👄',
  description: '基于 Wan 模型的音频驱动唇形同步，静态形象图 + TTS 音频 → 口播视频',
  category: 'digital-human' as const,
  factory: (config) => new SiliconFlowLipSync(config),
  defaultConfig: { baseUrl: 'https://api.siliconflow.cn/v1' },
  supportedModes: ['image-to-video' as const],
  models: [
    {
      id: 'wan-i2v-14b-lipsync',
      name: 'Wan2.1-I2V-14B 唇形同步',
      description: '音频驱动唇形同步，精准口型匹配',
      supportedModes: ['image-to-video' as const],
      pricing: { unit: '次', price: 0.5, currency: 'CNY' },
    },
  ],
})

registerProvider({
  id: 'siliconflow-voice-clone',
  name: '硅基流动声音克隆',
  icon: '🎙️',
  description: '基于 CosyVoice2 模型的 3 秒声音克隆，支持音色提取和 TTS 合成',
  category: 'digital-human' as const,
  factory: (config) => new SiliconFlowVoiceClone(config),
  defaultConfig: { baseUrl: 'https://api.siliconflow.cn/v1' },
  supportedModes: ['text-to-audio' as const],
  models: [
    {
      id: 'cosyvoice2-0.5b',
      name: 'CosyVoice2-0.5B',
      description: '3 秒声音克隆，支持多语言 TTS 合成',
      supportedModes: ['text-to-audio' as const],
      pricing: { unit: '次', price: 0.1, currency: 'CNY' },
    },
  ],
})

registerProvider({
  id: 'siliconflow-background',
  name: '硅基流动背景替换',
  icon: '🖼️',
  description: '基于 BRIA 模型的智能背景替换，支持虚化、纯色和自定义背景图三种模式',
  category: 'digital-human' as const,
  factory: (config) => new SiliconFlowBackground(config),
  defaultConfig: { baseUrl: 'https://api.siliconflow.cn/v1' },
  supportedModes: ['image-to-image' as const],
  models: [
    {
      id: 'bria-2.3',
      name: 'BRIA-2.3',
      description: '高质量背景替换，支持虚化/纯色/自定义背景',
      supportedModes: ['image-to-image' as const],
      pricing: { unit: '次', price: 0.2, currency: 'CNY' },
    },
  ],
})
