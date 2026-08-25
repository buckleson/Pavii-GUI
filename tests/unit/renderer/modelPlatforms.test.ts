/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Locks the MODEL_PLATFORMS presentation order: the array order is what the
 * add-platform picker renders, so partner placement is part of the contract.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_PLATFORM_VALUE, MODEL_PLATFORMS, getProviderLogo } from '@renderer/utils/model/modelPlatforms';

describe('MODEL_PLATFORMS ordering', () => {
  it('keeps Custom first and pins both Moonshot entries right after it', () => {
    const values = MODEL_PLATFORMS.map((p) => p.value);
    expect(values[0]).toBe('custom');
    expect(values[1]).toBe('Moonshot');
    expect(values[2]).toBe('Moonshot-Global');
  });

  it('defaults the add-model modal platform to the first list entry', () => {
    expect(DEFAULT_PLATFORM_VALUE).toBe(MODEL_PLATFORMS[0].value);
    expect(DEFAULT_PLATFORM_VALUE).toBe('custom');
  });

  it('defines each Moonshot entry exactly once', () => {
    const moonshotEntries = MODEL_PLATFORMS.filter((p) => p.value.startsWith('Moonshot'));
    expect(moonshotEntries.map((p) => p.value)).toEqual(['Moonshot', 'Moonshot-Global']);
    expect(moonshotEntries.map((p) => p.base_url)).toEqual([
      'https://api.moonshot.cn/v1',
      'https://api.moonshot.ai/v1',
    ]);
  });
});

describe('getProviderLogo', () => {
  const withLogo = MODEL_PLATFORMS.filter((p) => p.logo);

  it('gives every preset its own declared logo, never a bucket-mate mark', () => {
    // The AllProvidersPanel call shape: name + platform + base_url together.
    const wrong = withLogo
      .map((preset) => ({
        name: preset.name,
        expected: preset.logo,
        actual: getProviderLogo({ name: preset.name, platform: preset.platform, base_url: preset.base_url }),
      }))
      .filter((row) => row.actual !== row.expected);

    expect(wrong).toEqual([]);
  });

  it('resolves OpenAI to the OpenAI mark even though it shares the custom bucket', () => {
    const openai = MODEL_PLATFORMS.find((p) => p.name === 'OpenAI');
    const moonshot = MODEL_PLATFORMS.find((p) => p.value === 'Moonshot');

    const logo = getProviderLogo({ name: 'OpenAI', platform: 'custom', base_url: openai?.base_url });

    expect(logo).toBe(openai?.logo);
    expect(logo).not.toBe(moonshot?.logo);
  });

  it('lets a name match win over a same-platform sibling', () => {
    const deepseek = MODEL_PLATFORMS.find((p) => p.name === 'DeepSeek');
    const anthropic = MODEL_PLATFORMS.find((p) => p.name === 'Anthropic');

    // A mislabelled platform must not override who the provider says it is.
    expect(getProviderLogo({ name: 'DeepSeek', platform: 'anthropic' })).toBe(deepseek?.logo);
    expect(getProviderLogo({ name: 'DeepSeek', platform: 'anthropic' })).not.toBe(anthropic?.logo);
  });

  it('shares a logo only between entries that genuinely declare the same asset', () => {
    const byLogo = new Map<string, string[]>();
    for (const preset of withLogo) {
      const names = byLogo.get(preset.logo as string) ?? [];
      names.push(preset.name);
      byLogo.set(preset.logo as string, names);
    }

    const shared = [...byLogo.values()]
      .filter((names) => names.length > 1)
      .map((names) => [...names].sort())
      .sort((a, b) => a[0].localeCompare(b[0]));

    // Brand families, not lookup collisions.
    expect(shared).toEqual([
      ['Dashscope', 'Dashscope Coding Plan'],
      ['Gemini', 'Gemini (Vertex AI)'],
      ['Moonshot (China)', 'Moonshot (Global)'],
      ['SiliconFlow', 'SiliconFlow-CN'],
    ]);
  });

  it('matches a name case-insensitively', () => {
    const xai = MODEL_PLATFORMS.find((p) => p.name === 'xAI');
    expect(getProviderLogo({ name: 'XAI' })).toBe(xai?.logo);
  });

  it('still resolves from base_url alone, as the free-model list does', () => {
    const zhipu = MODEL_PLATFORMS.find((p) => p.name === 'Zhipu');
    expect(getProviderLogo({ name: 'Some Reseller', base_url: zhipu?.base_url })).toBe(zhipu?.logo);
  });

  it('returns null rather than borrowing a mark it cannot justify', () => {
    expect(
      getProviderLogo({ name: 'Totally Unknown Co', platform: 'custom', base_url: 'https://example.invalid/v1' })
    ).toBeNull();
    expect(getProviderLogo({ platform: 'custom' })).toBeNull();
    expect(getProviderLogo({ name: 'Custom', platform: 'custom' })).toBeNull();
    expect(getProviderLogo({})).toBeNull();
  });

  it('keeps resolving platforms whose bucket really is unique', () => {
    const bedrock = MODEL_PLATFORMS.find((p) => p.platform === 'bedrock');
    expect(getProviderLogo({ platform: 'bedrock' })).toBe(bedrock?.logo);
  });
});

describe('provider brand marks', () => {
  it('offers Hugging Face against its OpenAI-compatible router endpoint', () => {
    const hf = MODEL_PLATFORMS.find((p) => p.name === 'Hugging Face');
    expect(hf).toBeDefined();
    expect(hf?.base_url).toBe('https://router.huggingface.co/v1');
    expect(getProviderLogo({ name: 'Hugging Face', platform: hf?.platform })).toBe(hf?.logo);
  });

  it('serves every provider whose engine asset is a placeholder from bundled art', () => {
    // The engine embeds generic glyphs for these — a circle-plus for DeepSeek,
    // a layer stack for OpenRouter, stock Material icons for Hunyuan and
    // Lingyi — so none of them may resolve through /api/assets/logos.
    const bundled = [
      'AWS Bedrock',
      'Ark',
      'DeepSeek',
      'Hugging Face',
      'Hunyuan',
      'Lingyi',
      'ModelScope',
      'OpenRouter',
      'Poe',
      'StepFun',
      'Zhipu',
    ];
    for (const name of bundled) {
      const entry = MODEL_PLATFORMS.find((p) => p.name === name);
      expect(entry, name).toBeDefined();
      expect(entry?.logo, name).toBeTruthy();
      expect(entry?.logo, name).not.toContain('/api/assets/logos/');
    }
  });

  it('leaves Ctyun on the engine asset, the one brand with no mark available', () => {
    // Documented gap rather than a silent inconsistency: if a Ctyun mark is
    // ever added, move it across and delete this test.
    const ctyun = MODEL_PLATFORMS.find((p) => p.name === 'Ctyun');
    expect(ctyun?.logo).toContain('/api/assets/logos/');
  });
});
