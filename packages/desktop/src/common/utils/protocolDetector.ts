/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Protocol Detector for AionRouter
 *
 * 支持自动检测 API 端点使用的协议类型：
 * - OpenAI 协议（大多数第三方服务）
 * - Gemini 协议（Google 官方）
 * - Anthropic 协议（Claude 官方）
 */

/**
 * Supported protocol types
 */
export type ProtocolType = 'openai' | 'gemini' | 'anthropic' | 'unknown';

/**
 * Protocol detection result
 */
export interface ProtocolDetectionResult {
  /** Detected protocol type */
  protocol: ProtocolType;
  /** Whether detection succeeded */
  success: boolean;
  /** Confidence level (0-100) */
  confidence: number;
  /** Response time in milliseconds */
  latency?: number;
  /** Error message */
  error?: string;
  /** Fixed base URL if needed */
  fixedBaseUrl?: string;
  /** Additional info */
  metadata?: {
    /** Model list if available */
    models?: string[];
    /** API version */
    apiVersion?: string;
    /** Provider name */
    providerName?: string;
  };
}

/**
 * Multi-key test result
 */
export interface MultiKeyTestResult {
  /** Total key count */
  total: number;
  /** Valid key count */
  valid: number;
  /** Invalid key count */
  invalid: number;
  /** Detailed result for each key */
  details: Array<{
    /** Key index */
    index: number;
    /** Masked key */
    maskedKey: string;
    /** Whether valid */
    valid: boolean;
    /** Error message */
    error?: string;
    /** Latency */
    latency?: number;
  }>;
}

/**
 * Protocol detection request parameters
 */
export interface ProtocolDetectionRequest {
  /** Base URL */
  base_url: string;
  /** API Key (can be comma or newline separated) */
  api_key: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to test all keys */
  testAllKeys?: boolean;
  /** Specific protocol to test (if known) */
  preferredProtocol?: ProtocolType;
}

/**
 * Protocol detection response
 */
export interface ProtocolDetectionResponse {
  /** Whether successful */
  success: boolean;
  /** Detected protocol */
  protocol: ProtocolType;
  /** Confidence */
  confidence: number;
  /** Error message */
  error?: string;
  /** Fixed base URL */
  fixedBaseUrl?: string;
  /** Suggested action */
  suggestion?: {
    /** Suggestion type */
    type: 'switch_platform' | 'fix_url' | 'check_key' | 'none';
    /** Suggestion message */
    message: string;
    /** Suggested platform */
    suggestedPlatform?: string;
    /** i18n key for frontend */
    i18nKey?: string;
    /** i18n parameters */
    i18nParams?: Record<string, string>;
  };
  /** Multi-key test result if enabled */
  multiKeyResult?: MultiKeyTestResult;
  /** Model list */
  models?: string[];
}

/**
 * Protocol signature definitions
 */
interface ProtocolSignature {
  /** Protocol type */
  protocol: ProtocolType;
  /** Test endpoint templates */
  endpoints: Array<{
    path: string;
    method: 'GET' | 'POST';
    /** Headers */
    headers?: (api_key: string) => Record<string, string>;
    /** Request body for POST */
    body?: object;
    /** Response validator */
    validator: (response: any, status: number) => boolean;
  }>;
  /** API Key format validation */
  keyPattern?: RegExp;
  /** URL characteristics */
  urlPatterns?: RegExp[];
}

/**
 * Protocol signature configurations
 *
 * Reference GPT-Load Channel design, each protocol defines its signatures
 */
export const PROTOCOL_SIGNATURES: ProtocolSignature[] = [
  // Gemini 协议
  {
    protocol: 'gemini',
    // Gemini API Key format: starts with AIza, followed by 35 characters
    keyPattern: /^AIza[A-Za-z0-9_-]{35}$/,
    urlPatterns: [
      /generativelanguage\.googleapis\.com/, // 标准 Gemini API
      /aiplatform\.googleapis\.com/, // Vertex AI
      /gemini\.google\.com/, // Gemini 网页版
      /aistudio\.google\.com/, // AI Studio
    ],
    endpoints: [
      {
        path: '/v1beta/models',
        method: 'GET',
        headers: () => ({}),
        validator: (response, status) => {
          if (status !== 200) return false;
          return response?.models && Array.isArray(response.models);
        },
      },
      {
        path: '/v1/models',
        method: 'GET',
        headers: () => ({}),
        validator: (response, status) => {
          if (status !== 200) return false;
          return response?.models && Array.isArray(response.models);
        },
      },
    ],
  },
  // OpenAI 协议（包括兼容服务）
  {
    protocol: 'openai',
    // OpenAI Key 格式多样：
    // - 标准格式: sk-xxx
    // - 项目 Key: sk-proj-xxx
    // - 服务账号: sk-svcacct-xxx
    // - 第三方服务可能使用其他格式
    keyPattern: /^sk-[A-Za-z0-9-_]{20,}$/,
    urlPatterns: [
      /api\.openai\.com/, // OpenAI 官方
      /\.openai\.azure\.com/, // Azure OpenAI
      /api\.deepseek\.com/, // DeepSeek
      /api\.moonshot\.cn/, // Moonshot/Kimi China
      /api\.moonshot\.ai/, // Moonshot/Kimi Global
      /api\.mistral\.ai/, // Mistral AI
      /api\.groq\.com/, // Groq
      /openrouter\.ai/, // OpenRouter
      /api\.together\.xyz/, // Together AI
      /api\.perplexity\.ai/, // Perplexity
      /dashscope\.aliyuncs\.com/, // 阿里云 DashScope
      /aip\.baidubce\.com/, // 百度千帆
      /ark\.cn-beijing\.volces\.com/, // 火山引擎
      /open\.bigmodel\.cn/, // 智谱 AI
      /api\.siliconflow\.cn/, // SiliconFlow
      /api\.siliconflow\.com/, // SiliconFlow (.com)
      /api\.lingyiwanwu\.com/, // 零一万物
      /api\.minimaxi\.com/, // MiniMax China
      /api\.minimax\.io/, // MiniMax Global
      /platform\.minimaxi\.com/, // MiniMax Platform
      /localhost/, // 本地服务
      /127\.0\.0\.1/, // 本地服务
      /0\.0\.0\.0/, // 本地服务
    ],
    endpoints: [
      {
        path: '/models',
        method: 'GET',
        headers: (api_key) => ({
          Authorization: `Bearer ${api_key}`,
        }),
        validator: (response, status) => {
          if (status !== 200) return false;
          return response?.data && Array.isArray(response.data);
        },
      },
      {
        path: '/v1/models',
        method: 'GET',
        headers: (api_key) => ({
          Authorization: `Bearer ${api_key}`,
        }),
        validator: (response, status) => {
          if (status !== 200) return false;
          return response?.data && Array.isArray(response.data);
        },
      },
    ],
  },
  // Anthropic 协议
  {
    protocol: 'anthropic',
    // Anthropic Key 格式：sk-ant- 开头
    keyPattern: /^sk-ant-[A-Za-z0-9-]{80,}$/,
    urlPatterns: [
      /api\.anthropic\.com/, // Anthropic 官方
      /claude\.ai/, // Claude 网页版
    ],
    endpoints: [
      {
        // Anthropic doesn't have models endpoint, use messages endpoint
        path: '/v1/messages',
        method: 'POST',
        headers: (api_key) => ({
          'x-api-key': api_key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        }),
        body: {
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        },
        validator: (_response, status) => {
          // 200 or 400 (param error but auth success) are both valid
          return status === 200 || status === 400;
        },
      },
    ],
  },
];

/**
 * Known third-party OpenAI-compatible service key patterns
 *
 * These services use OpenAI protocol but with different key formats
 */
export const THIRD_PARTY_KEY_PATTERNS: Array<{ pattern: RegExp; name: string; protocol: ProtocolType }> = [
  { pattern: /^sk-[A-Za-z0-9-_]{20,}$/, name: 'OpenAI/Compatible', protocol: 'openai' },
  { pattern: /^AIza[A-Za-z0-9_-]{35}$/, name: 'Google/Gemini', protocol: 'gemini' },
  { pattern: /^sk-ant-[A-Za-z0-9-]{80,}$/, name: 'Anthropic', protocol: 'anthropic' },
  { pattern: /^gsk_[A-Za-z0-9]{52}$/, name: 'Groq', protocol: 'openai' },
  { pattern: /^pplx-[A-Za-z0-9]{48}$/, name: 'Perplexity', protocol: 'openai' },
  { pattern: /^[A-Za-z0-9]{32}$/, name: 'DeepSeek/Moonshot', protocol: 'openai' },
  { pattern: /^[A-Za-z0-9]{64}$/, name: 'SiliconFlow/Together', protocol: 'openai' },
];

/**
 * Parse multiple API keys from string
 */
export function parseApiKeys(api_keyString: string): string[] {
  if (!api_keyString) return [];
  return api_keyString
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Mask API key for display
 */
export function maskApiKey(api_key: string): string {
  if (api_key.length <= 8) return '***';
  return `${api_key.substring(0, 4)}...${api_key.substring(api_key.length - 4)}`;
}

/**
 * Common API path suffixes
 *
 * Used to generate candidate URL list when user enters full endpoint URL
 */
export const API_PATH_SUFFIXES = [
  // Gemini 路径
  '/v1beta/models',
  '/v1/models',
  '/models',
  // OpenAI 路径
  '/v1/chat/completions',
  '/chat/completions',
  '/v1/completions',
  '/completions',
  '/v1/embeddings',
  '/embeddings',
  // Anthropic 路径
  '/v1/messages',
  '/messages',
];

/**
 * Normalize base URL (basic cleanup only)
 *
 * Only removes trailing slashes, does not modify path
 */
export function normalizeBaseUrl(base_url: string): string {
  if (!base_url) return '';
  let url = base_url.trim();
  // 移除末尾斜杠
  url = url.replace(/\/+$/, '');
  return url;
}

/**
 * Remove known API path suffix from URL
 */
export function removeApiPathSuffix(base_url: string): string | null {
  if (!base_url) return null;
  const url = base_url.replace(/\/+$/, '');

  // 按长度降序排列，先匹配更长的路径
  const sortedSuffixes = [...API_PATH_SUFFIXES].toSorted((a, b) => b.length - a.length);
  for (const suffix of sortedSuffixes) {
    if (url.toLowerCase().endsWith(suffix.toLowerCase())) {
      return url.slice(0, -suffix.length).replace(/\/+$/, '');
    }
  }

  return null; // 没有匹配的后缀
}

/**
 * Guess protocol type from URL
 */
export function guessProtocolFromUrl(base_url: string): ProtocolType | null {
  const url = base_url.toLowerCase();

  for (const sig of PROTOCOL_SIGNATURES) {
    if (sig.urlPatterns) {
      for (const pattern of sig.urlPatterns) {
        if (pattern.test(url)) {
          return sig.protocol;
        }
      }
    }
  }

  return null;
}

/**
 * Guess protocol type from API key format
 *
 * Prioritize more specific patterns, then general patterns
 */
export function guessProtocolFromKey(api_key: string): ProtocolType | null {
  // 先尝试标准协议签名
  for (const sig of PROTOCOL_SIGNATURES) {
    if (sig.keyPattern && sig.keyPattern.test(api_key)) {
      return sig.protocol;
    }
  }

  // 再尝试第三方服务 Key 格式
  for (const pattern of THIRD_PARTY_KEY_PATTERNS) {
    if (pattern.pattern.test(api_key)) {
      return pattern.protocol;
    }
  }

  return null;
}

/**
 * Identify service provider name from API key
 */
export function identifyProviderFromKey(api_key: string): string | null {
  for (const pattern of THIRD_PARTY_KEY_PATTERNS) {
    if (pattern.pattern.test(api_key)) {
      return pattern.name;
    }
  }
  return null;
}

/**
 * Get display name for protocol
 */
export function getProtocolDisplayName(protocol: ProtocolType): string {
  const names: Record<ProtocolType, string> = {
    openai: 'OpenAI',
    gemini: 'Gemini',
    anthropic: 'Anthropic',
    unknown: 'Unknown',
  };
  return names[protocol] || protocol;
}

/**
 * Get recommended platform for protocol
 */
export function getRecommendedPlatform(protocol: ProtocolType): string | null {
  const platforms: Record<ProtocolType, string | null> = {
    openai: null, // OpenAI 协议是当前项目通过 custom 支持的
    gemini: 'gemini',
    anthropic: 'Anthropic',
    unknown: null,
  };
  return platforms[protocol];
}
