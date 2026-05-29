/**
 * Provider 配置助手
 * 从请求参数或环境变量获取 Provider 配置
 */

import type { ProviderConfig } from './types';

/** 从环境变量获取 provider 配置 */
export function getEnvProviderConfig(providerId: string): ProviderConfig {
  const prefix = providerId.toUpperCase().replace(/-/g, '_');

  return {
    apiKey: process.env[`${prefix}_API_KEY`] || process.env.AI_API_KEY || '',
    baseUrl: process.env[`${prefix}_API_ENDPOINT`] || getDefaultEndpoint(providerId),
  };
}

/** 获取默认 API 端点 */
function getDefaultEndpoint(providerId: string): string {
  const endpoints: Record<string, string> = {
    'siliconflow': 'https://api.siliconflow.cn/v1',
    'fal-ai': 'https://fal.run',
    'volcengine': 'https://visual.volcengineapi.com',
    'alibaba': 'https://dashscope.aliyuncs.com',
    'atlas-cloud': 'https://api.atlascloud.ai',
    'siliconflow-dh': 'https://api.siliconflow.cn/v1',
  };
  return endpoints[providerId] || '';
}
