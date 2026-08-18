/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from 'electron-updater';
import type { AppUpdater } from 'electron-updater/out/AppUpdater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { CdnGenericProvider } from '@/process/services/cdnGenericProvider';
import { buildCdnFeedOptions, isUpdateFeedConfigured, UPDATE_FEED_URL_ENV } from '@/process/services/updateFeed';

const TEST_FEED = 'https://updates.example.com/releases';

const makeRuntimeOptions = (): ProviderRuntimeOptions => ({
  isUseMultipleRangeRequest: true,
  platform: 'darwin',
  executor: {
    request: vi.fn(),
  } as unknown as ProviderRuntimeOptions['executor'],
});

afterEach(() => {
  delete process.env[UPDATE_FEED_URL_ENV];
});

describe('CDN update feed options', () => {
  it('reports no feed and builds no provider when unconfigured', () => {
    delete process.env[UPDATE_FEED_URL_ENV];

    // Privacy contract: with no Pavii-owned feed there must be no update
    // endpoint at all — the app must never fall back to the upstream vendor.
    expect(isUpdateFeedConfigured()).toBe(false);
    expect(buildCdnFeedOptions()).toBeNull();
  });

  it('builds a custom electron-updater provider pointed at the configured feed', () => {
    process.env[UPDATE_FEED_URL_ENV] = TEST_FEED;

    const options = buildCdnFeedOptions();

    expect(isUpdateFeedConfigured()).toBe(true);
    expect(options?.provider).toBe('custom');
    expect(options?.url).toBe(TEST_FEED);
    expect(options?.updateProvider).toBe(CdnGenericProvider);
  });

  it('ignores a blank feed value', () => {
    process.env[UPDATE_FEED_URL_ENV] = '   ';

    expect(isUpdateFeedConfigured()).toBe(false);
    expect(buildCdnFeedOptions()).toBeNull();
  });
});

describe('CdnGenericProvider', () => {
  it('resolves relative update files under the version directory', () => {
    const provider = new CdnGenericProvider(
      {
        provider: 'custom',
        url: TEST_FEED,
      },
      {} as AppUpdater,
      makeRuntimeOptions()
    );

    const files = provider.resolveFiles({
      version: '2.1.14',
      files: [
        {
          url: 'Pavii.Ai-2.1.14-mac-arm64.dmg',
          sha512: 'sha512-value',
        },
      ],
      path: 'Pavii.Ai-2.1.14-mac-arm64.dmg',
      sha512: 'sha512-value',
      releaseDate: '2026-06-08T00:00:00.000Z',
    } satisfies UpdateInfo);

    expect(files[0]?.url.href).toBe(`${TEST_FEED}/2.1.14/Pavii.Ai-2.1.14-mac-arm64.dmg`);
  });
});
