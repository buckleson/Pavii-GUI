/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Privacy contract: a Pavii build must never contact the upstream vendor.
 * Shipping a default feed/repo would leak install IP, version and launch timing
 * to a third party — and could serve their binary as an "update" to our app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf-8');

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no upstream-vendor update endpoint', () => {
  it('ships no vendor CDN or release repo in the update code paths', () => {
    for (const file of [
      'packages/desktop/src/process/services/updateFeed.ts',
      'packages/desktop/src/process/bridge/updateBridge.ts',
    ]) {
      const code = stripComments(read(file));
      expect(code, `${file} must not reference the vendor CDN`).not.toMatch(/static\.aionui\.com/);
      expect(code, `${file} must not default to the vendor repo`).not.toMatch(/iOfficeAI\/AionUi/);
    }
  });

  it('defaults to the Pavii GitHub repo, with a CDN override only via env', () => {
    const feed = stripComments(read('packages/desktop/src/process/services/updateFeed.ts'));
    // Updates resolve to our own GitHub releases; any CDN feed is env-supplied,
    // so no third-party URL is ever compiled in.
    expect(feed).toMatch(/GITHUB_RELEASE_OWNER = 'buckleson'/);
    expect(feed).toMatch(/GITHUB_RELEASE_REPO = 'Pavii-GUI'/);
    expect(feed).toMatch(/PAVII_UPDATE_FEED_URL/);
    expect(feed).not.toMatch(/https:\/\/[a-z]/);
  });

  it('the release repo matches electron-builder publish config', () => {
    const yml = read('packages/desktop/electron-builder.yml');
    expect(yml).toMatch(/owner: buckleson/);
    expect(yml).toMatch(/repo: Pavii-GUI/);
  });
});
