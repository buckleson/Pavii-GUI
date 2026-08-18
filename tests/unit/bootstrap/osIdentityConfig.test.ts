/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const builderYml = readFileSync(join(repoRoot, 'packages/desktop/electron-builder.yml'), 'utf-8');
const rootPackageJson = readFileSync(join(repoRoot, 'package.json'), 'utf-8');

describe('OS-level identity packaging config', () => {
  it('linux desktop entry associates the window and a valid icon', () => {
    expect(builderYml).toMatch(/StartupWMClass: Pavii\.Ai/);
    expect(builderYml).toMatch(/Icon: PaviiAi/);
    expect(builderYml).toMatch(/- AppImage/);
  });

  it('mac bundle carries an explicit display identity', () => {
    expect(builderYml).toMatch(/CFBundleDisplayName: Pavii\.Ai/);
    expect(builderYml).toMatch(/NSHumanReadableCopyright: Copyright © 2026 Team Pavii/);
  });

  it('fast Windows builds no longer skip exe metadata patching', () => {
    expect(rootPackageJson).not.toContain('signAndEditExecutable=false');
  });

  it('dev icon referenced by the main process exists', () => {
    expect(() => readFileSync(join(repoRoot, 'resources/app_dev.png'))).not.toThrow();
  });
});

describe('prepare-aioncore local-source-build guard', () => {
  it('never replaces a pinned local build: verification failure throws instead of re-downloading', async () => {
    const { prepareAioncore } = await import(resolve(repoRoot, 'packages/shared-scripts/src/prepare-aioncore.js'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'prep-aioncore-'));
    try {
      const dir = join(projectRoot, 'resources', 'bundled-aioncore', 'win32-x64');
      // Deliberately incomplete bundle (fails the managed-resources contract):
      // the guard must FAIL LOUD rather than fall through to the upstream
      // download, which would strip the Pavii rebrand from the engine.
      mkdirSync(join(dir, 'managed-resources'), { recursive: true });
      writeFileSync(join(dir, 'aioncore.exe'), 'stub-binary');
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({ platform: 'win32', arch: 'x64', sourceType: 'local-source-build', version: 'v0.1.69-pavii' })
      );
      expect(() => prepareAioncore({ projectRoot, platform: 'win32', arch: 'x64', version: '0.1.62' })).toThrow();
      // The pinned binary must survive untouched — no download replaced it.
      expect(readFileSync(join(dir, 'aioncore.exe'), 'utf-8')).toBe('stub-binary');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
