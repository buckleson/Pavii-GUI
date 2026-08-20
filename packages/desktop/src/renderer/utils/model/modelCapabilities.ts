/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, ModelType } from '@/common/config/storage';
import { CAPABILITY_PATTERNS, CAPABILITY_EXCLUSIONS, getBaseModelName } from '@/common/utils/modelCapabilities';

export { hasSpecificModelCapability } from '@/common/utils/modelCapabilities';

// Capability decision cache
const modelCapabilitiesCache = new Map<string, boolean | undefined>();

/**
 * Provider-specific capability rules
 */
const PROVIDER_CAPABILITY_RULES: Record<string, Record<ModelType, boolean | null>> = {
  anthropic: {
    text: true,
    vision: true,
    function_calling: true,
    image_generation: false,
    web_search: false,
    reasoning: false,
    embedding: false,
    rerank: false,
    excludeFromPrimary: false,
  },
  deepseek: {
    text: true,
    vision: null,
    function_calling: true,
    image_generation: false,
    web_search: false,
    reasoning: null,
    embedding: false,
    rerank: false,
    excludeFromPrimary: false,
  },
};

/**
 * Whether the user configured a capability manually
 * @param model - The model
 * @param type - Capability type
 * @returns true/false when explicitly configured, undefined when not
 */
const getUserSelectedCapability = (model: IProvider, type: ModelType): boolean | undefined => {
  const capability = model.capabilities?.find((cap) => cap.type === type);
  return capability?.isUserSelected;
};

/**
 * Look up a capability rule for a provider
 * @param provider - Provider name
 * @param type - Capability type
 * @returns true/false/null, where null means fall back to the default logic
 */
const getProviderCapabilityRule = (provider: string, type: ModelType): boolean | null => {
  const rules = PROVIDER_CAPABILITY_RULES[provider?.toLowerCase()];
  return rules?.[type] ?? null;
};

/**
 * Decide whether a model has a capability, following Cherry Studio's three-tier logic
 * @param model - The model
 * @param type - Capability type
 * @returns true = supported, false = unsupported, undefined = unknown
 */
export const hasModelCapability = (model: IProvider, type: ModelType): boolean | undefined => {
  // Build the cache key, including the capabilities version so stale entries cannot linger
  const capabilitiesHash = model.capabilities ? JSON.stringify(model.capabilities) : '';
  const cacheKey = `${model.id}-${model.platform}-${type}-${capabilitiesHash}`;

  // Check the cache
  if (modelCapabilitiesCache.has(cacheKey)) {
    return modelCapabilitiesCache.get(cacheKey);
  }

  let result: boolean | undefined;

  // 1. Highest priority: explicit user configuration
  const userSelected = getUserSelectedCapability(model, type);
  if (userSelected !== undefined) {
    result = userSelected;
  } else {
    // 2. Then provider-specific rules
    const providerRule = getProviderCapabilityRule(model.platform, type);
    if (providerRule !== null) {
      result = providerRule;
    } else {
      // 3. Then regex matching
      // Whether any model on the platform supports the capability
      const modelNames = model.models || [];

      // One code path for every capability type
      // Whether any model supports the capability
      const exclusions = CAPABILITY_EXCLUSIONS[type];
      const pattern = CAPABILITY_PATTERNS[type];

      const hasSupport = modelNames.some((modelName) => {
        const baseModelName = getBaseModelName(modelName);

        // Check the blocklist
        const isExcluded = exclusions.some((excludePattern) => excludePattern.test(baseModelName));
        if (isExcluded) return false;

        // Check the allowlist
        return pattern.test(baseModelName);
      });

      result = hasSupport ? true : undefined;
    }
  }

  // Cache the result
  modelCapabilitiesCache.set(cacheKey, result);
  return result;
};

/**
 * Clear the capability decision cache
 */
export const clearModelCapabilitiesCache = (): void => {
  modelCapabilitiesCache.clear();
};
