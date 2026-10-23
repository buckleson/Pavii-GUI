/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the open-source CLI installer: which catalog entries can be
 * installed, how a runnable npm is located (managed runtime first, then the
 * bundled runtime, skipping launchers without npm's package), the exact npm command (and its
 * Windows quoting), and how failures and timeouts are reported.
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (error: { code?: number; killed?: boolean } | null, stdout: string, stderr: string) => void;
type ExecReply = { code?: number; stdout?: string; stderr?: string; killed?: boolean };

const { execFileMock, mkdirSyncMock, existsSyncMock, readdirSyncMock, findBundledNpmMock, getDataPathMock, appState } =
  vi.hoisted(() => ({
    getDataPathMock: vi.fn(),
    execFileMock: vi.fn(),
    mkdirSyncMock: vi.fn(),
    existsSyncMock: vi.fn(),
    readdirSyncMock: vi.fn(),
    findBundledNpmMock: vi.fn(),
    appState: { isPackaged: false },
  }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, default: { ...actual, execFile: execFileMock }, execFile: execFileMock };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const overrides = { mkdirSync: mkdirSyncMock, existsSync: existsSyncMock, readdirSync: readdirSyncMock };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
  },
}));

vi.mock('@pavii/web-host', () => ({
  findBundledNpm: findBundledNpmMock,
  getManagedToolsDir: (dataDir: string) => path.join(dataDir, 'managed-tools'),
  getManagedToolsPathEntries: (dataDir: string) => [path.join(dataDir, 'managed-tools', 'bin')],
}));

let dataDir = path.resolve('/data/pavii');
vi.mock('@process/utils/utils', () => ({ getDataPath: getDataPathMock }));

import { findManagedNpm, getManagedBinDirs, getToolsDir, hasNpmCli, installCli } from '@process/agentCli/installCli';

/** npm's package beside a Windows `npm.cmd` living in `dir`. */
const winNpmCli = (dir: string) => path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
/** npm's package of a POSIX install whose launcher is `<prefix>/bin/npm`. */
const posixNpmCli = (prefix: string) => path.join(prefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

const BUNDLED_PREFIX = path.resolve('/resources/node');
const BUNDLED_NPM = path.join(BUNDLED_PREFIX, 'bin', 'npm');
const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

let execReply: ExecReply = { code: 0 };
/** Files that exist for fs.existsSync. */
let existingFiles = new Set<string>();
/** Entries of `<data>/runtime/node`; `null` means the directory is absent (readdirSync throws). */
let runtimeEntries: string[] | null = null;

const runtimeRoot = () => path.join(dataDir, 'runtime', 'node');

const execCall = () => {
  const [file, args, options] = execFileMock.mock.calls[0];
  return { file: file as string, args: args as string[], options: options as Record<string, unknown> };
};

beforeEach(() => {
  vi.clearAllMocks();
  setPlatform('linux');
  appState.isPackaged = false;
  dataDir = path.resolve('/data/pavii');
  Object.defineProperty(process, 'resourcesPath', { value: path.resolve('/resources'), configurable: true });
  execReply = { code: 0, stdout: 'added 1 package' };
  findBundledNpmMock.mockReturnValue(BUNDLED_NPM);
  getDataPathMock.mockImplementation(() => dataDir);
  existingFiles = new Set([BUNDLED_NPM, posixNpmCli(BUNDLED_PREFIX)]);
  runtimeEntries = null;
  existsSyncMock.mockImplementation((candidate: string) => existingFiles.has(candidate));
  readdirSyncMock.mockImplementation((dir: string) => {
    if (runtimeEntries === null || dir !== runtimeRoot()) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return runtimeEntries;
  });
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: ExecCallback) => {
    const code = execReply.code ?? 0;
    const error = code !== 0 || execReply.killed ? { code, killed: execReply.killed } : null;
    callback(error, execReply.stdout ?? '', execReply.stderr ?? '');
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setPlatform(originalPlatform);
  Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true });
  vi.restoreAllMocks();
});

describe('managed-tools paths', () => {
  it('places the tools dir under the data dir', () => {
    expect(getToolsDir()).toBe(path.join(dataDir, 'managed-tools'));
  });

  it('exposes the launcher bin dirs of the managed-tools folder', () => {
    expect(getManagedBinDirs()).toEqual([path.join(dataDir, 'managed-tools', 'bin')]);
  });

  it('propagates a data dir failure to the caller', () => {
    getDataPathMock.mockImplementation(() => {
      throw new Error('no data dir');
    });

    expect(() => getToolsDir()).toThrow('no data dir');
  });
});

describe('findManagedNpm', () => {
  it('prefers the npm bundled in the app resources', () => {
    expect(findManagedNpm()).toBe(BUNDLED_NPM);
    expect(findBundledNpmMock).toHaveBeenCalledWith(process.resourcesPath, `${process.platform}-${process.arch}`);
  });

  it('falls back to the repo resources dir in dev', () => {
    findBundledNpmMock.mockImplementation((dir: string) =>
      dir === path.join(process.cwd(), 'resources') ? BUNDLED_NPM : null
    );

    expect(findManagedNpm()).toBe(BUNDLED_NPM);
  });

  it('falls through to the bundled npm when the managed runtime dir is absent', () => {
    runtimeEntries = null;

    expect(findManagedNpm()).toBe(BUNDLED_NPM);
    expect(readdirSyncMock).toHaveBeenCalledWith(runtimeRoot());
  });

  it('prefers a valid npm in the managed Node runtime over the bundled npm', () => {
    const prefix = path.join(runtimeRoot(), 'node-v22.3.0');
    const runtimeNpm = path.join(prefix, 'bin', 'npm');
    runtimeEntries = ['node-v22.3.0'];
    existingFiles.add(runtimeNpm).add(posixNpmCli(prefix));

    expect(findManagedNpm()).toBe(runtimeNpm);
    expect(findBundledNpmMock).not.toHaveBeenCalled();
  });

  it('picks the newest-named runtime dir first and ignores non node-v entries', () => {
    runtimeEntries = ['node-v20.1.0', 'node-v22.3.0', 'z-cache'];
    for (const entry of runtimeEntries) {
      const prefix = path.join(runtimeRoot(), entry);
      existingFiles.add(path.join(prefix, 'bin', 'npm')).add(posixNpmCli(prefix));
    }

    expect(findManagedNpm()).toBe(path.join(runtimeRoot(), 'node-v22.3.0', 'bin', 'npm'));
  });

  it('uses npm.cmd from the managed runtime dir on Windows', () => {
    setPlatform('win32');
    const prefix = path.join(runtimeRoot(), 'node-v22.3.0-win-x64');
    const runtimeNpm = path.join(prefix, 'npm.cmd');
    runtimeEntries = ['node-v22.3.0-win-x64'];
    existingFiles.add(runtimeNpm).add(winNpmCli(prefix));

    expect(findManagedNpm()).toBe(runtimeNpm);
  });

  it('skips a runtime dir whose npm has no npm-cli.js and uses an older valid one', () => {
    const older = path.join(runtimeRoot(), 'node-v20.1.0');
    const newer = path.join(runtimeRoot(), 'node-v22.3.0');
    runtimeEntries = ['node-v20.1.0', 'node-v22.3.0'];
    existingFiles.add(path.join(newer, 'bin', 'npm'));
    existingFiles.add(path.join(older, 'bin', 'npm')).add(posixNpmCli(older));

    expect(findManagedNpm()).toBe(path.join(older, 'bin', 'npm'));
  });

  it('falls through to the bundled npm when no runtime dir has a complete npm', () => {
    const prefix = path.join(runtimeRoot(), 'node-v22.3.0');
    runtimeEntries = ['node-v22.3.0', 'node-v21.0.0'];
    existingFiles.add(path.join(prefix, 'bin', 'npm')); // launcher only, no npm-cli.js
    existingFiles.add(posixNpmCli(path.join(runtimeRoot(), 'node-v21.0.0'))); // npm-cli.js only, no launcher

    expect(findManagedNpm()).toBe(BUNDLED_NPM);
  });

  it('skips a bundled launcher without npm-cli.js and uses the dev fallback that has it', () => {
    const resourcesNpm = path.resolve('/packaged/node/bin/npm');
    const devPrefix = path.join(process.cwd(), 'resources', 'node');
    const devNpm = path.join(devPrefix, 'bin', 'npm');
    findBundledNpmMock.mockImplementation((dir: string) => {
      if (dir === process.resourcesPath) return resourcesNpm;
      return dir === path.join(process.cwd(), 'resources') ? devNpm : null;
    });
    existingFiles = new Set([resourcesNpm, devNpm, posixNpmCli(devPrefix)]);

    expect(findManagedNpm()).toBe(devNpm);
    expect(findBundledNpmMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when every launcher found lacks npm-cli.js', () => {
    existingFiles = new Set([BUNDLED_NPM]);

    expect(findManagedNpm()).toBeNull();
  });

  it('returns null in a packaged app without a bundled npm, skipping the dev fallback', () => {
    appState.isPackaged = true;
    findBundledNpmMock.mockReturnValue(null);

    expect(findManagedNpm()).toBeNull();
    expect(findBundledNpmMock).toHaveBeenCalledTimes(1);
  });
});

describe('hasNpmCli', () => {
  const root = path.resolve('/opt/node');

  it('on Windows looks for node_modules/npm beside npm.cmd', () => {
    setPlatform('win32');
    existingFiles = new Set([path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js')]);

    expect(hasNpmCli(path.join(root, 'npm.cmd'))).toBe(true);
    expect(existsSyncMock).toHaveBeenCalledWith(path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  });

  it('on Windows ignores the POSIX lib/ layout', () => {
    setPlatform('win32');
    existingFiles = new Set([path.join(path.dirname(root), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]);

    expect(hasNpmCli(path.join(root, 'npm.cmd'))).toBe(false);
  });

  it('on POSIX looks for lib/node_modules/npm next to the bin dir', () => {
    existingFiles = new Set([path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]);

    expect(hasNpmCli(path.join(root, 'bin', 'npm'))).toBe(true);
    expect(existsSyncMock).toHaveBeenCalledWith(path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  });

  it('on POSIX ignores node_modules beside the launcher', () => {
    existingFiles = new Set([path.join(root, 'bin', 'node_modules', 'npm', 'bin', 'npm-cli.js')]);

    expect(hasNpmCli(path.join(root, 'bin', 'npm'))).toBe(false);
  });

  it('is false when npm-cli.js is missing', () => {
    existingFiles = new Set();

    expect(hasNpmCli(path.join(root, 'bin', 'npm'))).toBe(false);
  });
});

describe('installCli', () => {
  it('rejects a backend that is not an open-source CLI', async () => {
    await expect(installCli('not-a-cli')).resolves.toEqual({ success: false, error: 'unknown-cli' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('refuses npx-launched CLIs without spawning anything', async () => {
    await expect(installCli('pi')).resolves.toEqual({ success: false, error: 'not-installable' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('refuses docs-only CLIs without spawning anything', async () => {
    await expect(installCli('hermes')).resolves.toEqual({ success: false, error: 'not-installable' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('reports npm-missing when neither the resources nor the dev fallback holds npm', async () => {
    findBundledNpmMock.mockReturnValue(null);

    await expect(installCli('opencode')).resolves.toEqual({ success: false, error: 'npm-missing' });
    expect(findBundledNpmMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('reports npm-missing when the only npm found has no npm-cli.js', async () => {
    existingFiles = new Set([BUNDLED_NPM]);

    await expect(installCli('opencode')).resolves.toEqual({ success: false, error: 'npm-missing' });
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('installs with the managed runtime npm when it is available', async () => {
    const prefix = path.join(runtimeRoot(), 'node-v22.3.0');
    const runtimeNpm = path.join(prefix, 'bin', 'npm');
    runtimeEntries = ['node-v22.3.0'];
    existingFiles.add(runtimeNpm).add(posixNpmCli(prefix));

    await expect(installCli('codex')).resolves.toEqual({ success: true });
    expect(execCall().file).toBe(runtimeNpm);
  });

  it('creates the tools dir and runs exactly `npm install -g <pkg> --prefix <toolsDir>`', async () => {
    const toolsDir = path.join(dataDir, 'managed-tools');

    await expect(installCli('codex')).resolves.toEqual({ success: true });
    expect(mkdirSyncMock).toHaveBeenCalledWith(toolsDir, { recursive: true });
    expect(execCall()).toMatchObject({
      file: BUNDLED_NPM,
      args: ['install', '-g', '@openai/codex', '--prefix', toolsDir],
      options: { shell: false, timeout: 5 * 60_000 },
    });
  });

  it('on Windows quotes the npm path and tools dir that contain spaces and uses a shell', async () => {
    setPlatform('win32');
    dataDir = 'C:\\Users\\First Last\\Pavii';
    const npmDir = 'C:\\Program Files\\Pavii\\resources\\node';
    const npm = path.join(npmDir, 'npm.cmd');
    findBundledNpmMock.mockReturnValue(npm);
    existingFiles = new Set([npm, winNpmCli(npmDir)]);

    await installCli('opencode');

    const toolsDir = path.join(dataDir, 'managed-tools');
    expect(execCall()).toMatchObject({
      file: `"${npm}"`,
      args: ['install', '-g', 'opencode-ai', '--prefix', `"${toolsDir}"`],
      options: { shell: true },
    });
  });

  it('on Windows leaves values without spaces unquoted', async () => {
    setPlatform('win32');
    dataDir = 'C:\\Pavii';
    // Built with path.join so path.dirname splits it on every host OS (CI runs Linux).
    const npm = path.join('C:\\npm', 'npm.cmd');
    findBundledNpmMock.mockReturnValue(npm);
    existingFiles = new Set([winNpmCli('C:\\npm')]);

    await installCli('qwen');

    expect(execCall()).toMatchObject({
      file: npm,
      args: ['install', '-g', '@qwen-code/qwen-code', '--prefix', path.join('C:\\Pavii', 'managed-tools')],
    });
  });

  it('reports timeout when npm is killed', async () => {
    execReply = { code: 1, killed: true, stderr: 'still fetching' };

    await expect(installCli('gemini')).resolves.toEqual({
      success: false,
      error: 'timeout',
      output: 'still fetching',
    });
  });

  it('reports command-failed with only the last 20 output lines on a non-zero exit', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `npm ERR! line ${i}`);
    execReply = { code: 1, stdout: lines.slice(0, 10).join('\n'), stderr: lines.slice(10).join('\n') };

    const outcome = await installCli('openclaw');

    expect(outcome).toMatchObject({ success: false, error: 'command-failed' });
    expect(outcome.output?.split('\n')).toEqual(lines.slice(-20));
  });
});
