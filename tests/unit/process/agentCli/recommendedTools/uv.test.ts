/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the pinned uv bootstrap: reuse of an existing binary, the
 * platform/asset lookup, download and checksum failures, the tar list +
 * extract steps, and cleanup of the temporary download folder.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RunReply = { code: number; output: string; timedOut: boolean };

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  runFile: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
}));

const ARCHIVE = Buffer.from('pinned-uv-archive');

vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const overrides = {
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    writeFileSync: mocks.writeFileSync,
    rmSync: mocks.rmSync,
    renameSync: mocks.renameSync,
    chmodSync: mocks.chmodSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('@/common/types/agent/recommendedTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/types/agent/recommendedTools')>();
  const { createHash: hash } = await import('node:crypto');
  const sha256 = hash('sha256').update(Buffer.from('pinned-uv-archive')).digest('hex');
  return {
    ...actual,
    UV_ASSETS: {
      'linux-x64': { file: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256 },
      'win32-x64': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256 },
    },
  };
});

vi.mock('@pavii/web-host', () => ({
  getManagedToolsDir: (dataDir: string) => path.join(dataDir, 'managed-tools'),
  getManagedToolsPathEntries: (dataDir: string) => [path.join(dataDir, 'managed-tools', 'bin')],
}));

const DATA_DIR = path.resolve('/data/pavii');
vi.mock('@process/utils/utils', () => ({ getDataPath: () => DATA_DIR }));

vi.mock('@process/agentCli/recommendedTools/run', () => ({ runFile: mocks.runFile }));

import { ensureUv, findBinaryEntries, UvError } from '@process/agentCli/recommendedTools/uv';

const UV_DIR = path.join(DATA_DIR, 'managed-tools', 'uv');
const originalPlatform = process.platform;
const originalArch = process.arch;
const originalSystemRoot = process.env.SystemRoot;

const setHost = (platform: NodeJS.Platform, arch: string) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
};

let existing = new Set<string>();
let listing = 'uv-x86_64-unknown-linux-gnu/\nuv-x86_64-unknown-linux-gnu/uv\nuv-x86_64-unknown-linux-gnu/uvx\n';
let listReply: Partial<RunReply> = {};
let extractReply: Partial<RunReply> = {};

const okResponse = (data: Buffer = ARCHIVE) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
});

const workDirOf = (): string => {
  const call = mocks.mkdirSync.mock.calls.find(([dir]) => String(dir).includes('.download-'));
  return String(call?.[0]);
};

const catchUvError = async (): Promise<UvError> => {
  try {
    await ensureUv();
  } catch (error) {
    return error as UvError;
  }
  throw new Error('ensureUv resolved');
};

beforeEach(() => {
  vi.clearAllMocks();
  setHost('linux', 'x64');
  existing = new Set<string>();
  listing = 'uv-x86_64-unknown-linux-gnu/\nuv-x86_64-unknown-linux-gnu/uv\nuv-x86_64-unknown-linux-gnu/uvx\n';
  listReply = {};
  extractReply = {};
  mocks.existsSync.mockImplementation((file: string) => existing.has(String(file)));
  mocks.renameSync.mockImplementation((_from: string, to: string) => {
    existing.add(String(to));
  });
  mocks.fetch.mockResolvedValue(okResponse());
  mocks.runFile.mockImplementation(async (_file: string, args: string[]) =>
    args[0] === '-tf'
      ? { code: 0, output: listing, timedOut: false, ...listReply }
      : { code: 0, output: '', timedOut: false, ...extractReply }
  );
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  if (originalSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = originalSystemRoot;
});

describe('ensureUv: existing binary and platform', () => {
  it('returns the managed uv without downloading when it already exists', async () => {
    existing.add(path.join(UV_DIR, 'uv'));
    await expect(ensureUv()).resolves.toBe(path.join(UV_DIR, 'uv'));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects with unsupported-platform when no asset is pinned for the host', async () => {
    setHost('freebsd', 'x64');
    const error = await catchUvError();
    expect(error).toBeInstanceOf(UvError);
    expect(error.code).toBe('unsupported-platform');
  });

  it('does not create a download folder for an unsupported platform', async () => {
    setHost('linux', 'ia32');
    await catchUvError();
    expect(mocks.mkdirSync).not.toHaveBeenCalled();
  });
});

describe('ensureUv: download', () => {
  it('downloads the pinned release asset from the astral-sh/uv GitHub release', async () => {
    await ensureUv();
    expect(String(mocks.fetch.mock.calls[0][0])).toMatch(
      /^https:\/\/github\.com\/astral-sh\/uv\/releases\/download\/[\d.]+\/uv-x86_64-unknown-linux-gnu\.tar\.gz$/
    );
  });

  it('reports download-failed for a non-OK response', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    expect((await catchUvError()).code).toBe('download-failed');
  });

  it('reports download-failed when fetch throws', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'));
    expect((await catchUvError()).code).toBe('download-failed');
  });

  it('reports download-failed when the body cannot be read', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        throw new Error('reset');
      },
    });
    expect((await catchUvError()).code).toBe('download-failed');
  });

  it('removes the temporary download folder after a failed download', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'));
    await catchUvError();
    expect(mocks.rmSync).toHaveBeenCalledWith(workDirOf(), { recursive: true, force: true });
  });
});

describe('ensureUv: checksum', () => {
  it('reports checksum-mismatch when the archive hash differs from the pinned value', async () => {
    mocks.fetch.mockResolvedValue(okResponse(Buffer.from('tampered')));
    expect((await catchUvError()).code).toBe('checksum-mismatch');
  });

  it('deletes the downloaded archive on a checksum mismatch', async () => {
    mocks.fetch.mockResolvedValue(okResponse(Buffer.from('tampered')));
    await catchUvError();
    const archive = path.join(workDirOf(), 'uv-x86_64-unknown-linux-gnu.tar.gz');
    expect(mocks.rmSync).toHaveBeenCalledWith(archive, { force: true });
  });

  it('never runs tar for an archive that failed the checksum', async () => {
    mocks.fetch.mockResolvedValue(okResponse(Buffer.from('tampered')));
    await catchUvError();
    expect(mocks.runFile).not.toHaveBeenCalled();
  });

  it('hashes exactly the bytes it writes to disk', async () => {
    await ensureUv();
    const written = mocks.writeFileSync.mock.calls[0][1] as Buffer;
    expect(createHash('sha256').update(written).digest('hex')).toBe(createHash('sha256').update(ARCHIVE).digest('hex'));
  });
});

describe('ensureUv: extraction', () => {
  it('lists the archive before extracting it into the work folder', async () => {
    await ensureUv();
    const archive = path.join(workDirOf(), 'uv-x86_64-unknown-linux-gnu.tar.gz');
    expect(mocks.runFile.mock.calls.map(([, args]) => args)).toEqual([
      ['-tf', archive],
      ['-xf', archive, '-C', path.join(workDirOf(), 'extract')],
    ]);
  });

  it('moves uv and uvx into the uv folder and returns the uv path', async () => {
    await expect(ensureUv()).resolves.toBe(path.join(UV_DIR, 'uv'));
    expect(mocks.renameSync.mock.calls.map(([, to]) => to)).toEqual([
      path.join(UV_DIR, 'uv'),
      path.join(UV_DIR, 'uvx'),
    ]);
  });

  it('marks the extracted binaries executable on POSIX', async () => {
    await ensureUv();
    const source = path.join(workDirOf(), 'extract', 'uv-x86_64-unknown-linux-gnu', 'uv');
    expect(mocks.chmodSync).toHaveBeenCalledWith(source, 0o755);
  });

  it('removes the temporary download folder after a successful install', async () => {
    await ensureUv();
    expect(mocks.rmSync).toHaveBeenLastCalledWith(workDirOf(), { recursive: true, force: true });
  });

  it('reports command-failed when listing the archive fails', async () => {
    listReply = { code: 2, output: 'tar: bad archive' };
    const error = await catchUvError();
    expect(error.code).toBe('command-failed');
    expect(error.output).toBe('tar: bad archive');
  });

  it('reports command-failed when the archive holds no uv binary', async () => {
    listing = 'README.md\nLICENSE\n';
    expect((await catchUvError()).code).toBe('command-failed');
  });

  it('reports command-failed and still cleans up when extraction fails', async () => {
    extractReply = { code: 1, output: 'disk full' };
    expect((await catchUvError()).code).toBe('command-failed');
    expect(mocks.rmSync).toHaveBeenCalledWith(workDirOf(), { recursive: true, force: true });
  });

  it('reports command-failed when uv is still missing after extraction', async () => {
    mocks.renameSync.mockImplementation(() => {});
    expect((await catchUvError()).code).toBe('command-failed');
  });
});

describe('ensureUv: Windows', () => {
  beforeEach(() => {
    setHost('win32', 'x64');
    process.env.SystemRoot = 'D:\\Win';
    listing = 'uv.exe\r\nuvx.exe\r\nuvw.exe\r\n';
  });

  it("uses Windows' own tar from %SystemRoot%\\System32", async () => {
    await ensureUv();
    expect(mocks.runFile.mock.calls[0][0]).toBe(path.join('D:\\Win', 'System32', 'tar.exe'));
  });

  it('moves uv.exe, uvx.exe and uvw.exe and does not chmod', async () => {
    await expect(ensureUv()).resolves.toBe(path.join(UV_DIR, 'uv.exe'));
    expect(mocks.renameSync).toHaveBeenCalledTimes(3);
    expect(mocks.chmodSync).not.toHaveBeenCalled();
  });

  it('reports command-failed when the zip only holds POSIX names', async () => {
    listing = 'uv\nuvx\n';
    expect((await catchUvError()).code).toBe('command-failed');
  });
});

describe('findBinaryEntries', () => {
  it('strips a leading ./ from entries', () => {
    expect(findBinaryEntries('./uv\n./uvx\n', ['uv', 'uvx'])).toEqual(
      new Map([
        ['uv', 'uv'],
        ['uvx', 'uvx'],
      ])
    );
  });

  it('finds binaries one folder deep', () => {
    const found = findBinaryEntries('uv-aarch64-apple-darwin/\nuv-aarch64-apple-darwin/uv\n', ['uv']);
    expect(found.get('uv')).toBe('uv-aarch64-apple-darwin/uv');
  });

  it('ignores binaries nested deeper than one folder', () => {
    expect(findBinaryEntries('a/b/uv\n', ['uv']).size).toBe(0);
  });

  it('ignores folders and unrelated files', () => {
    const found = findBinaryEntries('uv/\nREADME.md\nuv-x/LICENSE\nuv-x/uv\n', ['uv']);
    expect([...found.entries()]).toEqual([['uv', 'uv-x/uv']]);
  });

  it('keeps the first match when a name appears twice', () => {
    expect(findBinaryEntries('uv\nother/uv\n', ['uv']).get('uv')).toBe('uv');
  });

  it('returns an empty map for an empty listing', () => {
    expect(findBinaryEntries('', ['uv']).size).toBe(0);
  });
});
