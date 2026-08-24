/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ensure the OpenCode CLI agent is available on every install.
 *
 * Pavii.Ai ships OpenCode as the default agent, and the engine discovers agents
 * purely by PATH lookup (`binary_name` -> `which::which`), never by inspecting
 * bundle directories. So availability is entirely a PATH question:
 *
 *   1. `registerOpencodeOnPath` runs BEFORE the engine spawns and adds the
 *      bundled OpenCode directory (shipped in the installer by
 *      packages/shared-scripts/src/prepare-opencode.js) plus the app-managed
 *      tools dir. This is what makes a fresh install work in its FIRST session.
 *   2. `ensureOpencodeInstalled` is now only a fallback for platforms with no
 *      bundled binary: it npm-installs `opencode-ai` into the managed tools dir.
 *      That path needs the network and only takes effect on the next launch, so
 *      it must never be the primary mechanism.
 *
 * A user's own `opencode` on PATH always wins: the bundled directory is
 * appended, not prepended.
 *
 * This lives in web-host rather than in the desktop app because both
 * distributions need it and web-host is the only package both depend on: the
 * Electron main process registers PATH before it spawns the engine, and
 * `startWebHost` does the same for the `pavii-web` tarball. It imports nothing
 * beyond node builtins, so neither runtime is dragged into the other.
 */

import { execFile, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPENCODE_NPM_PACKAGE = 'opencode-ai';
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** True only for a real file — a directory of the same name must not count. */
function isExecutableFile(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Directory holding the OpenCode binary shipped inside the installer. */
export function getBundledOpencodeDir(
  resourcesPath: string | undefined,
  runtimeKey: string = `${process.platform}-${process.arch}`
): string | null {
  if (!resourcesPath) return null;
  const dir = join(resourcesPath, 'bundled-opencode', runtimeKey);
  const binary = join(dir, process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  // isFile, not just exists: a directory named `opencode.exe` would satisfy
  // existsSync, put a non-executable path on PATH, and suppress the npm
  // fallback — the app would advertise a bundled agent that cannot run.
  return isExecutableFile(binary) ? dir : null;
}

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

type RegisterOpencodeOptions = {
  dataDir: string;
  resourcesPath?: string;
  /** Repo-root fallback used in dev, where process.resourcesPath is Electron's own. */
  devResourcesFallback?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

/**
 * Put OpenCode on PATH for the engine. Must run BEFORE the engine is spawned —
 * the engine snapshots PATH at spawn and probes agent availability immediately,
 * so anything registered later only takes effect on the next launch.
 *
 * The bundled directory is **appended**, so a user's own OpenCode earlier on
 * PATH keeps priority; we only guarantee that *some* OpenCode exists.
 */
export function registerOpencodeOnPath(options: RegisterOpencodeOptions): void {
  const { dataDir, resourcesPath, devResourcesFallback, env = process.env, log = () => {} } = options;

  // npm-installed fallback copies live here; prepended (they are app-managed).
  registerManagedToolsOnPath(dataDir, env);

  const bundledDir = getBundledOpencodeDir(resourcesPath) ?? getBundledOpencodeDir(devResourcesFallback);
  if (!bundledDir) return;

  const currentPath = env.PATH ?? '';
  if (currentPath.split(delimiter).includes(bundledDir)) return;
  env.PATH = currentPath ? [currentPath, bundledDir].join(delimiter) : bundledDir;
  log(`[opencode] bundled CLI registered on PATH: ${bundledDir}`);
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
 * Fallback acquisition for platforms with no bundled OpenCode binary.
 *
 * The primary mechanism is the bundled CLI registered by
 * `registerOpencodeOnPath` before the engine spawns. This npm install only
 * matters when that bundle is absent (an unsupported arch), and it cannot help
 * the current session — the engine already snapshotted PATH — so it is
 * deliberately best-effort and non-fatal.
 *
 * Resolves to true when opencode is available (already present or installed).
 */
export async function ensureOpencodeInstalled(options: EnsureOpencodeOptions): Promise<boolean> {
  const { dataDir, resourcesPath, devResourcesFallback, log = () => {}, logError = () => {} } = options;
  registerOpencodeOnPath({ dataDir, resourcesPath, devResourcesFallback, log });

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
    // Windows needs a shell to run npm.cmd, but `execFile` with `shell: true`
    // joins file and args with plain spaces and no quoting — so an install path
    // containing a space (`C:\Program Files\Pavii.Ai\...`, an offered default)
    // was silently truncated at `C:\Program` and every install failed. Quote
    // both the executable and any argument that contains a space.
    const useShell = process.platform === 'win32';
    const quote = (value: string) => (useShell && value.includes(' ') ? `"${value}"` : value);
    const args = ['install', '-g', OPENCODE_NPM_PACKAGE, '--prefix', toolsDir];
    await execFileAsync(useShell ? quote(npm) : npm, useShell ? args.map(quote) : args, {
      timeout: INSTALL_TIMEOUT_MS,
      shell: useShell,
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
