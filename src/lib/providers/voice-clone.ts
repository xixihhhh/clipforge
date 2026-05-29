/**
 * 声音克隆 Provider - 基于 CosyVoice 实现 3 秒声音克隆
 * 用户上传一段录音 → 提取音色特征 → 用于 TTS 合成
 */

import { BaseProvider, ProviderError, sleep } from './base';
import type { ProviderConfig, TaskStatus } from './types';

/** 声音克隆选项 */
export interface VoiceCloneOptions {
  /** 参考音频 URL（3-10秒） */
  referenceAudioUrl?: string;
  /** 参考音频 base64 */
  referenceAudioBase64?: string;
  /** 音色名称 */
  voiceName: string;
  /** 用于声音克隆的文本（可选，用于验证） */
  sampleText?: string;
  /** 配置覆盖 */
  config?: Partial<ProviderConfig>;
}

/** 声音克隆结果 */
export interface VoiceCloneResult {
  /** 音色 ID（用于后续 TTS） */
  voiceId: string;
  /** 音色名称 */
  voiceName: string;
  /** 试听音频 URL */
  previewAudioUrl?: string;
}

/** 声音克隆 Provider 接口 */
export interface VoiceCloneProvider {
  /** 克隆声音 */
  cloneVoice(options: VoiceCloneOptions): Promise<VoiceCloneResult>;
  /** 获取已克隆的音色列表 */
  getClonedVoices(config?: Partial<ProviderConfig>): Promise<VoiceCloneResult[]>;
  /** 用克隆音色合成语音 */
  synthesizeWithClone(voiceId: string, text: string, config?: Partial<ProviderConfig>): Promise<string>;
}

/**
 * 硅基流动声音克隆 Provider
 * 使用 CosyVoice2 模型实现
 */
export class SiliconFlowVoiceClone extends BaseProvider implements VoiceCloneProvider {
  readonly id = 'siliconflow-voice-clone';
  readonly name = '硅基流动声音克隆';
  readonly icon = '🎙️';

  private getApiBase(config?: Partial<ProviderConfig>): string {
    return (config?.baseUrl || this.config.baseUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  }

  /** 克隆声音 */
  async cloneVoice(options: VoiceCloneOptions): Promise<VoiceCloneResult> {
    const apiKey = options.config?.apiKey || this.config.apiKey;
    if (!apiKey) throw new ProviderError('请先配置硅基流动 API Key', 'NO_API_KEY', this.id);
    if (!options.referenceAudioUrl && !options.referenceAudioBase64) {
      throw new ProviderError('请提供参考音频', 'NO_AUDIO', this.id);
    }

    const base = this.getApiBase(options.config);
    const voiceId = `clone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // CosyVoice 声音克隆：通过 /audio/speech 接口的 reference_audio 参数
    // 先用参考音频 + 样本文本生成一段 TTS，保存音色特征
    const sampleText = options.sampleText || '你好，这是一段测试语音，用于验证声音克隆效果。';

    const formData = new FormData();
    formData.append('model', 'FunAudioLLM/CosyVoice2-0.5B');
    formData.append('input', sampleText);
    formData.append('voice', `${voiceId}:custom`);

    if (options.referenceAudioUrl) {
      // 从 URL 下载音频作为参考
      const audioRes = await fetch(options.referenceAudioUrl);
      const audioBlob = await audioRes.blob();
      formData.append('reference_audio', audioBlob, 'reference.wav');
    } else if (options.referenceAudioBase64) {
      const byteChars = atob(options.referenceAudioBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      formData.append('reference_audio', new Blob([byteArray], { type: 'audio/wav' }), 'reference.wav');
    }

    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '未知错误');
      throw new ProviderError(`声音克隆失败 (${res.status}): ${errText.slice(0, 200)}`, 'CLONE_FAILED', this.id, res.status);
    }

    // 返回克隆音色信息
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const previewAudioUrl = `data:audio/mp3;base64,${base64}`;

    // 保存到 localStorage（在调用端处理）
    return {
      voiceId,
      voiceName: options.voiceName,
      previewAudioUrl,
    };
  }

  /** 获取已克隆音色列表（从 localStorage） */
  async getClonedVoices(): Promise<VoiceCloneResult[]> {
    // 实际实现在调用端从 localStorage 读取
    return [];
  }

  /** 用克隆音色合成语音 */
  async synthesizeWithClone(voiceId: string, text: string, config?: Partial<ProviderConfig>): Promise<string> {
    const apiKey = config?.apiKey || this.config.apiKey;
    if (!apiKey) throw new ProviderError('请先配置 API Key', 'NO_API_KEY', this.id);

    const base = this.getApiBase(config);

    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        input: text,
        voice: `${voiceId}:custom`,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '未知错误');
      throw new ProviderError(`TTS 合成失败 (${res.status}): ${errText.slice(0, 200)}`, 'TTS_FAILED', this.id, res.status);
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:audio/mp3;base64,${base64}`;
  }
}
