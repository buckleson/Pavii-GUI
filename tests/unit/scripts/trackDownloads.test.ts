/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { classifyAsset } from '../../../scripts/track-downloads.mjs';

describe('classifyAsset', () => {
  it('classifies the electron-builder artifact names we publish', () => {
    expect(classifyAsset('Pavii.Ai-2.1.52-win-x64.exe')).toEqual({
      platform: 'windows',
      arch: 'x64',
      packageType: 'exe',
    });
    expect(classifyAsset('Pavii.Ai-2.1.52-mac-arm64.dmg')).toEqual({
      platform: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
    });
    expect(classifyAsset('Pavii.Ai-2.1.52-linux-arm64.AppImage')).toEqual({
      platform: 'linux',
      arch: 'arm64',
      packageType: 'appimage',
    });
    expect(classifyAsset('Pavii.Ai-2.1.52-linux-x64.deb')).toEqual({
      platform: 'linux',
      arch: 'x64',
      packageType: 'deb',
    });
  });

  it('classifies the stable-named aliases used by the website', () => {
    expect(classifyAsset('Pavii.Ai-Windows-arm64-Setup.exe')).toEqual({
      platform: 'windows',
      arch: 'arm64',
      packageType: 'exe',
    });
    expect(classifyAsset('Pavii.Ai-macOS-x64.dmg')).toEqual({ platform: 'macos', arch: 'x64', packageType: 'dmg' });
  });

  it('degrades gracefully for unknown files', () => {
    expect(classifyAsset('SHA256SUMS')).toEqual({ platform: 'unknown', arch: 'unknown', packageType: 'other' });
  });
});
