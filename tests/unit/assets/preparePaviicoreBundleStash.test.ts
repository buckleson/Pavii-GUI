/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * electron-builder ships the whole `resources/bundled-paviicore` directory, so
 * a bundle left over from a build for another target rides along inside the
 * installer — the engine bundle is close to a gigabyte, and none of it can run
 * on the machine that receives it.
 *
 * Parking rather than deleting is the point of these tests: an engine with a
 * `local-source-build` manifest was compiled from the vendored AionCore source
 * and carries the Pavii rebrand. It cannot be re-downloaded, only rebuilt.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const preparePaviicore = require('../../../packages/shared-scripts/src/prepare-paviicore.js') as {
  restoreCachedPaviicoreBundle: (projectRoot: string, runtimeKey: string) => boolean;
  stashOtherPaviicoreBundles: (projectRoot: string, keepRuntimeKey: string) => string[];
};

const { restoreCachedPaviicoreBundle, stashOtherPaviicoreBundles } = preparePaviicore;

describe('paviicore bundle stash/restore', () => {
  let projectRoot: string;

  const bundleDir = (runtimeKey: string) => join(projectRoot, 'resources', 'bundled-paviicore', runtimeKey);
  const cacheDir = (runtimeKey: string) => join(projectRoot, 'resources', '.paviicore-cache', runtimeKey);

  /** Stage a bundle whose marker file proves the exact directory survived a move. */
  const stage = (dir: string, marker: string) => {
    mkdirSync(join(dir, 'managed-resources'), { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ sourceType: marker }));
    writeFileSync(join(dir, 'managed-resources', 'payload.bin'), marker);
    return dir;
  };

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pavii-paviicore-stash-'));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('moves other targets out of the shipped tree instead of deleting them', () => {
    stage(bundleDir('win32-x64'), 'local-source-build');
    stage(bundleDir('win32-arm64'), 'github-release');

    expect(stashOtherPaviicoreBundles(projectRoot, 'win32-arm64')).toEqual(['win32-x64']);

    expect(existsSync(bundleDir('win32-x64'))).toBe(false);
    expect(existsSync(bundleDir('win32-arm64'))).toBe(true);
    // The locally built engine is not reproducible by download — it must survive.
    expect(readFileSync(join(cacheDir('win32-x64'), 'managed-resources', 'payload.bin'), 'utf8')).toBe(
      'local-source-build'
    );
  });

  it('leaves the target being built untouched', () => {
    stage(bundleDir('linux-x64'), 'github-release');
    expect(stashOtherPaviicoreBundles(projectRoot, 'linux-x64')).toEqual([]);
    expect(existsSync(bundleDir('linux-x64'))).toBe(true);
    expect(existsSync(cacheDir('linux-x64'))).toBe(false);
  });

  it('round-trips a bundle through park and restore without losing contents', () => {
    stage(bundleDir('darwin-arm64'), 'local-source-build');
    stage(bundleDir('win32-x64'), 'github-release');

    stashOtherPaviicoreBundles(projectRoot, 'win32-x64');
    expect(existsSync(bundleDir('darwin-arm64'))).toBe(false);

    expect(restoreCachedPaviicoreBundle(projectRoot, 'darwin-arm64')).toBe(true);
    expect(readFileSync(join(bundleDir('darwin-arm64'), 'managed-resources', 'payload.bin'), 'utf8')).toBe(
      'local-source-build'
    );
    expect(existsSync(cacheDir('darwin-arm64'))).toBe(false);
  });

  it('never overwrites a bundle already present in the shipped tree', () => {
    // A freshly prepared bundle outranks a stale parked one; restoring over it
    // would resurrect an older engine.
    stage(cacheDir('win32-x64'), 'stale');
    stage(bundleDir('win32-x64'), 'current');

    expect(restoreCachedPaviicoreBundle(projectRoot, 'win32-x64')).toBe(false);
    expect(readFileSync(join(bundleDir('win32-x64'), 'managed-resources', 'payload.bin'), 'utf8')).toBe('current');
  });

  it('replaces an older parked copy when parking the same target again', () => {
    stage(cacheDir('linux-arm64'), 'older');
    stage(bundleDir('linux-arm64'), 'newer');

    stashOtherPaviicoreBundles(projectRoot, 'win32-x64');

    expect(readFileSync(join(cacheDir('linux-arm64'), 'managed-resources', 'payload.bin'), 'utf8')).toBe('newer');
  });

  it('is a no-op on a project that has never staged a bundle', () => {
    expect(stashOtherPaviicoreBundles(projectRoot, 'win32-x64')).toEqual([]);
    expect(restoreCachedPaviicoreBundle(projectRoot, 'win32-x64')).toBe(false);
  });
});
