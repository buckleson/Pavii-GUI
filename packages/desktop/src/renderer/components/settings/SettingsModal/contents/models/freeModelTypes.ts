/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DeepLinkAddProviderDetail } from '@/renderer/hooks/system/useDeepLink';
import type { PlatformType } from '@/renderer/utils/model/modelPlatforms';
import freeModelsData from './freeModels.json';

/**
 * How closely a provider's documented base URL matches a protocol we can
 * pre-configure without the user editing anything.
 *
 * - `openai`  — an OpenAI-shaped endpoint; the add-provider form can be filled in completely.
 * - `gemini`  — Google's own API shape; maps to the dedicated Gemini platform.
 * - `other`   — reachable, but the documented URL is the vendor's native shape rather
 *               than an OpenAI one, so the protocol may need adjusting after connecting.
 * - `manual`  — the URL cannot be used as printed (Cloudflare embeds a literal
 *               `{account_id}`), so offering a one-click Connect would produce a
 *               provider that silently never works.
 */
export type FreeModelCompat = 'openai' | 'gemini' | 'other' | 'manual';

export type FreeModelRow = {
  name: string;
  context: string;
  maxOutput: string;
  modality: string;
  rateLimit: string;
};

export type FreeModelProvider = {
  id: string;
  name: string;
  apiKeyUrl: string;
  baseUrl: string;
  compat: FreeModelCompat;
  models: FreeModelRow[];
};

export type FreeModelCatalog = {
  source: string;
  capturedAt: string;
  providers: FreeModelProvider[];
};

/** The shipped catalogue. Static on purpose: no third-party call at runtime. */
export const FREE_MODEL_CATALOG = freeModelsData as FreeModelCatalog;

export const FREE_MODEL_PROVIDERS: FreeModelProvider[] = FREE_MODEL_CATALOG.providers;

/** Whether this provider can be handed to the add-provider form pre-filled. */
export const canAutoConfigure = (provider: FreeModelProvider): boolean => provider.compat !== 'manual';

/**
 * The platform the add-provider form should preselect.
 *
 * `new-api` is the generic "base URL + key" platform, which is what every
 * OpenAI-shaped endpoint needs. Gemini has its own platform because its request
 * shape is not OpenAI's, and picking the wrong one produces a provider that
 * looks configured and fails on first use.
 */
export const platformForProvider = (provider: FreeModelProvider): PlatformType =>
  provider.compat === 'gemini' ? 'gemini' : 'new-api';

/**
 * Build the pre-fill payload for `AddPlatformModal`.
 *
 * Deliberately carries no `api_key`: the key is the one thing we cannot know,
 * and the user supplies it (by paste, or from the clipboard prompt).
 */
export const prefillForProvider = (provider: FreeModelProvider): DeepLinkAddProviderDetail => ({
  name: provider.name,
  base_url: provider.baseUrl,
  platform: platformForProvider(provider),
});

/**
 * Whether a string plausibly is an API key.
 *
 * Used only to decide whether offering the clipboard is worth the user's
 * attention, never to validate one — the provider is the authority on that. Kept
 * deliberately loose on shape (vendors differ wildly) and strict on the things
 * that reliably mean "this is not a key": whitespace, prose, and short strings.
 */
export const looksLikeApiKey = (value: string): boolean => {
  const text = value.trim();
  if (text.length < 16 || text.length > 512) return false;
  if (/\s/.test(text)) return false;
  // A key is an opaque token, not a sentence or a URL the user happened to copy.
  if (text.includes('://')) return false;
  return /^[A-Za-z0-9_\-.:~+/=]+$/.test(text);
};
