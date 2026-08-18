/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CdnGenericProvider } from './cdnGenericProvider';
import type { CdnGenericProviderConfiguration } from './cdnGenericProvider';

/**
 * Update feed for Pavii.Ai.
 *
 * Releases live on GitHub (see `GITHUB_RELEASE_OWNER`/`GITHUB_RELEASE_REPO`),
 * so electron-updater uses its GitHub provider by default. `PAVII_UPDATE_FEED_URL`
 * optionally overrides that with a Pavii-owned CDN.
 *
 * The app must never fall back to the upstream vendor (static.aionui.com /
 * iOfficeAI), which would leak install IP, version and launch timing to a third
 * party and could offer their build as an "update" — guarded by
 * tests/unit/bootstrap/noVendorUpdateEndpoint.test.ts.
 */

/** GitHub repo that hosts Pavii.Ai releases (must match electron-builder.yml `publish`). */
export const GITHUB_RELEASE_OWNER = 'buckleson';
export const GITHUB_RELEASE_REPO = 'Pavii-GUI';
export const UPDATE_FEED_URL_ENV = 'PAVII_UPDATE_FEED_URL';

/** Configured feed base URL, or undefined when updates are intentionally off. */
export function getUpdateFeedUrl(): string | undefined {
  const configured = process.env[UPDATE_FEED_URL_ENV]?.trim();
  return configured ? configured : undefined;
}

/** True when a Pavii-owned update feed is configured. */
export function isUpdateFeedConfigured(): boolean {
  return getUpdateFeedUrl() !== undefined;
}

export type CdnFeedOptions = CdnGenericProviderConfiguration & {
  updateProvider: typeof CdnGenericProvider;
};

/** electron-updater options for the GitHub releases provider. */
export function buildGithubFeedOptions(): { provider: 'github'; owner: string; repo: string } {
  return { provider: 'github', owner: GITHUB_RELEASE_OWNER, repo: GITHUB_RELEASE_REPO };
}

/** Feed options for electron-updater, or null when no CDN override is configured. */
export function buildCdnFeedOptions(): CdnFeedOptions | null {
  const url = getUpdateFeedUrl();
  if (!url) return null;
  return {
    provider: 'custom',
    url,
    updateProvider: CdnGenericProvider,
  };
}
