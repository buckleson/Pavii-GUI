/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the command runner used by the recommended tools: when a
 * shell is used (Windows .cmd only), argument quoting, the environment merge
 * order, and how exit codes, timeouts and output are reported.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (
  error: { code?: number | string; killed?: boolean } | null,
  stdout: string,
  stderr: string
) => void;
type ExecOptions = { shell: boolean; timeout: number; env: NodeJS.ProcessEnv };

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, default: { ...actual, execFile: execFileMock }, execFile: execFileMock };
});

import { runFile, tail, toolEnv } from '@process/agentCli/recommendedTools/run';

const originalPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

let reply: { error: { code?: number | string; killed?: boolean } | null; stdout: string; stderr: string } = {
  error: null,
  stdout: '',
  stderr: '',
};

const lastCall = () => execFileMock.mock.calls[0] as [string, string[], ExecOptions, ExecCallback];

beforeEach(() => {
  vi.clearAllMocks();
  setPlatform('win32');
  reply = { error: null, stdout: '', stderr: '' };
  execFileMock.mockImplementation((_file: string, _args: string[], _options: ExecOptions, callback: ExecCallback) => {
    callback(reply.error, reply.stdout, reply.stderr);
  });
});

afterEach(() => {
  setPlatform(originalPlatform);
  delete process.env.HEADROOM_TELEMETRY;
  delete process.env.PAVII_TEST_INHERITED;
});

describe('runFile: shell use and quoting', () => {
  it('runs a Windows .cmd launcher through a shell and quotes a spaced path', async () => {
    await runFile('C:\\Program Files\\node\\npm.cmd', ['install'], { timeoutMs: 1000 });
    const [file, , options] = lastCall();
    expect(file).toBe('"C:\\Program Files\\node\\npm.cmd"');
    expect(options.shell).toBe(true);
  });

  it('quotes only the .cmd arguments that contain spaces', async () => {
    await runFile('C:\\node\\npm.cmd', ['install', '--prefix', 'C:\\My Data\\tools'], { timeoutMs: 1000 });
    expect(lastCall()[1]).toEqual(['install', '--prefix', '"C:\\My Data\\tools"']);
  });

  it('runs an .exe without a shell and passes spaced arguments unchanged', async () => {
    await runFile('C:\\Program Files\\uv\\uv.exe', ['tool', 'C:\\My Data'], { timeoutMs: 1000 });
    const [file, args, options] = lastCall();
    expect(options.shell).toBe(false);
    expect([file, ...args]).toEqual(['C:\\Program Files\\uv\\uv.exe', 'tool', 'C:\\My Data']);
  });

  it('never uses a shell on POSIX, even for a .cmd file name', async () => {
    setPlatform('linux');
    await runFile('/opt/odd name.cmd', ['a b'], { timeoutMs: 1000 });
    expect(lastCall()[2].shell).toBe(false);
  });

  it('passes the timeout through', async () => {
    await runFile('C:\\uv.exe', [], { timeoutMs: 4321 });
    expect(lastCall()[2].timeout).toBe(4321);
  });
});

describe('runFile: environment', () => {
  it('lets the extra env override the telemetry switches', async () => {
    await runFile('C:\\uv.exe', [], { timeoutMs: 1000, env: { DO_NOT_TRACK: '0' } });
    expect(lastCall()[2].env.DO_NOT_TRACK).toBe('0');
  });

  it('lets the telemetry switches override the inherited process env', async () => {
    process.env.HEADROOM_TELEMETRY = 'on';
    await runFile('C:\\uv.exe', [], { timeoutMs: 1000 });
    expect(lastCall()[2].env.HEADROOM_TELEMETRY).toBe('off');
  });

  it('keeps the inherited process env when nothing overrides it', () => {
    process.env.PAVII_TEST_INHERITED = 'yes';
    expect(toolEnv({ EXTRA: 'x' })).toMatchObject({ PAVII_TEST_INHERITED: 'yes', EXTRA: 'x', DO_NOT_TRACK: '1' });
  });
});

describe('runFile: result', () => {
  it('resolves code 0 with stdout and stderr for a successful run', async () => {
    reply = { error: null, stdout: 'done', stderr: 'warn' };
    await expect(runFile('C:\\uv.exe', [], { timeoutMs: 1000 })).resolves.toEqual({
      code: 0,
      output: 'done\nwarn',
      timedOut: false,
    });
  });

  it('reports the numeric exit code of a failed run', async () => {
    reply = { error: { code: 3 }, stdout: '', stderr: 'boom' };
    await expect(runFile('C:\\uv.exe', [], { timeoutMs: 1000 })).resolves.toMatchObject({ code: 3 });
  });

  it('reports code 1 when the error has no numeric code (e.g. ENOENT)', async () => {
    reply = { error: { code: 'ENOENT' }, stdout: '', stderr: '' };
    await expect(runFile('C:\\uv.exe', [], { timeoutMs: 1000 })).resolves.toMatchObject({ code: 1 });
  });

  it('marks a killed process as timed out', async () => {
    reply = { error: { killed: true }, stdout: '', stderr: '' };
    await expect(runFile('C:\\uv.exe', [], { timeoutMs: 1000 })).resolves.toMatchObject({ timedOut: true });
  });
});

describe('tail', () => {
  it('keeps only the last 20 lines', () => {
    const text = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\r\n');
    const lines = tail(text).split('\n');
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe('line 6');
  });

  it('returns an empty string for blank output', () => {
    expect(tail('  \n ')).toBe('');
  });
});
