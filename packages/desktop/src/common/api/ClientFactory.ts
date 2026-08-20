/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@/common/types/provider/authType';
import type { TProviderWithModel } from '../config/storage';
import { OpenAIRotatingClient, type OpenAIClientConfig } from './OpenAIRotatingClient';
import { GeminiRotatingClient, type GeminiClientConfig } from './GeminiRotatingClient';
import { AnthropicRotatingClient, type AnthropicClientConfig } from './AnthropicRotatingClient';
import type { RotatingApiClientOptions } from './RotatingApiClient';
import { getProviderAuthType } from '../utils/platformAuthType';
import { isNewApiPlatform } from '../utils/platformConstants';

export interface ClientOptions {
  timeout?: number;
  proxy?: string;
  baseConfig?: OpenAIClientConfig | GeminiClientConfig | AnthropicClientConfig;
  rotatingOptions?: RotatingApiClientOptions;
}

export type RotatingClient = OpenAIRotatingClient | GeminiRotatingClient | AnthropicRotatingClient;

/**
 * Normalize a base URL for the new-api gateway.
 * Normalize base URL for new-api gateway based on target protocol
 *
 * Strategy: strip every known API path suffix to get the root, then append the suffix the target protocol wants.
 * Strategy: strip all known API path suffixes to get root URL, then add the correct suffix for target protocol.
 *
 * @param base_url Original base URL
 * @param authType Target auth type
 * @returns Normalized base URL
 */
export function normalizeNewApiBaseUrl(base_url: string, authType: AuthType): string {
  if (!base_url) return base_url;

  // 1. Drop the trailing slash and every known API suffix to get the root URL.
  //    Remove trailing slashes, strip all known API path suffixes to get root URL
  const rootUrl = base_url
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
    .replace(/\/v1beta$/, '');

  // 2. Append the path suffix the target protocol expects.
  //    Add the correct path suffix for the target protocol
  switch (authType) {
    case AuthType.USE_OPENAI:
      // OpenAI SDK expects URL with /v1 path
      return `${rootUrl}/v1`;
    case AuthType.USE_GEMINI:
    case AuthType.USE_ANTHROPIC:
      // Gemini/Anthropic SDKs need root URL (they append their own paths)
      return rootUrl;
    default:
      return rootUrl;
  }
}

export class ClientFactory {
  static async createRotatingClient(
    provider: TProviderWithModel,
    options: ClientOptions = {}
  ): Promise<RotatingClient> {
    const authType = getProviderAuthType(provider);
    const rotatingOptions = options.rotatingOptions || { maxRetries: 3, retryDelay: 1000 };

    // Normalize URL for new-api gateway
    const isNewApi = isNewApiPlatform(provider.platform);
    const base_url = isNewApi ? normalizeNewApiBaseUrl(provider.base_url, authType) : provider.base_url;

    switch (authType) {
      case AuthType.USE_OPENAI: {
        const clientConfig: OpenAIClientConfig = {
          baseURL: base_url,
          timeout: options.timeout,
          defaultHeaders: {
            'HTTP-Referer': 'https://pavii.tech',
            'X-Title': 'Pavii.Ai',
          },
          ...(options.baseConfig as OpenAIClientConfig),
        };

        // Apply the proxy configuration when one was given.
        if (options.proxy) {
          const { HttpsProxyAgent } = await import('https-proxy-agent');
          clientConfig.httpAgent = new HttpsProxyAgent(options.proxy);
        }

        return new OpenAIRotatingClient(provider.api_key, clientConfig, rotatingOptions);
      }

      case AuthType.USE_GEMINI: {
        const clientConfig: GeminiClientConfig = {
          model: provider.use_model,
          baseURL: base_url,
          ...(options.baseConfig as GeminiClientConfig),
        };

        return new GeminiRotatingClient(provider.api_key, clientConfig, rotatingOptions, authType);
      }

      case AuthType.USE_VERTEX_AI: {
        const clientConfig: GeminiClientConfig = {
          model: provider.use_model,
          ...(options.baseConfig as GeminiClientConfig),
        };

        return new GeminiRotatingClient(provider.api_key, clientConfig, rotatingOptions, authType);
      }

      case AuthType.USE_ANTHROPIC: {
        const clientConfig: AnthropicClientConfig = {
          model: provider.use_model,
          baseURL: base_url,
          timeout: options.timeout,
          ...(options.baseConfig as AnthropicClientConfig),
        };

        return new AnthropicRotatingClient(provider.api_key, clientConfig, rotatingOptions);
      }

      default: {
        // Default to the OpenAI-compatible protocol.
        const clientConfig: OpenAIClientConfig = {
          baseURL: base_url,
          timeout: options.timeout,
          defaultHeaders: {
            'HTTP-Referer': 'https://pavii.tech',
            'X-Title': 'Pavii.Ai',
          },
          ...(options.baseConfig as OpenAIClientConfig),
        };

        // Apply the proxy configuration when one was given.
        if (options.proxy) {
          const { HttpsProxyAgent } = await import('https-proxy-agent');
          clientConfig.httpAgent = new HttpsProxyAgent(options.proxy);
        }

        return new OpenAIRotatingClient(provider.api_key, clientConfig, rotatingOptions);
      }
    }
  }
}
