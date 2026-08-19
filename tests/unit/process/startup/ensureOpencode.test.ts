/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ensureOpencode — startup helpers that expose the app-managed tools dir on
 * PATH and locate the bundled Node runtime's npm. The actual install flow
 * (ensureOpencodeInstalled) spawns real processes and is intentionally not
 * unit-tested here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  findBundledNpm,
  getManagedToolsDir,
  getManagedToolsPathEntries,
  registerManagedToolsOnPath,
} from '@/process/startup/ensureOpencode';

describe('getManagedToolsDir', () => {
  it("joins the data dir with 'managed-tools'", () => {
    expect(getManagedToolsDir(join('D:', 'data'))).toBe(join('D:', 'data', 'managed-tools'));
  });
});

describe('getManagedToolsPathEntries', () => {
  const dataDir = join('D:', 'data');
  const toolsDir = getManagedToolsDir(dataDir);

  it('returns the tools dir itself on win32 (npm shims live at the prefix root)', () => {
    expect(getManagedToolsPathEntries(dataDir, 'win32')).toEqual([toolsDir]);
  });

  it('returns tools dir/bin on linux and darwin', () => {
    expect(getManagedToolsPathEntries(dataDir, 'linux')).toEqual([join(toolsDir, 'bin')]);
    expect(getManagedToolsPathEntries(dataDir, 'darwin')).toEqual([join(toolsDir, 'bin')]);
  });
});

describe('registerManagedToolsOnPath', () => {
  const dataDir = join('D:', 'pavii-data');
  // The function reads process.platform internally; derive the expected entry
  // the same way so the test holds on every platform.
  const [expectedEntry] = getManagedToolsPathEntries(dataDir);

  it('prepends the missing entry to an existing PATH', () => {
    const original = join('C:', 'somewhere', 'bin');
    const env: NodeJS.ProcessEnv = { PATH: original };
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe([expectedEntry, original].join(delimiter));
  });

  it('is idempotent — a second call adds no duplicate entries', () => {
    const env: NodeJS.ProcessEnv = { PATH: join('C:', 'somewhere', 'bin') };
    registerManagedToolsOnPath(dataDir, env);
    const afterFirst = env.PATH;
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe(afterFirst);
    const occurrences = (env.PATH ?? '').split(delimiter).filter((part) => part === expectedEntry);
    expect(occurrences).toHaveLength(1);
  });

  it('leaves PATH untouched when the entry is already present mid-list', () => {
    const path = [join('C:', 'first'), expectedEntry, join('C:', 'last')].join(delimiter);
    const env: NodeJS.ProcessEnv = { PATH: path };
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe(path);
  });

  it('handles an undefined PATH by creating one that starts with the entry', () => {
    const env: NodeJS.ProcessEnv = {};
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBeDefined();
    expect((env.PATH ?? '').split(delimiter)[0]).toBe(expectedEntry);
  });
});

describe('findBundledNpm', () => {
  const runtimeKey = `${process.platform}-${process.arch}`;
  // npm launcher name depends on the real process.platform at call time.
  const npmSegments = process.platform === 'win32' ? ['npm.cmd'] : ['bin', 'npm'];
  let resourcesRoot: string;

  beforeEach(() => {
    resourcesRoot = mkdtempSync(join(tmpdir(), 'aionui-ensure-opencode-'));
  });

  afterEach(() => {
    rmSync(resourcesRoot, { recursive: true, force: true });
  });

  const nodeBaseDir = () => join(resourcesRoot, 'bundled-paviicore', runtimeKey, 'managed-resources', 'node');

  it('returns null when resourcesPath is undefined', () => {
    expect(findBundledNpm(undefined, runtimeKey)).toBeNull();
  });

  it('returns null when the node base directory does not exist', () => {
    expect(findBundledNpm(resourcesRoot, runtimeKey)).toBeNull();
  });

  it('returns null when the node base exists but holds no version with npm', () => {
    mkdirSync(join(nodeBaseDir(), 'v22.11.0'), { recursive: true });
    expect(findBundledNpm(resourcesRoot, runtimeKey)).toBeNull();
  });

  it('finds npm inside the first version directory that contains it', () => {
    const versionDir = join(nodeBaseDir(), 'v22.11.0');
    const npmPath = join(versionDir, ...npmSegments);
    mkdirSync(join(versionDir, ...npmSegments.slice(0, -1)), { recursive: true });
    writeFileSync(npmPath, '');
    expect(findBundledNpm(resourcesRoot, runtimeKey)).toBe(npmPath);
  });

  it('returns null for a runtime key with no bundled runtime', () => {
    const versionDir = join(nodeBaseDir(), 'v22.11.0');
    mkdirSync(join(versionDir, ...npmSegments.slice(0, -1)), { recursive: true });
    writeFileSync(join(versionDir, ...npmSegments), '');
    expect(findBundledNpm(resourcesRoot, 'other-platform-arch')).toBeNull();
  });
});
