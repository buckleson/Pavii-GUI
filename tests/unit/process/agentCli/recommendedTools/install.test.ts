/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the recommended tools installer: the exact npm and
 * `uv tool install` commands, the managed-tools env passed to uv, how each
 * failure kind is reported, and the "installed" listener contract.
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECOMMENDED_TOOLS_ENV } from '@/common/types/agent/recommendedTools';

type ExecError = { code?: number; killed?: boolean } | null;
type ExecCallback = (error: ExecError, stdout: string, stderr: string) => void;
type ExecOptions = { shell: boolean; timeout: number; env: NodeJS.ProcessEnv };
type ExecReply = { error: ExecError; stdout?: string; stderr?: string };

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  mkdirSync: vi.fn(),
  findManagedNpm: vi.fn(),
  ensureUv: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, default: { ...actual, execFile: mocks.execFile }, execFile: mocks.execFile };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, mkdirSync: mocks.mkdirSync, default: { ...actual, mkdirSync: mocks.mkdirSync } };
});

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));

vi.mock('@pavii/web-host', () => ({
  getManagedToolsDir: (dataDir: string) => path.join(dataDir, 'managed-tools'),
  getManagedToolsPathEntries: (dataDir: string) => [path.join(dataDir, 'managed-tools', 'bin')],
}));

const DATA_DIR = path.resolve('/data/pavii');
vi.mock('@process/utils/utils', () => ({ getDataPath: () => DATA_DIR }));

vi.mock('@process/agentCli/installCli', () => ({ findManagedNpm: mocks.findManagedNpm }));

vi.mock('@process/agentCli/recommendedTools/uv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@process/agentCli/recommendedTools/uv')>();
  return { ...actual, ensureUv: mocks.ensureUv };
});

import { installRecommendedTools, onRecommendedToolsInstalled } from '@process/agentCli/recommendedTools/install';
import { UvError } from '@process/agentCli/recommendedTools/uv';

const TOOLS_DIR = path.join(DATA_DIR, 'managed-tools');
const NPM = path.resolve('/runtime/node/bin/npm');
const UV = path.join(TOOLS_DIR, 'uv', 'uv');
const originalPlatform = process.platform;

/** Replies by executable: the first call to each consumes the next reply in its queue. */
let replies: Record<string, ExecReply[]> = {};
const unsubscribes: Array<() => void> = [];

const callsTo = (file: string) =>
  mocks.execFile.mock.calls.filter(([called]) => called === file) as Array<
    [string, string[], ExecOptions, ExecCallback]
  >;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  replies = {};
  mocks.findManagedNpm.mockReturnValue(NPM);
  mocks.ensureUv.mockResolvedValue(UV);
  mocks.execFile.mockImplementation((file: string, _args: string[], _options: ExecOptions, callback: ExecCallback) => {
    const reply = replies[file]?.shift() ?? { error: null };
    callback(reply.error, reply.stdout ?? '', reply.stderr ?? '');
  });
});

afterEach(() => {
  unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.restoreAllMocks();
});

describe('installRecommendedTools: Trail-Code via npm', () => {
  it('runs npm install -g with the pinned spec and the managed-tools prefix', async () => {
    await installRecommendedTools(['trail']);
    expect(callsTo(NPM)[0][1]).toEqual(['install', '-g', '@trailhq/trail-code@0.25.0', '--prefix', TOOLS_DIR]);
  });

  it('creates the npm prefix folder before installing', async () => {
    await installRecommendedTools(['trail']);
    expect(mocks.mkdirSync).toHaveBeenCalledWith(TOOLS_DIR, { recursive: true });
  });

  it('reports success for a zero exit code', async () => {
    await expect(installRecommendedTools(['trail'])).resolves.toEqual({ outcomes: [{ id: 'trail', success: true }] });
  });

  it('reports npm-missing without running anything when no managed npm exists', async () => {
    mocks.findManagedNpm.mockReturnValue(null);
    const { outcomes } = await installRecommendedTools(['trail']);
    expect(outcomes).toEqual([{ id: 'trail', success: false, error: 'npm-missing' }]);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

describe('installRecommendedTools: Python tools via uv', () => {
  it('runs uv tool install with Python 3.12 and the pinned headroom spec', async () => {
    await installRecommendedTools(['headroom']);
    expect(callsTo(UV)[0][1]).toEqual(['tool', 'install', '--python', '3.12', 'headroom-ai[mcp]==0.41.0']);
  });

  it('runs uv tool install with the pinned graphify spec', async () => {
    await installRecommendedTools(['graphify']);
    expect(callsTo(UV)[0][1]).toEqual(['tool', 'install', '--python', '3.12', 'graphifyy[mcp]==0.9.95']);
  });

  it('keeps uv tools, launchers, Pythons and cache inside managed-tools', async () => {
    await installRecommendedTools(['headroom']);
    expect(callsTo(UV)[0][2].env).toMatchObject({
      UV_TOOL_DIR: path.join(TOOLS_DIR, 'uv-tools'),
      UV_TOOL_BIN_DIR: path.join(TOOLS_DIR, 'uv-bin'),
      UV_PYTHON_INSTALL_DIR: path.join(TOOLS_DIR, 'uv-python'),
      UV_CACHE_DIR: path.join(TOOLS_DIR, 'uv-cache'),
    });
  });

  it('turns off the uv Python launcher and registry entries', async () => {
    await installRecommendedTools(['headroom']);
    expect(callsTo(UV)[0][2].env).toMatchObject({ UV_PYTHON_INSTALL_BIN: '0', UV_PYTHON_INSTALL_REGISTRY: '0' });
  });

  it('sets every telemetry switch on the uv command', async () => {
    await installRecommendedTools(['graphify']);
    expect(callsTo(UV)[0][2].env).toMatchObject(RECOMMENDED_TOOLS_ENV);
  });

  it('passes an ensureUv error code and output through unchanged', async () => {
    mocks.ensureUv.mockRejectedValue(new UvError('checksum-mismatch', 'bad hash', 'tail'));
    const { outcomes } = await installRecommendedTools(['headroom']);
    expect(outcomes).toEqual([{ id: 'headroom', success: false, error: 'checksum-mismatch', output: 'tail' }]);
  });

  it('reports command-failed when ensureUv throws something that is not a UvError', async () => {
    mocks.ensureUv.mockRejectedValue(new Error('EACCES'));
    const { outcomes } = await installRecommendedTools(['graphify']);
    expect(outcomes).toEqual([{ id: 'graphify', success: false, error: 'command-failed' }]);
  });
});

describe('installRecommendedTools: failures', () => {
  it('reports timeout when the command is killed', async () => {
    replies[NPM] = [{ error: { killed: true } }];
    const { outcomes } = await installRecommendedTools(['trail']);
    expect(outcomes[0]).toMatchObject({ success: false, error: 'timeout' });
  });

  it('reports command-failed with the last lines of output for a non-zero exit', async () => {
    const stderr = Array.from({ length: 30 }, (_, index) => `err ${index + 1}`).join('\n');
    replies[UV] = [{ error: { code: 2 }, stderr }];
    const { outcomes } = await installRecommendedTools(['headroom']);
    expect(outcomes[0]).toMatchObject({ success: false, error: 'command-failed' });
    expect(outcomes[0].output?.split('\n')).toEqual(Array.from({ length: 20 }, (_, index) => `err ${index + 11}`));
  });

  it('keeps installing the next tool after one fails', async () => {
    replies[NPM] = [{ error: { code: 1 } }];
    const { outcomes } = await installRecommendedTools(['trail', 'headroom', 'graphify']);
    expect(outcomes.map((outcome) => [outcome.id, outcome.success])).toEqual([
      ['trail', false],
      ['headroom', true],
      ['graphify', true],
    ]);
  });

  it('reports command-failed for an unknown tool id', async () => {
    const { outcomes } = await installRecommendedTools(['nope' as never]);
    expect(outcomes).toEqual([{ id: 'nope', success: false, error: 'command-failed' }]);
  });

  it('returns no outcomes for an empty request', async () => {
    await expect(installRecommendedTools([])).resolves.toEqual({ outcomes: [] });
  });
});

describe('onRecommendedToolsInstalled', () => {
  it('notifies a listener once when at least one tool installed', async () => {
    const listener = vi.fn();
    unsubscribes.push(onRecommendedToolsInstalled(listener));
    replies[NPM] = [{ error: { code: 1 } }];
    await installRecommendedTools(['trail', 'headroom']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when every tool failed', async () => {
    const listener = vi.fn();
    unsubscribes.push(onRecommendedToolsInstalled(listener));
    mocks.findManagedNpm.mockReturnValue(null);
    await installRecommendedTools(['trail']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('catches a throwing listener and still notifies the others', async () => {
    const after = vi.fn();
    unsubscribes.push(
      onRecommendedToolsInstalled(() => {
        throw new Error('listener bug');
      })
    );
    unsubscribes.push(onRecommendedToolsInstalled(after));
    await expect(installRecommendedTools(['headroom'])).resolves.toBeDefined();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', async () => {
    const listener = vi.fn();
    onRecommendedToolsInstalled(listener)();
    await installRecommendedTools(['headroom']);
    expect(listener).not.toHaveBeenCalled();
  });
});
