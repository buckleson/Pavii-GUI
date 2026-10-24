/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ensure-opencode — startup helpers that expose the app-managed tools dir on
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
} from './ensure-opencode.js';

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
  const uvBinEntry = join(getManagedToolsDir(dataDir), 'uv-bin');

  it('prepends the missing entries (npm tools, then uv-bin) to an existing PATH', () => {
    const original = absFixture('somewhere', 'bin');
    const env: NodeJS.ProcessEnv = { PATH: original };
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe([expectedEntry, uvBinEntry, original].join(delimiter));
  });

  it('is idempotent — a second call adds no duplicate entries', () => {
    const env: NodeJS.ProcessEnv = { PATH: absFixture('somewhere', 'bin') };
    registerManagedToolsOnPath(dataDir, env);
    const afterFirst = env.PATH;
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe(afterFirst);
  });

  it('adds uv-bin only once across repeated calls', () => {
    const env: NodeJS.ProcessEnv = { PATH: absFixture('somewhere', 'bin') };
    registerManagedToolsOnPath(dataDir, env);
    registerManagedToolsOnPath(dataDir, env);
    const occurrences = (env.PATH ?? '').split(delimiter).filter((part) => part === uvBinEntry);
    expect(occurrences).toHaveLength(1);
  });

  it('leaves PATH untouched when every entry is already present mid-list', () => {
    const path = [absFixture('first'), expectedEntry, uvBinEntry, absFixture('last')].join(delimiter);
    const env: NodeJS.ProcessEnv = { PATH: path };
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe(path);
  });

  it('adds only uv-bin when the npm tools entry is already present', () => {
    const path = [absFixture('first'), expectedEntry].join(delimiter);
    const env: NodeJS.ProcessEnv = { PATH: path };
    registerManagedToolsOnPath(dataDir, env);
    expect(env.PATH).toBe([uvBinEntry, path].join(delimiter));
  });

  it('handles an undefined PATH by creating one that starts with the entries', () => {
    const env: NodeJS.ProcessEnv = {};
    registerManagedToolsOnPath(dataDir, env);
    expect((env.PATH ?? '').split(delimiter).slice(0, 2)).toEqual([expectedEntry, uvBinEntry]);
  });

  it('changes only the env passed in, never process.env', () => {
    const before = process.env.PATH;
    registerManagedToolsOnPath(dataDir, { PATH: absFixture('somewhere', 'bin') });
    expect(process.env.PATH).toBe(before);
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

/**
 * PATH is the whole contract with the engine, and the environment we are handed
 * is not always the tidy one from an interactive shell: a service launcher, a CI
 * runner, or a `pavii-web` process started from a stripped env can hand us an
 * empty, absent, or malformed PATH. Corrupting it here disables not just
 * OpenCode but every tool the engine shells out to.
 */
describe('registerOpencodeOnPath against malformed environments', () => {
  const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const runtimeKey = `${process.platform}-${process.arch}`;
  const dataDir = absFixture('pavii-data');
  let resourcesRoot: string;

  const stageBundle = () => {
    const dir = join(resourcesRoot, 'bundled-opencode', runtimeKey);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, binaryName), '');
    return dir;
  };

  const emptyEntries = (value: string) => value.split(delimiter).filter((part) => part === '').length;

  beforeEach(() => {
    resourcesRoot = mkdtempSync(join(tmpdir(), 'pavii-opencode-path-'));
  });
  afterEach(() => {
    rmSync(resourcesRoot, { recursive: true, force: true });
  });

  it('registers the bundle when PATH is an empty string', () => {
    const dir = stageBundle();
    const env: NodeJS.ProcessEnv = { PATH: '' };
    registerOpencodeOnPath({ dataDir, resourcesPath: resourcesRoot, env });
    expect((env.PATH ?? '').split(delimiter)).toContain(dir);
  });

  it('adds no empty PATH entry when PATH is an empty string', () => {
    // An empty PATH element means "the current directory" on POSIX, so a stray
    // `opencode` in whatever directory the app was launched from would be
    // picked up ahead of the bundled one.
    stageBundle();
    const env: NodeJS.ProcessEnv = { PATH: '' };
    registerOpencodeOnPath({ dataDir, resourcesPath: resourcesRoot, env });
    expect(emptyEntries(env.PATH ?? '')).toBeLessThanOrEqual(emptyEntries(''));
  });

  it('adds no empty PATH entry when PATH already ends with a delimiter', () => {
    // Same current-directory risk, reached by the far more common route of a
    // PATH assembled by string concatenation somewhere upstream.
    stageBundle();
    const original = `${absFixture('existing', 'bin')}${delimiter}`;
    const env: NodeJS.ProcessEnv = { PATH: original };
    registerOpencodeOnPath({ dataDir, resourcesPath: resourcesRoot, env });
    expect(emptyEntries(env.PATH ?? '')).toBeLessThanOrEqual(emptyEntries(original));
  });

  it('does not grow a PATH that already lists the bundle twice', () => {
    // Registration runs on every launch and, in dev, on every reload. Appending
    // regardless of what is already there makes PATH grow until the OS length
    // limit truncates it and unrelated tools stop resolving.
    const dir = stageBundle();
    const env: NodeJS.ProcessEnv = { PATH: [dir, absFixture('existing', 'bin'), dir].join(delimiter) };
    registerOpencodeOnPath({ dataDir, resourcesPath: resourcesRoot, env });
    expect((env.PATH ?? '').split(delimiter).filter((part) => part === dir)).toHaveLength(2);
  });

  it('still registers the managed tools dir with neither a packaged nor a dev resources path', () => {
    // web-host also runs outside Electron, where `process.resourcesPath` is
    // undefined; the npm-installed fallback is then the only OpenCode there is.
    const env: NodeJS.ProcessEnv = { PATH: absFixture('existing', 'bin') };
    registerOpencodeOnPath({ dataDir, env });
    const [managedEntry] = getManagedToolsPathEntries(dataDir);
    expect((env.PATH ?? '').split(delimiter)).toContain(managedEntry);
  });

  it('keeps the managed tools dir ahead of the user PATH and the bundle behind it', () => {
    // The two directories have opposite priorities and one call sets both: an
    // app-managed install must beat a stale system copy, while the user's own
    // build must still beat the bundled one. A refactor that treats them alike
    // silently changes which OpenCode every user runs.
    const dir = stageBundle();
    const userDir = absFixture('user', 'npm-global');
    const env: NodeJS.ProcessEnv = { PATH: userDir };
    registerOpencodeOnPath({ dataDir, resourcesPath: resourcesRoot, env });
    const parts = (env.PATH ?? '').split(delimiter);
    const [managedEntry] = getManagedToolsPathEntries(dataDir);
    expect(parts.indexOf(managedEntry)).toBeLessThan(parts.indexOf(userDir));
    expect(parts.indexOf(userDir)).toBeLessThan(parts.indexOf(dir));
  });
});

/**
 * `dataDir` arrives from user configuration and from installer defaults, so it
 * can be blank long before anyone notices. What must never happen is a blank
 * value turning into an empty PATH entry.
 */
describe('getManagedToolsPathEntries with a blank data dir', () => {
  it('never yields an empty PATH entry for an empty data dir', () => {
    // An empty entry is the current directory on POSIX — a working directory
    // holding an `opencode` binary would hijack the default agent.
    for (const entry of getManagedToolsPathEntries('')) {
      expect(entry).not.toBe('');
    }
  });

  it('never yields a blank PATH entry for a whitespace-only data dir', () => {
    for (const entry of getManagedToolsPathEntries('   ')) {
      expect(entry.trim()).not.toBe('');
    }
  });
});

/**
 * A bundle directory is only worth putting on PATH if the binary is really in
 * it. Reporting one that is not means the app believes OpenCode shipped and
 * never falls back to the npm install — the symptom is a default agent that
 * does not exist, with nothing in the logs.
 */
describe('getBundledOpencodeDir on a partially staged bundle', () => {
  const runtimeKey = `${process.platform}-${process.arch}`;
  let resourcesRoot: string;
  let bundleDir: string;

  beforeEach(() => {
    resourcesRoot = mkdtempSync(join(tmpdir(), 'pavii-opencode-partial-'));
    bundleDir = join(resourcesRoot, 'bundled-opencode', runtimeKey);
    mkdirSync(bundleDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(resourcesRoot, { recursive: true, force: true });
  });

  it('returns null when only the manifest was written', () => {
    // prepare-opencode writes the manifest after copying the binary, so a build
    // interrupted mid-copy — or an installer that dropped the one large file —
    // leaves exactly this shape on disk.
    writeFileSync(join(bundleDir, 'manifest.json'), '{}');
    expect(getBundledOpencodeDir(resourcesRoot, runtimeKey)).toBeNull();
  });

  it('returns null for an empty-string resources path', () => {
    // `process.resourcesPath` is typed as a string and reads empty rather than
    // undefined outside a packaged app; treating it as a root would search for
    // the bundle relative to the working directory.
    expect(getBundledOpencodeDir('', runtimeKey)).toBeNull();
  });

  it('returns null for a whitespace-only resources path', () => {
    expect(getBundledOpencodeDir('   ', runtimeKey)).toBeNull();
  });
});

/**
 * A directory named `opencode.exe` satisfies `existsSync`. Before this was
 * hardened the app would advertise a bundled agent, append a directory holding
 * no executable to PATH, and suppress the npm fallback that would otherwise
 * have recovered — a default agent that cannot run, with nothing logged.
 *
 * Contrived to reach by hand, but it is the same `existsSync`-means-usable
 * assumption that has to hold for every partially written bundle.
 */
describe('getBundledOpencodeDir rejects a non-file binary', () => {
  const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  const runtimeKey = `${process.platform}-${process.arch}`;
  let resourcesRoot: string;

  beforeEach(() => {
    resourcesRoot = mkdtempSync(join(tmpdir(), 'pavii-opencode-nonfile-'));
  });
  afterEach(() => {
    rmSync(resourcesRoot, { recursive: true, force: true });
  });

  it('returns null when the binary path is a directory', () => {
    mkdirSync(join(resourcesRoot, 'bundled-opencode', runtimeKey, binaryName), { recursive: true });
    expect(getBundledOpencodeDir(resourcesRoot, runtimeKey)).toBeNull();
  });

  it('still returns the directory for a real binary file', () => {
    // The inverse, so the hardening cannot be "fixed" by rejecting everything.
    const dir = join(resourcesRoot, 'bundled-opencode', runtimeKey);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, binaryName), '');
    expect(getBundledOpencodeDir(resourcesRoot, runtimeKey)).toBe(dir);
  });
});
