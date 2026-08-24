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
  getBundledOpencodeDir,
  getManagedToolsDir,
  getManagedToolsPathEntries,
  registerManagedToolsOnPath,
  registerOpencodeOnPath,
} from '@/process/startup/ensureOpencode';

/**
 * Absolute fixture path that survives PATH splitting on every platform.
 *
 * A Windows drive letter contains `:`, which is the PATH delimiter on
 * linux/darwin — so `D:/pavii-data` splits into `D` and `/pavii-data` there,
 * and any assertion that round-trips through `split(delimiter)` fails. The
 * drive-letter form is only safe on win32.
 */
const absFixture = (...segments: string[]): string =>
  process.platform === 'win32' ? join('D:', ...segments) : join('/', ...segments);

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
  const dataDir = absFixture('pavii-data');
  // The function reads process.platform internally; derive the expected entry
  // the same way so the test holds on every platform.
  const [expectedEntry] = getManagedToolsPathEntries(dataDir);

  it('prepends the missing entry to an existing PATH', () => {
    const original = absFixture('somewhere', 'bin');
    const env: NodeJS.ProcessEnv = { PATH: original };
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe([expectedEntry, original].join(delimiter));
  });

  it('is idempotent — a second call adds no duplicate entries', () => {
    const env: NodeJS.ProcessEnv = { PATH: absFixture('somewhere', 'bin') };
    registerManagedToolsOnPath(dataDir, env);
    const afterFirst = env.PATH;
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe(afterFirst);
    const occurrences = (env.PATH ?? '').split(delimiter).filter((part) => part === expectedEntry);
    expect(occurrences).toHaveLength(1);
  });

  it('leaves PATH untouched when the entry is already present mid-list', () => {
    const path = [absFixture('first'), expectedEntry, absFixture('last')].join(delimiter);
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

/**
 * The bundled OpenCode binary is the primary mechanism: the engine resolves
 * agents only through PATH, and it snapshots PATH at spawn. If this directory
 * is not registered before the engine starts, a fresh install defaults to an
 * agent that cannot run for the whole first session — which is the bug the
 * bundle exists to fix.
 */
describe('bundled opencode', () => {
  const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const runtimeKey = `${process.platform}-${process.arch}`;
  let resourcesRoot: string;

  const stageBundle = (key = runtimeKey) => {
    const dir = join(resourcesRoot, 'bundled-opencode', key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, binaryName), '');
    return dir;
  };

  beforeEach(() => {
    resourcesRoot = mkdtempSync(join(tmpdir(), 'pavii-bundled-opencode-'));
  });
  afterEach(() => {
    rmSync(resourcesRoot, { recursive: true, force: true });
  });

  it('finds the bundled directory when the binary is present', () => {
    const dir = stageBundle();
    expect(getBundledOpencodeDir(resourcesRoot, runtimeKey)).toBe(dir);
  });

  it('returns null when the directory exists but holds no binary', () => {
    mkdirSync(join(resourcesRoot, 'bundled-opencode', runtimeKey), { recursive: true });
    expect(getBundledOpencodeDir(resourcesRoot, runtimeKey)).toBeNull();
  });

  it('returns null for an unbundled runtime key or missing resources path', () => {
    stageBundle();
    expect(getBundledOpencodeDir(resourcesRoot, 'other-platform-arch')).toBeNull();
    expect(getBundledOpencodeDir(undefined, runtimeKey)).toBeNull();
  });

  it('adds the bundled directory to PATH', () => {
    const dir = stageBundle();
    const env: NodeJS.ProcessEnv = { PATH: absFixture('existing', 'bin') };
    registerOpencodeOnPath({ dataDir: absFixture('pavii-data'), resourcesPath: resourcesRoot, env });
    expect((env.PATH ?? '').split(delimiter)).toContain(dir);
  });

  it("appends it, so a user's own opencode earlier on PATH still wins", () => {
    const dir = stageBundle();
    const userDir = absFixture('user', 'npm-global');
    const env: NodeJS.ProcessEnv = { PATH: userDir };
    registerOpencodeOnPath({ dataDir: absFixture('pavii-data'), resourcesPath: resourcesRoot, env });
    const parts = (env.PATH ?? '').split(delimiter);
    expect(parts.indexOf(userDir)).toBeLessThan(parts.indexOf(dir));
  });

  it('is idempotent across repeated registrations', () => {
    const dir = stageBundle();
    const env: NodeJS.ProcessEnv = { PATH: absFixture('existing', 'bin') };
    const opts = { dataDir: absFixture('pavii-data'), resourcesPath: resourcesRoot, env };
    registerOpencodeOnPath(opts);
    registerOpencodeOnPath(opts);
    const occurrences = (env.PATH ?? '').split(delimiter).filter((part) => part === dir);
    expect(occurrences).toHaveLength(1);
  });

  it('falls back to the dev resources root when the packaged path has no bundle', () => {
    const dir = stageBundle();
    const env: NodeJS.ProcessEnv = { PATH: absFixture('existing', 'bin') };
    registerOpencodeOnPath({
      dataDir: absFixture('pavii-data'),
      resourcesPath: join(resourcesRoot, 'does-not-exist'),
      devResourcesFallback: resourcesRoot,
      env,
    });
    expect((env.PATH ?? '').split(delimiter)).toContain(dir);
  });

  it('still registers the managed tools dir when no bundle exists', () => {
    const dataDir = absFixture('pavii-data');
    const env: NodeJS.ProcessEnv = { PATH: absFixture('existing', 'bin') };
    registerOpencodeOnPath({ dataDir, resourcesPath: resourcesRoot, env });
    const [managedEntry] = getManagedToolsPathEntries(dataDir);
    expect((env.PATH ?? '').split(delimiter)).toContain(managedEntry);
  });
});
