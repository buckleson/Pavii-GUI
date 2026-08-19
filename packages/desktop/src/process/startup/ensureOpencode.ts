/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ensure the OpenCode CLI agent is available on every install.
 *
 * Pavii.Ai ships OpenCode as a default agent. The engine discovers agents via
 * PATH, so on startup we:
 *   1. prepend the app-managed tools directory to PATH (cheap, always), then
 *   2. if `opencode` is still not resolvable, install it into that directory
 *      with the bundled Node runtime's npm (`npm install -g --prefix <tools>`).
 *
 * The install is best-effort and non-blocking: failures are logged, never fatal.
 */

import { execFile, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPENCODE_NPM_PACKAGE = 'opencode-ai';
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** Directory that receives the npm-prefix install of managed CLI tools. */
export function getManagedToolsDir(dataDir: string): string {
  return join(dataDir, 'managed-tools');
}

/**
 * PATH entries for the managed tools dir. npm's global prefix puts launcher
 * shims at the prefix root on Windows and under bin/ elsewhere.
 */
export function getManagedToolsPathEntries(dataDir: string, platform: NodeJS.Platform = process.platform): string[] {
  const toolsDir = getManagedToolsDir(dataDir);
  return platform === 'win32' ? [toolsDir] : [join(toolsDir, 'bin')];
}

/** Prepend the managed tools dir to PATH so the engine's agent detection sees it. */
export function registerManagedToolsOnPath(dataDir: string, env: NodeJS.ProcessEnv = process.env): void {
  const entries = getManagedToolsPathEntries(dataDir);
  const currentPath = env.PATH ?? '';
  const parts = currentPath.split(delimiter);
  const missing = entries.filter((entry) => !parts.includes(entry));
  if (missing.length === 0) return;
  env.PATH = [...missing, currentPath].join(delimiter);
}

function isOpencodeOnPath(): boolean {
  const command = process.platform === 'win32' ? 'where opencode' : 'which opencode';
  try {
    execSync(command, { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** Locate npm from the bundled managed Node runtime (falls back to a system npm). */
export function findBundledNpm(resourcesPath: string | undefined, runtimeKey: string): string | null {
  if (!resourcesPath) return null;
  const nodeBase = join(resourcesPath, 'bundled-paviicore', runtimeKey, 'managed-resources', 'node');
  if (!existsSync(nodeBase)) return null;
  const npmName = process.platform === 'win32' ? 'npm.cmd' : 'bin/npm';
  try {
    for (const entry of readdirSync(nodeBase)) {
      const candidate = join(nodeBase, entry, ...npmName.split('/'));
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // fall through
  }
  return null;
}

type EnsureOpencodeOptions = {
  dataDir: string;
  resourcesPath?: string;
  /** Repo-root fallback used in dev where process.resourcesPath is Electron's own. */
  devResourcesFallback?: string;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
};

/**
 * Install OpenCode into the managed tools dir when it is not already available.
 * Resolves to true when opencode is available (already present or installed).
 */
export async function ensureOpencodeInstalled(options: EnsureOpencodeOptions): Promise<boolean> {
  const { dataDir, resourcesPath, devResourcesFallback, log = () => {}, logError = () => {} } = options;
  registerManagedToolsOnPath(dataDir);

  if (isOpencodeOnPath()) {
    log('[opencode] already available on PATH');
    return true;
  }

  const runtimeKey = `${process.platform}-${process.arch}`;
  const npm =
    findBundledNpm(resourcesPath, runtimeKey) ??
    (devResourcesFallback ? findBundledNpm(devResourcesFallback, runtimeKey) : null);
  if (!npm) {
    logError('[opencode] cannot install: bundled npm not found', { resourcesPath, runtimeKey });
    return false;
  }

  const toolsDir = getManagedToolsDir(dataDir);
  mkdirSync(toolsDir, { recursive: true });
  log(`[opencode] installing ${OPENCODE_NPM_PACKAGE} into ${toolsDir}`);
  try {
    await execFileAsync(npm, ['install', '-g', OPENCODE_NPM_PACKAGE, '--prefix', toolsDir], {
      timeout: INSTALL_TIMEOUT_MS,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
  } catch (error) {
    logError('[opencode] install failed', error);
    return false;
  }

  const available = isOpencodeOnPath();
  log(available ? '[opencode] installed and available' : '[opencode] installed but not resolvable on PATH');
  return available;
}
