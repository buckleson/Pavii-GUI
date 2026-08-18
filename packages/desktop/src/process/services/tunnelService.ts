/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { rename, unlink } from 'fs/promises';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { getDataPath } from '../utils/utils';

/**
 * Cloudflare quick-tunnel management for the WebUI's "Public access" toggle.
 *
 * Spawns `cloudflared tunnel --url http://localhost:<port>` and parses the
 * random https://<name>.trycloudflare.com URL from its output. Quick tunnels
 * need no Cloudflare account; the URL changes on every start and dies with
 * the process — suitable for personal remote access, with the WebUI's own
 * login (and the /ws session gate in web-host) as the security boundary.
 */

export type TunnelState = {
  running: boolean;
  starting: boolean;
  url?: string;
  error?: string;
};

const CLOUDFLARED_DOWNLOAD_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 60_000;

const state: TunnelState = { running: false, starting: false };
let child: ChildProcess | null = null;

// cloudflared is not detached, but Electron does not kill children on quit;
// make sure the tunnel dies with the app.
process.on('exit', () => {
  child?.kill();
});

/** Extract the public tunnel URL from a cloudflared log chunk, if present. */
export function parseTunnelUrl(logChunk: string): string | null {
  return logChunk.match(URL_PATTERN)?.[0] ?? null;
}

function binaryName(): string {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/** Resolve an existing cloudflared binary, or null when absent everywhere. */
export function resolveCloudflaredBinary(): string | null {
  const override = process.env.PAVII_CLOUDFLARED_BIN;
  if (override && existsSync(override)) return override;
  const candidates = [
    // Dev checkout cache (where the setup session downloaded it).
    join(process.cwd(), '.cache', 'tools', binaryName()),
    // Managed location under the app's data dir.
    join(getDataPath(), 'managed-tools', binaryName()),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Download cloudflared into the managed-tools dir (Windows-only URL for now). */
async function downloadCloudflared(): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('Automatic cloudflared download is only wired for Windows; install cloudflared on PATH.');
  }
  const dir = join(getDataPath(), 'managed-tools');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, binaryName());
  const partial = `${target}.download`;
  const response = await fetch(CLOUDFLARED_DOWNLOAD_URL);
  if (!response.ok || !response.body) {
    throw new Error(`cloudflared download failed (${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), createWriteStream(partial));
  await unlink(target).catch(() => {});
  await rename(partial, target);
  return target;
}

/** Start the tunnel for the given local port. Resolves once the URL is known. */
export async function startTunnel(port: number): Promise<TunnelState> {
  await stopTunnel();
  state.starting = true;
  state.error = undefined;
  state.url = undefined;

  try {
    const binary = resolveCloudflaredBinary() ?? (await downloadCloudflared());
    const proc = spawn(binary, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child = proc;

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for the tunnel URL')), START_TIMEOUT_MS);
      const onChunk = (chunk: Buffer) => {
        const found = parseTunnelUrl(String(chunk));
        if (found) {
          clearTimeout(timer);
          resolve(found);
        }
      };
      proc.stdout?.on('data', onChunk);
      proc.stderr?.on('data', onChunk);
      proc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`cloudflared exited early (code ${code ?? 'unknown'})`));
      });
      proc.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    proc.on('exit', () => {
      if (child === proc) {
        child = null;
        state.running = false;
        state.url = undefined;
      }
    });

    state.running = true;
    state.starting = false;
    state.url = url;
    return { ...state };
  } catch (error) {
    state.starting = false;
    state.running = false;
    state.error = error instanceof Error ? error.message : String(error);
    child?.kill();
    child = null;
    throw error;
  }
}

export async function stopTunnel(): Promise<void> {
  const proc = child;
  child = null;
  state.running = false;
  state.starting = false;
  state.url = undefined;
  if (proc && !proc.killed) {
    proc.kill();
  }
}

export function getTunnelState(): TunnelState {
  return { ...state };
}
