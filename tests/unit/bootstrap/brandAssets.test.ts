/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');

const BRAND_ASSETS = [
  'resources/app.png',
  'resources/app.ico',
  'resources/app.icns',
  'public/pwa/icon-180.png',
  'public/pwa/icon-192.png',
  'public/pwa/icon-512.png',
  'packages/desktop/src/renderer/assets/logos/brand/app.png',
  'mobile/assets/images/icon.png',
] as const;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readAsset(relativePath: string): Buffer {
  return readFileSync(resolve(repoRoot, relativePath));
}

describe('Pavii.Ai brand assets', () => {
  it.each(BRAND_ASSETS.map((asset) => [asset]))('%s exists and is non-empty', (asset) => {
    const stats = statSync(resolve(repoRoot, asset));
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);
  });

  it.each(BRAND_ASSETS.filter((asset) => asset.endsWith('.png')).map((asset) => [asset]))(
    '%s starts with the PNG magic bytes',
    (asset) => {
      const bytes = readAsset(asset);
      expect(bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)).toBe(true);
    }
  );

  it('resources/app.png declares a 512x512 IHDR', () => {
    const bytes = readAsset('resources/app.png');
    // The IHDR chunk immediately follows the 8-byte signature: 4-byte length,
    // 4-byte "IHDR" type, then 4-byte big-endian width and height.
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(bytes.readUInt32BE(16)).toBe(512);
    expect(bytes.readUInt32BE(20)).toBe(512);
  });

  it('resources/app.ico starts with the ICO magic bytes', () => {
    const bytes = readAsset('resources/app.ico');
    expect(bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))).toBe(true);
  });

  it('resources/app.icns starts with the icns magic bytes', () => {
    const bytes = readAsset('resources/app.icns');
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('icns');
  });
});
