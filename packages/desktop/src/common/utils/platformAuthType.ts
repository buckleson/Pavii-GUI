/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@/common/types/provider/authType';
import { isNewApiPlatform } from './platformConstants';

/**
 * Resolve the auth type for a platform name
 * @param platform Platform name
 * @returns The matching AuthType
 */
export function getAuthTypeFromPlatform(platform: string): AuthType {
  const platformLower = platform?.toLowerCase() || '';

  // Google OAuth (kept for the Google auth provider path, not the removed
  // Gemini CLI LLM flavor)
  if (platformLower.includes('gemini-with-google-auth')) {
    return AuthType.LOGIN_WITH_GOOGLE;
  }

  if (platformLower.includes('gemini-vertex-ai')) {
    return AuthType.USE_VERTEX_AI;
  }

  if (platformLower.includes('gemini')) {
    return AuthType.USE_GEMINI;
  }

  // Anthropic/Claude platforms
  if (platformLower.includes('anthropic') || platformLower.includes('claude')) {
    return AuthType.USE_ANTHROPIC;
  }

  // AWS Bedrock platform
  if (platformLower.includes('bedrock')) {
    return AuthType.USE_BEDROCK;
  }

  // New API gateway defaults to OpenAI compatible (per-model protocol handled by getProviderAuthType)
  // Every other platform defaults to the OpenAI-compatible protocol
  // Including OpenRouter, OpenAI, DeepSeek, new-api, etc.
  return AuthType.USE_OPENAI;
}

/**
 * Get provider auth type, prefer explicit authType, otherwise infer from platform
 * For new-api platform, supports per-model protocol overrides
 * @param provider Provider config carrying platform and an optional authType
 * @returns The auth type
 */
export function getProviderAuthType(provider: {
  platform: string;
  auth_type?: AuthType;
  model_protocols?: Record<string, string>;
  use_model?: string;
}): AuthType {
  // If auth_type is explicitly specified, use it directly
  if (provider.auth_type) {
    return provider.auth_type;
  }

  // new-api platform: look up per-model protocol override
  if (isNewApiPlatform(provider.platform) && provider.use_model && provider.model_protocols) {
    const protocol = provider.model_protocols[provider.use_model];
    if (protocol) {
      return getAuthTypeFromPlatform(protocol);
    }
  }

  // Otherwise infer from the platform
  return getAuthTypeFromPlatform(provider.platform);
}
