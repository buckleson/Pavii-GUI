/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Installs open-source agent CLIs into Pavii's managed-tools folder with the
 * bundled npm. Loaded lazily from the agent CLI bridge, so nothing here runs
 * at launch. The managed-tools folder is already on the main process PATH
 * (registered before the engine spawns), so an installed CLI is found by
 * the PATH refresh the renderer triggers afterwards.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { findBundledNpm, getManagedToolsDir, getManagedToolsPathEntries } from '@pavii/web-host';
import { findOpenSourceCli, type AgentCliInstallResult } from '@/common/types/agent/openSourceClis';
import { getDataPath } from '@process/utils/utils';

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_TAIL_LINES = 20;

const tail = (text: string): string => text.trim().split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join('\n');

/**
 * True when `npm` (the `npm.cmd` / `bin/npm` launcher) has npm's own package
 * beside it. The bundled Node runtime ships the launcher without
 * `node_modules/npm`, so its npm cannot run.
 */
export const hasNpmCli = (npm: string): boolean => {
  const cli =
    process.platform === 'win32'
      ? path.join(path.dirname(npm), 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(path.dirname(path.dirname(npm)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(cli);
};

/** npm inside the engine's managed Node runtime (`<data>/runtime/node/node-v*`), installed on first use. */
const findRuntimeNpm = (): string | null => {
  const runtimeRoot = path.join(getDataPath(), 'runtime', 'node');
  let entries: string[];
  try {
    entries = fs.readdirSync(runtimeRoot).filter((name) => name.startsWith('node-v'));
  } catch {
    return null;
  }
  for (const entry of entries.toSorted().toReversed()) {
    const npm =
      process.platform === 'win32'
        ? path.join(runtimeRoot, entry, 'npm.cmd')
        : path.join(runtimeRoot, entry, 'bin', 'npm');
    if (fs.existsSync(npm) && hasNpmCli(npm)) return npm;
  }
  return null;
};

/**
 * A runnable npm: the engine's managed Node runtime first (it ships a complete
 * npm), then the bundled runtime (dev falls back to the repo `resources` dir,
 * like the OpenCode fallback). A launcher without npm's package is skipped.
 */
export const findManagedNpm = (): string | null => {
  const runtimeNpm = findRuntimeNpm();
  if (runtimeNpm) return runtimeNpm;
  const runtimeKey = `${process.platform}-${process.arch}`;
  const devResources = app.isPackaged ? undefined : path.join(process.cwd(), 'resources');
  const candidates = [
    findBundledNpm(process.resourcesPath, runtimeKey),
    devResources ? findBundledNpm(devResources, runtimeKey) : null,
  ];
  return candidates.find((npm): npm is string => Boolean(npm && hasNpmCli(npm))) ?? null;
};

/** Folder that receives `npm install -g --prefix` installs. */
export const getToolsDir = (): string => getManagedToolsDir(getDataPath());

/** Directories where npm puts the launcher shims of managed-tools installs. */
export const getManagedBinDirs = (): string[] => getManagedToolsPathEntries(getDataPath());

/**
 * Run `npm` with `args`. Windows needs a shell for npm.cmd, and `shell: true`
 * joins file and args with plain spaces, so anything containing a space
 * (e.g. a data dir under `C:\Users\First Last`) is quoted.
 */
export const runNpm = (
  npm: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; output: string; timedOut: boolean }> =>
  new Promise((resolve) => {
    const useShell = process.platform === 'win32';
    const quote = (value: string) => (useShell && value.includes(' ') ? `"${value}"` : value);
    execFile(
      useShell ? quote(npm) : npm,
      useShell ? args.map(quote) : args,
      { timeout: timeoutMs, shell: useShell, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, output: tail(`${String(stdout)}\n${String(stderr)}`), timedOut: Boolean(error?.killed) });
      }
    );
  });

/** Install an npm-kind open-source CLI into the managed-tools folder. */
export const installCli = async (backend: string): Promise<AgentCliInstallResult> => {
  const cli = findOpenSourceCli(backend);
  if (!cli) return { success: false, error: 'unknown-cli' };
  if (cli.install.kind !== 'npm') return { success: false, error: 'not-installable' };
  const npm = findManagedNpm();
  if (!npm) {
    console.warn(`[AgentCli] cannot install ${backend}: bundled npm not found`);
    return { success: false, error: 'npm-missing' };
  }
  const toolsDir = getToolsDir();
  fs.mkdirSync(toolsDir, { recursive: true });
  console.log(`[AgentCli] installing ${backend} (${cli.install.pkg})`);
  const run = await runNpm(npm, ['install', '-g', cli.install.pkg, '--prefix', toolsDir], INSTALL_TIMEOUT_MS);
  if (run.code !== 0) {
    console.warn(`[AgentCli] install of ${backend} failed (code ${run.code}${run.timedOut ? ', timed out' : ''})`);
    return { success: false, error: run.timedOut ? 'timeout' : 'command-failed', output: run.output };
  }
  console.log(`[AgentCli] installed ${backend}`);
  return { success: true };
};
