/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pinned uv for the Python tools: downloaded from the astral-sh/uv GitHub
 * release, checked against the pinned SHA-256 and unpacked with the system
 * `tar`. uv's install script is never run.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { net } from 'electron';
import { UV_ASSETS, UV_VERSION } from '@/common/types/agent/recommendedTools';
import { exeName, getRecommendedToolPaths } from './paths';
import { runFile } from './run';

const DOWNLOAD_TIMEOUT_MS = 2 * 60_000;
const TAR_TIMEOUT_MS = 60_000;

export type UvErrorCode = 'unsupported-platform' | 'download-failed' | 'checksum-mismatch' | 'command-failed';

/** A failed {@link ensureUv}; `code` is the install outcome error. */
export class UvError extends Error {
  constructor(
    readonly code: UvErrorCode,
    message: string,
    readonly output?: string
  ) {
    super(message);
    this.name = 'UvError';
  }
}

/** Windows' own bsdtar (reads .zip too); elsewhere `tar` on PATH. */
const tarCommand = (): string =>
  process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

/** Binaries taken from the archive: Windows zips also carry `uvw.exe`. */
const wantedBinaries = (): string[] =>
  process.platform === 'win32' ? ['uv.exe', 'uvx.exe', 'uvw.exe'] : ['uv', 'uvx'];

const download = async (url: string): Promise<Buffer> => {
  let response: Response;
  try {
    response = await net.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new UvError('download-failed', `uv download failed: ${String(error)}`);
  }
  if (!response.ok) throw new UvError('download-failed', `uv download failed: HTTP ${response.status}`);
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new UvError('download-failed', `uv download failed: ${String(error)}`);
  }
};

/**
 * Archive entries (as `tar -t` prints them) whose file name is a wanted
 * binary, at the top level or inside one folder (`uv-<target>/uv`).
 */
export const findBinaryEntries = (listing: string, wanted: string[]): Map<string, string> => {
  const found = new Map<string, string>();
  for (const raw of listing.split(/\r?\n/)) {
    const entry = raw.trim().replace(/^\.\//, '');
    if (!entry || entry.endsWith('/')) continue;
    const parts = entry.split('/');
    const name = parts[parts.length - 1];
    if (parts.length <= 2 && wanted.includes(name) && !found.has(name)) found.set(name, entry);
  }
  return found;
};

const extract = async (archive: string, workDir: string, uvDir: string): Promise<void> => {
  const tar = tarCommand();
  const list = await runFile(tar, ['-tf', archive], { timeoutMs: TAR_TIMEOUT_MS });
  if (list.code !== 0) throw new UvError('command-failed', 'listing the uv archive failed', list.output);
  // runFile keeps only the output tail; the uv archives hold a handful of entries.
  const entries = findBinaryEntries(list.output, wantedBinaries());
  if (!entries.has(exeName('uv'))) throw new UvError('command-failed', 'uv binary missing from archive', list.output);

  const extractDir = path.join(workDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });
  const unpack = await runFile(tar, ['-xf', archive, '-C', extractDir], { timeoutMs: TAR_TIMEOUT_MS });
  if (unpack.code !== 0) throw new UvError('command-failed', 'extracting the uv archive failed', unpack.output);

  for (const [name, entry] of entries) {
    const source = path.join(extractDir, ...entry.split('/'));
    const target = path.join(uvDir, name);
    if (process.platform !== 'win32') fs.chmodSync(source, 0o755);
    fs.rmSync(target, { force: true });
    fs.renameSync(source, target);
  }
};

/** Path of the managed uv binary, downloading the pinned release on first use. */
export async function ensureUv(): Promise<string> {
  const { uvDir } = getRecommendedToolPaths();
  const uv = path.join(uvDir, exeName('uv'));
  if (fs.existsSync(uv)) return uv;

  const asset = UV_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new UvError('unsupported-platform', `no uv build for ${process.platform}-${process.arch}`);

  const workDir = path.join(uvDir, `.download-${randomUUID()}`);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const data = await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.file}`);
    const archive = path.join(workDir, asset.file);
    fs.writeFileSync(archive, data);
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== asset.sha256) {
      fs.rmSync(archive, { force: true });
      throw new UvError('checksum-mismatch', `uv archive SHA-256 ${digest} does not match the pinned value`);
    }
    await extract(archive, workDir, uvDir);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(uv)) throw new UvError('command-failed', 'uv binary not found after extraction');
  return uv;
}
