/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model Platform Configuration Module
 *
 * Centralized management of all model platform configurations for extensibility and maintainability
 */

import { resolveBackendAssetUrl } from '@/renderer/utils/platform';

const buildLogoAssetUrl = (path: string): string => {
  return resolveBackendAssetUrl(`/api/assets/logos/${path}`) ?? `/api/assets/logos/${path}`;
};

/**
 * Platform type
 */
export type PlatformType = 'gemini' | 'gemini-vertex-ai' | 'anthropic' | 'custom' | 'new-api' | 'bedrock';

/**
 * Model Platform Configuration Interface
 */
export interface PlatformConfig {
  /** Platform name */
  name: string;
  /** Platform value (for form) */
  value: string;
  /** Logo path */
  logo: string | null;
  /** Platform identifier */
  platform: PlatformType;
  /** Base URL (for preset providers) */
  base_url?: string;
  /** i18n key (optional, for platform names that need translation) */
  i18nKey?: string;
}

/**
 * Model Platform options list
 *
 * 顺序：
 * 1. 自定义（需要用户输入 base url）
 * 2. Moonshot/Kimi（战略合作，置顶展示）
 * 3. New API / Gemini 官方平台
 * 4+ 预设供应商
 */
export const MODEL_PLATFORMS: PlatformConfig[] = [
  // Custom option (requires user to input base url)
  { name: 'Custom', value: 'custom', logo: null, platform: 'custom', i18nKey: 'settings.platformCustom' },

  // Strategic partner pinned right after Custom
  {
    name: 'Moonshot (China)',
    value: 'Moonshot',
    logo: buildLogoAssetUrl('ai-china/kimi.svg'),
    platform: 'custom',
    base_url: 'https://api.moonshot.cn/v1',
  },
  {
    name: 'Moonshot (Global)',
    value: 'Moonshot-Global',
    logo: buildLogoAssetUrl('ai-china/kimi.svg'),
    platform: 'custom',
    base_url: 'https://api.moonshot.ai/v1',
  },

  // New API multi-model gateway
  {
    name: 'New API',
    value: 'new-api',
    logo: buildLogoAssetUrl('ai-cloud/newapi.svg'),
    platform: 'new-api',
    i18nKey: 'settings.platformNewApi',
  },

  // 官方 Gemini 平台
  {
    name: 'Gemini',
    value: 'gemini',
    logo: buildLogoAssetUrl('ai-major/gemini.svg'),
    platform: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com',
  },
  {
    name: 'Gemini (Vertex AI)',
    value: 'gemini-vertex-ai',
    logo: buildLogoAssetUrl('ai-major/gemini.svg'),
    platform: 'gemini-vertex-ai',
  },

  // 预设供应商（按字母顺序排列）
  {
    name: 'OpenAI',
    value: 'OpenAI',
    logo: buildLogoAssetUrl('ai-major/openai.svg'),
    platform: 'custom',
    base_url: 'https://api.openai.com/v1',
  },
  {
    name: 'Anthropic',
    value: 'Anthropic',
    logo: buildLogoAssetUrl('ai-major/anthropic.svg'),
    platform: 'anthropic',
    base_url: 'https://api.anthropic.com',
  },
  {
    name: 'AWS Bedrock',
    value: 'AWS-Bedrock',
    logo: buildLogoAssetUrl('ai-cloud/bedrock.svg'),
    platform: 'bedrock',
    i18nKey: 'settings.platformBedrock',
  },
  {
    name: 'DeepSeek',
    value: 'DeepSeek',
    logo: buildLogoAssetUrl('ai-major/deepseek.svg'),
    platform: 'custom',
    base_url: 'https://api.deepseek.com/v1',
  },
  {
    name: 'MiniMax',
    value: 'MiniMax',
    logo: buildLogoAssetUrl('ai-china/minimax.png'),
    platform: 'custom',
    base_url: 'https://api.minimaxi.com/v1',
  },
  {
    name: 'Novita',
    value: 'Novita',
    logo: buildLogoAssetUrl('ai-cloud/novita.svg'),
    platform: 'custom',
    base_url: 'https://api.novita.ai/openai/v1',
  },
  {
    name: 'OpenRouter',
    value: 'OpenRouter',
    logo: buildLogoAssetUrl('ai-cloud/openrouter.svg'),
    platform: 'custom',
    base_url: 'https://openrouter.ai/api/v1',
  },
  {
    name: 'Dashscope',
    value: 'Dashscope',
    logo: buildLogoAssetUrl('ai-china/qwen.svg'),
    platform: 'custom',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    name: 'Dashscope Coding Plan',
    value: 'Dashscope-Coding',
    logo: buildLogoAssetUrl('ai-china/qwen.svg'),
    platform: 'custom',
    // Base URL intentionally left unset — users must supply their own coding-plan
    // endpoint, so the add-model form should not pre-fill a default.
    base_url: '',
  },
  {
    name: 'SiliconFlow-CN',
    value: 'SiliconFlow-CN',
    logo: buildLogoAssetUrl('ai-cloud/siliconflow.png'),
    platform: 'custom',
    base_url: 'https://api.siliconflow.cn/v1',
  },
  {
    name: 'SiliconFlow',
    value: 'SiliconFlow',
    logo: buildLogoAssetUrl('ai-cloud/siliconflow.png'),
    platform: 'custom',
    base_url: 'https://api.siliconflow.com/v1',
  },
  {
    name: 'Zhipu',
    value: 'Zhipu',
    logo: buildLogoAssetUrl('ai-china/zhipu.svg'),
    platform: 'custom',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    name: 'xAI',
    value: 'xAI',
    logo: buildLogoAssetUrl('ai-major/xai.svg'),
    platform: 'custom',
    base_url: 'https://api.x.ai/v1',
  },
  {
    name: 'Ark',
    value: 'Ark',
    logo: buildLogoAssetUrl('ai-china/volcengine.svg'),
    platform: 'custom',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    name: 'Qianfan',
    value: 'Qianfan',
    logo: buildLogoAssetUrl('ai-china/baidu.svg'),
    platform: 'custom',
    base_url: 'https://qianfan.baidubce.com/v2',
  },
  {
    name: 'Hunyuan',
    value: 'Hunyuan',
    logo: buildLogoAssetUrl('ai-china/tencent.svg'),
    platform: 'custom',
    base_url: 'https://api.hunyuan.cloud.tencent.com/v1',
  },
  {
    name: 'Lingyi',
    value: 'Lingyi',
    logo: buildLogoAssetUrl('ai-china/lingyiwanwu.svg'),
    platform: 'custom',
    base_url: 'https://api.lingyiwanwu.com/v1',
  },
  {
    name: 'Poe',
    value: 'Poe',
    logo: buildLogoAssetUrl('ai-cloud/poe.svg'),
    platform: 'custom',
    base_url: 'https://api.poe.com/v1',
  },
  {
    name: 'PPIO',
    value: 'PPIO',
    logo: buildLogoAssetUrl('ai-cloud/ppio.svg'),
    platform: 'custom',
    base_url: 'https://api.ppinfra.com/v3/openai',
  },
  {
    name: 'ModelScope',
    value: 'ModelScope',
    logo: buildLogoAssetUrl('ai-cloud/modelscope.svg'),
    platform: 'custom',
    base_url: 'https://api-inference.modelscope.cn/v1',
  },
  {
    name: 'InfiniAI',
    value: 'InfiniAI',
    logo: buildLogoAssetUrl('ai-cloud/infiniai.svg'),
    platform: 'custom',
    base_url: 'https://cloud.infini-ai.com/maas/v1',
  },
  {
    name: 'Ctyun',
    value: 'Ctyun',
    logo: buildLogoAssetUrl('ai-cloud/ctyun.svg'),
    platform: 'custom',
    base_url: 'https://wishub-x1.ctyun.cn/v1',
  },
  {
    name: 'StepFun',
    value: 'StepFun',
    logo: buildLogoAssetUrl('ai-china/stepfun.svg'),
    platform: 'custom',
    base_url: 'https://api.stepfun.com/v1',
  },
];

/**
 * New API protocol options for per-model protocol configuration
 */
export const NEW_API_PROTOCOL_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'Anthropic', value: 'anthropic' },
];

/**
 * Auto-detect New API protocol type based on model name
 */
export const detectNewApiProtocol = (modelName: string): string => {
  const name = modelName.toLowerCase();
  if (name.startsWith('claude') || name.startsWith('anthropic')) return 'anthropic';
  if (name.startsWith('gemini') || name.startsWith('models/gemini')) return 'gemini';
  // Default to openai (covers gpt, deepseek, qwen, o1, o3, etc.)
  return 'openai';
};

/**
 * Default platform for the add-model modal — always the first list entry
 */
export const DEFAULT_PLATFORM_VALUE = MODEL_PLATFORMS[0].value;

// Utility Functions ============

/**
 * Get platform config by value
 */
export const getPlatformByValue = (value: string): PlatformConfig | undefined => {
  return MODEL_PLATFORMS.find((p) => p.value === value);
};

/**
 * Get all preset providers (with base_url)
 */
export const getPresetProviders = (): PlatformConfig[] => {
  return MODEL_PLATFORMS.filter((p) => p.base_url);
};

export const getProviderLogo = ({
  name,
  base_url,
  platform,
}: {
  name?: string;
  base_url?: string;
  platform?: string;
}): string | null => {
  if (!name && !base_url && !platform) return null;

  if (platform) {
    const byPlatform = MODEL_PLATFORMS.find((item) => item.platform === platform && item.logo);
    if (byPlatform?.logo) return byPlatform.logo;
  }

  if (name) {
    const byName = MODEL_PLATFORMS.find((item) => item.name === name && item.logo);
    if (byName?.logo) return byName.logo;

    const lowerName = name.toLowerCase();
    const byLowerName = MODEL_PLATFORMS.find((item) => item.name.toLowerCase() === lowerName && item.logo);
    if (byLowerName?.logo) return byLowerName.logo;
  }

  if (base_url) {
    const byUrl = MODEL_PLATFORMS.find((item) => {
      if (!item.base_url || !item.logo) return false;
      try {
        return base_url.includes(new URL(item.base_url).hostname);
      } catch {
        return false;
      }
    });
    if (byUrl?.logo) return byUrl.logo;
  }

  return null;
};

/**
 * Get official Gemini platforms
 */
export const getGeminiPlatforms = (): PlatformConfig[] => {
  return MODEL_PLATFORMS.filter((p) => p.platform === 'gemini' || p.platform === 'gemini-vertex-ai');
};

/**
 * Check if platform is Gemini type
 */
export const isGeminiPlatform = (platform: PlatformType): boolean => {
  return platform === 'gemini' || platform === 'gemini-vertex-ai';
};

/**
 * Check if it's custom option (no preset base_url)
 */
export const isCustomOption = (value: string): boolean => {
  const platform = getPlatformByValue(value);
  return value === 'custom' && !platform?.base_url;
};

// Re-export from common for renderer convenience
export { isNewApiPlatform } from '@/common/utils/platformConstants';

/**
 * Search platforms by name (case-insensitive)
 */
export const searchPlatformsByName = (keyword: string): PlatformConfig[] => {
  const lowerKeyword = keyword.toLowerCase();
  return MODEL_PLATFORMS.filter((p) => p.name.toLowerCase().includes(lowerKeyword));
};
