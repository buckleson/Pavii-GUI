/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the agent CLI update service: version parsing, PATH lookup,
 * registry lookup, the 48h throttles, and how an update is planned and run
 * (managed-tools npm vs npm global install vs the CLI's own updater vs manual
 * instructions).
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (error: { code?: number; killed?: boolean } | null, stdout: string, stderr: string) => void;
type ExecReply = { code?: number; stdout?: string; stderr?: string; killed?: boolean };
type ExecHandler = (file: string, args: string[]) => ExecReply | Promise<ExecReply>;

const {
  execFileMock,
  statSyncMock,
  existsSyncMock,
  readdirSyncMock,
  fetchMock,
  configStore,
  emitMock,
  findBundledNpmMock,
  getDataPathMock,
} = vi.hoisted(() => ({
  findBundledNpmMock: vi.fn(),
  getDataPathMock: vi.fn(),
  execFileMock: vi.fn(),
  statSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  fetchMock: vi.fn(),
  configStore: new Map<string, unknown>(),
  emitMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, default: { ...actual, execFile: execFileMock }, execFile: execFileMock };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const overrides = { statSync: statSyncMock, existsSync: existsSyncMock, readdirSync: readdirSyncMock };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('electron', () => ({ net: { fetch: fetchMock }, app: { isPackaged: true } }));

// Linux layout: npm puts managed-tools launchers in <toolsDir>/bin.
vi.mock('@pavii/web-host', () => ({
  findBundledNpm: findBundledNpmMock,
  getManagedToolsDir: (dataDir: string) => path.join(dataDir, 'managed-tools'),
  getManagedToolsPathEntries: (dataDir: string) => [path.join(dataDir, 'managed-tools', 'bin')],
}));

vi.mock('@process/utils/utils', () => ({ getDataPath: getDataPathMock }));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => configStore.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      configStore.set(key, value);
    }),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: { agentCli: { stateChanged: { emit: emitMock } } },
}));

import {
  CHECK_INTERVAL_MS,
  checkCli,
  checkCliIfStale,
  fetchLatestVersion,
  findBinary,
  isNewer,
  parseVersion,
  readState,
  runAutoCheck,
  runFile,
  updateCli,
} from '@process/agentCli/cliUpdateService';
import type { AgentCliCheckResult, AgentCliUpdateState } from '@/common/types/agent/agentCliUpdate';

const STATE_KEY = 'agentCli.updateState';
const NOW = 1_800_000_000_000;

// Absolute, platform-native directories so path.join / path.resolve behave on any host.
const NPM_PREFIX = path.resolve('/opt/npm-global');
const NPM_BIN = path.join(NPM_PREFIX, 'bin');
const LOCAL_BIN = path.resolve('/home/user/.local/bin');
const DATA_DIR = path.resolve('/data/pavii');
const TOOLS_DIR = path.join(DATA_DIR, 'managed-tools');
const MANAGED_BIN = path.join(TOOLS_DIR, 'bin');
const BUNDLED_NPM = path.resolve('/resources/node/bin/npm');
// POSIX layout: npm's package sits in <prefix>/lib/node_modules beside <prefix>/bin/npm.
const BUNDLED_NPM_CLI = path.resolve('/resources/node/lib/node_modules/npm/bin/npm-cli.js');

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalPathExt = process.env.PATHEXT;

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

/** Files that exist; statSync reports isFile() and existsSync true for exactly these paths. */
let existingFiles = new Set<string>();
let execHandler: ExecHandler = () => ({ code: 0 });

const installFiles = (files: string[]) => {
  existingFiles = new Set(files);
};

const respondToFetch = (versions: Record<string, string>) => {
  fetchMock.mockImplementation(async (url: string) => {
    const pkg = Object.keys(versions).find((name) => url === `https://registry.npmjs.org/${name}/latest`);
    if (!pkg) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ version: versions[pkg] }) };
  });
};

/** Default exec behaviour: `npm prefix -g` prints NPM_PREFIX, `--version` prints `versions[file]`. */
const defaultExec =
  (versions: Record<string, string>, prefix = NPM_PREFIX): ExecHandler =>
  (file, args) => {
    if (args[0] === 'prefix' && args[1] === '-g') return { stdout: `${prefix}\n` };
    if (args[0] === '--version') return versions[file] ? { stdout: versions[file] } : { code: 1 };
    return { code: 0, stdout: 'updated' };
  };

const execCalls = () =>
  execFileMock.mock.calls.map(([file, args]) => ({ file: file as string, args: args as string[] }));

const savedState = (): AgentCliUpdateState | undefined => configStore.get(STATE_KEY) as AgentCliUpdateState | undefined;

const makeResult = (
  backend: string,
  checkedAt: number,
  extra: Partial<AgentCliCheckResult> = {}
): AgentCliCheckResult => ({
  backend,
  name: backend,
  installed: true,
  installedVersion: '1.0.0',
  latestVersion: '1.0.0',
  updateAvailable: false,
  method: 'npm',
  updateCommand: '',
  checkedAt,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  configStore.clear();
  setPlatform('linux');
  process.env.PATH = [NPM_BIN, LOCAL_BIN].join(path.delimiter);
  delete process.env.PATHEXT;
  installFiles([]);
  execHandler = defaultExec({});
  respondToFetch({});
  findBundledNpmMock.mockReturnValue(BUNDLED_NPM);
  getDataPathMock.mockReturnValue(DATA_DIR);
  statSyncMock.mockImplementation((candidate: string) => {
    if (!existingFiles.has(candidate)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { isFile: () => true };
  });
  existsSyncMock.mockImplementation((candidate: string) => existingFiles.has(candidate));
  // No managed Node runtime installed under the data dir.
  readdirSyncMock.mockImplementation(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  execFileMock.mockImplementation((file: string, args: string[], _opts: unknown, callback: ExecCallback) => {
    void Promise.resolve(execHandler(file, args)).then((reply) => {
      const code = reply.code ?? 0;
      const error = code !== 0 || reply.killed ? { code, killed: reply.killed } : null;
      callback(error, reply.stdout ?? '', reply.stderr ?? '');
    });
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setPlatform(originalPlatform);
  process.env.PATH = originalPath;
  if (originalPathExt === undefined) delete process.env.PATHEXT;
  else process.env.PATHEXT = originalPathExt;
  vi.restoreAllMocks();
});

describe('parseVersion', () => {
  it('extracts the version from codex-style output', () => {
    expect(parseVersion('codex-cli 0.147.0')).toBe('0.147.0');
  });

  it('extracts the version from claude-style output with a trailing label', () => {
    expect(parseVersion('2.1.300 (Claude Code)')).toBe('2.1.300');
  });

  it('keeps a prerelease suffix', () => {
    expect(parseVersion('opencode 1.2.3-beta.4')).toBe('1.2.3-beta.4');
  });

  it('returns undefined for output without a version', () => {
    expect(parseVersion('command not found')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
  });
});

describe('isNewer', () => {
  it('is true only when latest is strictly greater than installed', () => {
    expect(isNewer('2.1.301', '2.1.300')).toBe(true);
    expect(isNewer('2.1.300', '2.1.300')).toBe(false);
    expect(isNewer('2.0.0', '2.1.300')).toBe(false);
  });

  it('is false when either version is missing or not valid semver', () => {
    expect(isNewer(undefined, '1.0.0')).toBe(false);
    expect(isNewer('1.0.1', undefined)).toBe(false);
    expect(isNewer('latest', '1.0.0')).toBe(false);
  });
});

describe('findBinary', () => {
  it('returns the first PATH entry that holds the executable', () => {
    installFiles([path.join(LOCAL_BIN, 'claude')]);

    expect(findBinary('claude', { PATH: [NPM_BIN, LOCAL_BIN].join(path.delimiter) })).toBe(
      path.join(LOCAL_BIN, 'claude')
    );
  });

  it('on Windows tries only PATHEXT extensions, never the extensionless npm shell script', () => {
    setPlatform('win32');
    installFiles([path.join(NPM_PREFIX, 'claude'), path.join(NPM_PREFIX, 'claude.cmd')]);

    expect(findBinary('claude', { PATH: NPM_PREFIX, PATHEXT: '.EXE;.CMD' })).toBe(path.join(NPM_PREFIX, 'claude.cmd'));
  });

  it('falls back to the Windows-style Path variable', () => {
    installFiles([path.join(LOCAL_BIN, 'codex')]);

    expect(findBinary('codex', { Path: LOCAL_BIN })).toBe(path.join(LOCAL_BIN, 'codex'));
  });

  it('returns undefined when the executable is nowhere on PATH', () => {
    expect(findBinary('claude', { PATH: [NPM_BIN, LOCAL_BIN].join(path.delimiter) })).toBeUndefined();
    expect(findBinary('claude', {})).toBeUndefined();
  });
});

describe('runFile', () => {
  it('reports exit code 0 and captured output on success', async () => {
    execHandler = () => ({ stdout: 'out', stderr: 'err' });

    await expect(runFile('/bin/tool', ['--version'], 1000)).resolves.toEqual({
      code: 0,
      stdout: 'out',
      stderr: 'err',
      timedOut: false,
    });
  });

  it('runs Windows .cmd shims through cmd.exe with verbatim arguments', async () => {
    setPlatform('win32');

    await runFile('C:\\npm\\claude.cmd', ['--version'], 1000);

    const [command, args, options] = execFileMock.mock.calls[0];
    expect(command).toBe('cmd.exe');
    expect(args).toEqual(['/d', '/s', '/c', '""C:\\npm\\claude.cmd" --version"']);
    expect(options).toMatchObject({ windowsVerbatimArguments: true, timeout: 1000 });
  });

  it('quotes .cmd shim arguments that contain spaces in the cmd.exe line', async () => {
    setPlatform('win32');

    await runFile('C:\\npm\\npm.cmd', ['install', '-g', 'x@latest', '--prefix', 'C:\\Users\\First Last\\tools'], 1000);

    expect(execFileMock.mock.calls[0][1]).toEqual([
      '/d',
      '/s',
      '/c',
      '""C:\\npm\\npm.cmd" install -g x@latest --prefix "C:\\Users\\First Last\\tools""',
    ]);
  });

  it('passes arguments with spaces unquoted to a non-shim executable', async () => {
    await runFile('/bin/tool', ['--prefix', '/home/First Last/tools'], 1000);

    expect(execFileMock.mock.calls[0][1]).toEqual(['--prefix', '/home/First Last/tools']);
  });

  it('reports a non-zero exit and a timeout when the process is killed', async () => {
    execHandler = () => ({ code: 3, killed: true });

    await expect(runFile('/bin/tool', [], 1000)).resolves.toMatchObject({ code: 3, timedOut: true });
  });
});

describe('fetchLatestVersion', () => {
  it('returns the version from the registry latest document', async () => {
    respondToFetch({ '@openai/codex': '0.148.0' });

    await expect(fetchLatestVersion('@openai/codex')).resolves.toBe('0.148.0');
    expect(fetchMock.mock.calls[0][0]).toBe('https://registry.npmjs.org/@openai/codex/latest');
  });

  it('returns undefined when the registry answers with a non-OK status', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ version: '9.9.9' }) });

    await expect(fetchLatestVersion('@openai/codex')).resolves.toBeUndefined();
  });

  it('returns undefined instead of throwing when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(fetchLatestVersion('@openai/codex')).resolves.toBeUndefined();
  });

  it('returns undefined when the body has no string version', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: 42 }) });

    await expect(fetchLatestVersion('@openai/codex')).resolves.toBeUndefined();
  });
});

describe('readState', () => {
  it('returns empty results when nothing has been saved', async () => {
    await expect(readState()).resolves.toEqual({ lastAutoCheckAt: undefined, results: {} });
  });

  it('returns empty results when storage cannot be read', async () => {
    const { ProcessConfig } = await import('@process/utils/initStorage');
    vi.mocked(ProcessConfig.get).mockRejectedValueOnce(new Error('corrupt'));

    await expect(readState()).resolves.toEqual({ lastAutoCheckAt: undefined, results: {} });
  });
});

describe('checkCli', () => {
  const claudeNpm = path.join(NPM_BIN, 'claude');

  it('records an available update for an npm-installed CLI and broadcasts the new state', async () => {
    installFiles([path.join(NPM_BIN, 'npm'), claudeNpm]);
    execHandler = defaultExec({ [claudeNpm]: '2.1.300 (Claude Code)' });
    respondToFetch({ '@anthropic-ai/claude-code': '2.1.301' });

    const result = await checkCli('claude', NOW);

    expect(result).toMatchObject({
      installed: true,
      installedVersion: '2.1.300',
      latestVersion: '2.1.301',
      updateAvailable: true,
      method: 'npm',
      updateCommand: 'npm install -g @anthropic-ai/claude-code@latest',
      checkedAt: NOW,
    });
    expect(savedState()?.results.claude).toEqual(result);
    expect(emitMock).toHaveBeenCalledWith(savedState());
  });

  it('plans the self-updater when the binary is not inside the npm global prefix', async () => {
    const codexLocal = path.join(LOCAL_BIN, 'codex');
    installFiles([path.join(NPM_BIN, 'npm'), codexLocal]);
    execHandler = defaultExec({ [codexLocal]: 'codex-cli 0.147.0' });
    respondToFetch({ '@openai/codex': '0.147.0' });

    const result = await checkCli('codex', NOW);

    expect(result).toMatchObject({ method: 'self', updateCommand: 'codex update', updateAvailable: false });
  });

  it('plans a manual update with the npm command when the CLI has no self-updater', async () => {
    const geminiLocal = path.join(LOCAL_BIN, 'gemini');
    installFiles([geminiLocal]); // no npm on PATH at all
    execHandler = defaultExec({ [geminiLocal]: '0.9.0' });

    const result = await checkCli('gemini', NOW);

    expect(result).toMatchObject({ method: 'manual', updateCommand: 'npm install -g @google/gemini-cli@latest' });
  });

  it('plans a manual update with no command for a CLI without an npm package or updater', async () => {
    const kiro = path.join(LOCAL_BIN, 'kiro-cli');
    installFiles([kiro]);
    execHandler = defaultExec({ [kiro]: 'kiro-cli 1.0.0' });

    const result = await checkCli('kiro', NOW);

    expect(result).toMatchObject({ method: 'manual', updateCommand: '', latestVersion: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing CLI as not installed without spawning it', async () => {
    const result = await checkCli('claude', NOW);

    expect(result).toMatchObject({ installed: false, updateAvailable: false, method: 'manual', updateCommand: '' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('leaves the installed version unknown when --version fails, and never flags an update', async () => {
    installFiles([claudeNpm]);
    execHandler = () => ({ code: 1, stdout: '9.9.9' });
    respondToFetch({ '@anthropic-ai/claude-code': '2.1.301' });

    const result = await checkCli('claude', NOW);

    expect(result).toMatchObject({ installedVersion: undefined, updateAvailable: false });
  });

  it('does not flag an update when the registry is unreachable', async () => {
    installFiles([claudeNpm]);
    execHandler = defaultExec({ [claudeNpm]: '2.1.300' });
    fetchMock.mockRejectedValue(new Error('offline'));

    const result = await checkCli('claude', NOW);

    expect(result).toMatchObject({ installedVersion: '2.1.300', latestVersion: undefined, updateAvailable: false });
  });

  it('shares one in-flight check between concurrent callers', async () => {
    installFiles([claudeNpm]);
    execHandler = defaultExec({ [claudeNpm]: '2.1.300' });

    const [first, second] = await Promise.all([checkCli('claude', NOW), checkCli('claude', NOW)]);

    expect(second).toBe(first);
    expect(execCalls().filter((call) => call.args[0] === '--version')).toHaveLength(1);
  });

  it('resolves undefined for a backend that is not in the catalog', async () => {
    await expect(checkCli('not-a-cli', NOW)).resolves.toBeUndefined();
    expect(savedState()).toBeUndefined();
  });

  it('still broadcasts the result when saving the state fails', async () => {
    const { ProcessConfig } = await import('@process/utils/initStorage');
    vi.mocked(ProcessConfig.set).mockRejectedValueOnce(new Error('disk full'));

    await expect(checkCli('claude', NOW)).resolves.toMatchObject({ installed: false });
    expect(emitMock).toHaveBeenCalledTimes(1);
  });
});

describe('checkCli on Windows', () => {
  it('treats a binary directly inside `npm prefix -g` as an npm install, ignoring case', async () => {
    setPlatform('win32');
    process.env.PATHEXT = '.CMD';
    process.env.PATH = NPM_PREFIX;
    const claudeCmd = path.join(NPM_PREFIX, 'claude.cmd');
    installFiles([path.join(NPM_PREFIX, 'npm.cmd'), claudeCmd]);
    execHandler = (file, args) => {
      const joined = args.join(' ');
      if (joined.includes('prefix -g')) return { stdout: NPM_PREFIX.toUpperCase() };
      if (joined.includes('--version')) return { stdout: '2.1.300 (Claude Code)' };
      return { code: 1 };
    };

    const result = await checkCli('claude', NOW);

    expect(result).toMatchObject({ method: 'npm', installedVersion: '2.1.300' });
    expect(execCalls().every((call) => call.file === 'cmd.exe')).toBe(true);
  });
});

describe('checkCliIfStale', () => {
  const claudeNpm = path.join(NPM_BIN, 'claude');

  beforeEach(() => {
    installFiles([claudeNpm]);
    execHandler = defaultExec({ [claudeNpm]: '2.1.300' });
  });

  it('skips a CLI whose last result is younger than 48h', async () => {
    configStore.set(STATE_KEY, { results: { claude: makeResult('claude', NOW - CHECK_INTERVAL_MS + 1) } });

    await checkCliIfStale('claude', NOW);

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('re-checks a CLI whose last result is 48h old or more', async () => {
    configStore.set(STATE_KEY, { results: { claude: makeResult('claude', NOW - CHECK_INTERVAL_MS) } });

    await checkCliIfStale('claude', NOW);

    expect(savedState()?.results.claude.checkedAt).toBe(NOW);
  });

  it('checks a CLI that has never been checked', async () => {
    await checkCliIfStale('claude', NOW);

    expect(savedState()?.results.claude).toMatchObject({ installedVersion: '2.1.300', checkedAt: NOW });
  });

  it('ignores a backend that is not in the catalog', async () => {
    await checkCliIfStale('aionrs', NOW);

    expect(execFileMock).not.toHaveBeenCalled();
    expect(savedState()).toBeUndefined();
  });
});

describe('runAutoCheck', () => {
  const claudeNpm = path.join(NPM_BIN, 'claude');
  const codexLocal = path.join(LOCAL_BIN, 'codex');

  beforeEach(() => {
    installFiles([path.join(NPM_BIN, 'npm'), claudeNpm, codexLocal]);
    execHandler = defaultExec({ [claudeNpm]: '2.1.300', [codexLocal]: 'codex-cli 0.147.0' });
    respondToFetch({ '@anthropic-ai/claude-code': '2.1.301', '@openai/codex': '0.147.0' });
  });

  it('runs on first launch when no state has been saved, recording only installed CLIs', async () => {
    await expect(runAutoCheck(NOW)).resolves.toBe(true);

    expect(Object.keys(savedState()?.results ?? {}).sort()).toEqual(['claude', 'codex']);
    expect(savedState()?.lastAutoCheckAt).toBe(NOW);
  });

  it('does nothing when the last automatic check was under 48h ago', async () => {
    configStore.set(STATE_KEY, { lastAutoCheckAt: NOW - CHECK_INTERVAL_MS + 1, results: {} });

    await expect(runAutoCheck(NOW)).resolves.toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('runs again once 48h have passed and drops results of CLIs that are no longer installed', async () => {
    const stale = makeResult('opencode', NOW - CHECK_INTERVAL_MS);
    configStore.set(STATE_KEY, { lastAutoCheckAt: NOW - CHECK_INTERVAL_MS, results: { opencode: stale } });

    await expect(runAutoCheck(NOW)).resolves.toBe(true);
    expect(savedState()?.results.opencode).toBeUndefined();
    expect(savedState()?.results.claude).toMatchObject({ updateAvailable: true, checkedAt: NOW });
  });

  it('checks CLIs one after another, not in parallel', async () => {
    let releaseClaude: () => void = () => {};
    const base = execHandler;
    execHandler = (file, args) => {
      if (file === claudeNpm && args[0] === '--version') {
        return new Promise((resolve) => {
          releaseClaude = () => resolve({ stdout: '2.1.300' });
        });
      }
      return base(file, args);
    };

    const running = runAutoCheck(NOW);
    await vi.waitFor(() => expect(execCalls().some((call) => call.file === claudeNpm)).toBe(true));
    expect(execCalls().some((call) => call.file === codexLocal)).toBe(false);

    releaseClaude();
    await expect(running).resolves.toBe(true);
  });

  it('records nothing but still stamps the check time when no CLI is installed', async () => {
    installFiles([]);

    await expect(runAutoCheck(NOW)).resolves.toBe(true);
    expect(savedState()).toEqual({ lastAutoCheckAt: NOW, results: {} });
  });
});

describe('managed-tools installs', () => {
  const claudeManaged = path.join(MANAGED_BIN, 'claude');
  const managedArgs = ['install', '-g', '@anthropic-ai/claude-code@latest', '--prefix', TOOLS_DIR];

  beforeEach(() => {
    process.env.PATH = [MANAGED_BIN, NPM_BIN].join(path.delimiter);
    installFiles([path.join(NPM_BIN, 'npm'), claudeManaged, BUNDLED_NPM_CLI]);
    execHandler = defaultExec({ [claudeManaged]: '2.1.300' });
  });

  it('plans an npm update with the user-facing command and skips `npm prefix -g`', async () => {
    const result = await checkCli('claude', NOW);

    expect(result).toMatchObject({ method: 'npm', updateCommand: 'npm install -g @anthropic-ai/claude-code@latest' });
    expect(execCalls().some((call) => call.args[0] === 'prefix')).toBe(false);
  });

  it('updates with the bundled npm and --prefix pointing at the tools dir', async () => {
    const outcome = await updateCli('claude');

    expect(execCalls()).toContainEqual({ file: BUNDLED_NPM, args: managedArgs });
    expect(execCalls().some((call) => call.file === path.join(NPM_BIN, 'npm'))).toBe(false);
    expect(outcome.success).toBe(true);
  });

  it('falls back to the self-updater when the bundled npm lacks its npm package', async () => {
    installFiles([path.join(NPM_BIN, 'npm'), claudeManaged]);

    await updateCli('claude');

    expect(execCalls()).toContainEqual({ file: claudeManaged, args: ['update'] });
    expect(execCalls().some((call) => call.file === BUNDLED_NPM)).toBe(false);
  });

  it('falls back to the self-updater when the bundled npm is missing', async () => {
    findBundledNpmMock.mockReturnValue(null);

    await updateCli('claude');

    expect(execCalls()).toContainEqual({ file: claudeManaged, args: ['update'] });
    expect(execCalls().some((call) => call.file === BUNDLED_NPM)).toBe(false);
  });

  it('falls back to the npm global install when the bundled npm is missing and npm owns the binary', async () => {
    findBundledNpmMock.mockReturnValue(null);
    execHandler = defaultExec({ [claudeManaged]: '2.1.300' }, TOOLS_DIR);

    await updateCli('claude');

    expect(execCalls()).toContainEqual({
      file: path.join(NPM_BIN, 'npm'),
      args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
    });
  });

  it('plans a manual update when the bundled npm is missing and the CLI has no self-updater', async () => {
    findBundledNpmMock.mockReturnValue(null);
    installFiles([path.join(MANAGED_BIN, 'gemini')]);

    await expect(updateCli('gemini')).resolves.toEqual({ success: false, error: 'manual-update' });
  });

  it('treats the binary as non-managed when the data dir is unavailable', async () => {
    getDataPathMock.mockImplementation(() => {
      throw new Error('no data dir');
    });

    await updateCli('claude');

    expect(execCalls()).toContainEqual({ file: claudeManaged, args: ['update'] });
    expect(findBundledNpmMock).not.toHaveBeenCalled();
  });
});

describe('updateCli', () => {
  const claudeNpm = path.join(NPM_BIN, 'claude');
  const claudeLocal = path.join(LOCAL_BIN, 'claude');

  it('updates an npm-installed CLI with npm install -g and returns the fresh check', async () => {
    installFiles([path.join(NPM_BIN, 'npm'), claudeNpm]);
    execHandler = defaultExec({ [claudeNpm]: '2.1.301' });
    respondToFetch({ '@anthropic-ai/claude-code': '2.1.301' });

    const outcome = await updateCli('claude');

    expect(execCalls()).toContainEqual({
      file: path.join(NPM_BIN, 'npm'),
      args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
    });
    expect(outcome).toMatchObject({ success: true, output: 'updated', result: { installedVersion: '2.1.301' } });
  });

  it("runs the CLI's own updater when it was not installed by npm", async () => {
    installFiles([path.join(NPM_BIN, 'npm'), claudeLocal]);
    execHandler = defaultExec({ [claudeLocal]: '2.1.301' });

    const outcome = await updateCli('claude');

    expect(execCalls()).toContainEqual({ file: claudeLocal, args: ['update'] });
    expect(outcome.success).toBe(true);
  });

  it('falls back to the self-updater when `npm prefix -g` fails', async () => {
    installFiles([path.join(NPM_BIN, 'npm'), claudeNpm]);
    const base = defaultExec({ [claudeNpm]: '2.1.301' });
    execHandler = (file, args) => (args[0] === 'prefix' ? { code: 1 } : base(file, args));

    await updateCli('claude');

    expect(execCalls()).toContainEqual({ file: claudeNpm, args: ['update'] });
  });

  it('reports command-failed with the output tail when the update exits non-zero', async () => {
    installFiles([claudeLocal]);
    const base = defaultExec({ [claudeLocal]: '2.1.300' });
    execHandler = (file, args) =>
      args[0] === 'update' ? { code: 1, stdout: 'downloading', stderr: 'EACCES' } : base(file, args);

    const outcome = await updateCli('claude');

    expect(outcome).toMatchObject({ success: false, error: 'command-failed', output: 'downloading\nEACCES' });
    expect(outcome.result).toMatchObject({ installedVersion: '2.1.300' });
  });

  it('reports timeout when the update process is killed', async () => {
    installFiles([claudeLocal]);
    const base = defaultExec({ [claudeLocal]: '2.1.300' });
    execHandler = (file, args) => (args[0] === 'update' ? { code: 1, killed: true } : base(file, args));

    await expect(updateCli('claude')).resolves.toMatchObject({ success: false, error: 'timeout' });
  });

  it('keeps only the last 20 output lines', async () => {
    installFiles([claudeLocal]);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const base = defaultExec({ [claudeLocal]: '2.1.300' });
    execHandler = (file, args) => (args[0] === 'update' ? { stdout: lines.join('\n') } : base(file, args));

    const outcome = await updateCli('claude');

    expect(outcome.output?.split('\n')).toEqual(lines.slice(-20));
  });

  it('refuses with manual-update when there is no runnable plan', async () => {
    installFiles([path.join(LOCAL_BIN, 'gemini')]);

    await expect(updateCli('gemini')).resolves.toEqual({ success: false, error: 'manual-update' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('refuses with not-installed when the CLI is not on PATH', async () => {
    await expect(updateCli('claude')).resolves.toEqual({ success: false, error: 'not-installed' });
  });

  it('refuses with unknown-cli for a backend outside the catalog', async () => {
    await expect(updateCli('aionrs')).resolves.toEqual({ success: false, error: 'unknown-cli' });
  });
});
