/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks installed agent CLIs against their latest published release and
 * runs updates on request. Loaded lazily (after the window has loaded or on
 * a settings action), so nothing here is on the app-launch path.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { net } from 'electron';
import semver from 'semver';
import { ipcBridge } from '@/common';
import type {
  AgentCliCheckResult,
  AgentCliUpdateMethod,
  AgentCliUpdateResult,
  AgentCliUpdateState,
} from '@/common/types/agent/agentCliUpdate';
import { ProcessConfig } from '@process/utils/initStorage';
import { CLI_CATALOG, findCatalogEntry, type CliCatalogEntry } from './cliCatalog';
import { findManagedNpm, getManagedBinDirs, getToolsDir } from './installCli';

export const CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000;
const VERSION_TIMEOUT_MS = 10_000;
const NPM_PREFIX_TIMEOUT_MS = 15_000;
const REGISTRY_TIMEOUT_MS = 8_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_TAIL_LINES = 20;
const STATE_KEY = 'agentCli.updateState';

type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

/** First `x.y.z` (with optional prerelease) in a `--version` output. */
export const parseVersion = (output: string): string | undefined =>
  output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0];

/** True when `latest` is a strictly newer release than `installed`. */
export const isNewer = (latest: string | undefined, installed: string | undefined): boolean => {
  const l = latest ? semver.valid(latest) : null;
  const i = installed ? semver.valid(installed) : null;
  return Boolean(l && i && semver.gt(l, i));
};

/**
 * Resolve `binary` on PATH without spawning a process. On Windows only
 * PATHEXT extensions are tried: npm installs an extensionless POSIX shell
 * script next to the `.cmd` shim, and that script cannot be executed there.
 */
export const findBinary = (binary: string, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const isWindows = process.platform === 'win32';
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = isWindows
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map((e) => e.toLowerCase())
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return undefined;
};

/**
 * Run a resolved executable with fixed arguments. Windows `.cmd`/`.bat`
 * shims cannot be executed without a shell, so they go through `cmd.exe`;
 * the arguments always come from the catalog, never from user input.
 */
export const runFile = (file: string, args: string[], timeoutMs: number): Promise<RunResult> =>
  new Promise((resolve) => {
    const isShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
    const command = isShim ? 'cmd.exe' : file;
    // Quote arguments with spaces (e.g. a managed-tools `--prefix` dir) so cmd.exe keeps them whole.
    const shimArgs = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg));
    const commandArgs = isShim ? ['/d', '/s', '/c', `"${[`"${file}"`, ...shimArgs].join(' ')}"`] : args;
    execFile(
      command,
      commandArgs,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, windowsVerbatimArguments: isShim },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr), timedOut: Boolean(error?.killed) });
      }
    );
  });

/** Latest version on the npm registry, or undefined when it can't be reached. */
export const fetchLatestVersion = async (npmPackage: string): Promise<string | undefined> => {
  try {
    const response = await net.fetch(`https://registry.npmjs.org/${npmPackage}/latest`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : undefined;
  } catch {
    return undefined;
  }
};

const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);

/** Whether `binaryPath` was installed by the npm on PATH (`npm i -g`). */
const isNpmGlobalInstall = async (binaryPath: string): Promise<{ npm: string } | undefined> => {
  const npm = findBinary('npm');
  if (!npm) return undefined;
  const { code, stdout } = await runFile(npm, ['prefix', '-g'], NPM_PREFIX_TIMEOUT_MS);
  const prefix = stdout.trim();
  if (code !== 0 || !prefix) return undefined;
  const binDir = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
  return samePath(path.dirname(binaryPath), binDir) ? { npm } : undefined;
};

/** Whether `binaryPath` was installed by Pavii into its managed-tools folder. */
const isManagedToolsInstall = (binaryPath: string): boolean => {
  try {
    return getManagedBinDirs().some((dir) => samePath(path.dirname(binaryPath), dir));
  } catch {
    // Data dir unavailable: treat as a non-managed install.
    return false;
  }
};

type UpdatePlan = { method: AgentCliUpdateMethod; command: string; run?: { file: string; args: string[] } };

const planUpdate = async (entry: CliCatalogEntry, binaryPath: string): Promise<UpdatePlan> => {
  const npmCommand = entry.npmPackage ? `npm install -g ${entry.npmPackage}@latest` : '';
  if (entry.npmPackage && isManagedToolsInstall(binaryPath)) {
    const npm = findManagedNpm();
    if (npm) {
      return {
        method: 'npm',
        command: npmCommand,
        run: { file: npm, args: ['install', '-g', `${entry.npmPackage}@latest`, '--prefix', getToolsDir()] },
      };
    }
  }
  if (entry.npmPackage) {
    const npm = await isNpmGlobalInstall(binaryPath);
    if (npm) {
      return {
        method: 'npm',
        command: npmCommand,
        run: { file: npm.npm, args: ['install', '-g', `${entry.npmPackage}@latest`] },
      };
    }
  }
  if (entry.selfUpdateArgs) {
    return {
      method: 'self',
      command: [entry.binary, ...entry.selfUpdateArgs].join(' '),
      run: { file: binaryPath, args: entry.selfUpdateArgs },
    };
  }
  return { method: 'manual', command: npmCommand };
};

export const readState = async (): Promise<AgentCliUpdateState> => {
  const stored: AgentCliUpdateState | undefined = await ProcessConfig.get(STATE_KEY).catch((): undefined => undefined);
  return { lastAutoCheckAt: stored?.lastAutoCheckAt, results: { ...stored?.results } };
};

const writeState = async (state: AgentCliUpdateState): Promise<void> => {
  await ProcessConfig.set(STATE_KEY, state).catch((error: unknown) => {
    console.warn('[AgentCli] saving update state failed:', error);
  });
  ipcBridge.agentCli.stateChanged.emit(state);
};

const checkEntry = async (entry: CliCatalogEntry, now: number): Promise<AgentCliCheckResult> => {
  const base = { backend: entry.backend, name: entry.name, checkedAt: now };
  const binaryPath = findBinary(entry.binary);
  if (!binaryPath) {
    return { ...base, installed: false, updateAvailable: false, method: 'manual', updateCommand: '' };
  }
  const [versionRun, latestVersion, plan] = await Promise.all([
    runFile(binaryPath, ['--version'], VERSION_TIMEOUT_MS),
    entry.npmPackage ? fetchLatestVersion(entry.npmPackage) : Promise.resolve(undefined),
    planUpdate(entry, binaryPath),
  ]);
  const installedVersion = versionRun.code === 0 ? parseVersion(versionRun.stdout || versionRun.stderr) : undefined;
  return {
    ...base,
    installed: true,
    installedVersion,
    latestVersion,
    updateAvailable: isNewer(latestVersion, installedVersion),
    method: plan.method,
    updateCommand: plan.command,
  };
};

const saveResult = async (result: AgentCliCheckResult, patch: Partial<AgentCliUpdateState> = {}) => {
  const state = await readState();
  state.results[result.backend] = result;
  await writeState({ ...state, ...patch, results: state.results });
};

const inFlight = new Map<string, Promise<AgentCliCheckResult | undefined>>();

/** Check one catalog CLI now and persist the result. */
export const checkCli = (backend: string, now = Date.now()): Promise<AgentCliCheckResult | undefined> => {
  const entry = findCatalogEntry(backend);
  if (!entry) return Promise.resolve(undefined);
  const pending = inFlight.get(backend);
  if (pending) return pending;
  const task = (async () => {
    const result = await checkEntry(entry, now);
    await saveResult(result);
    return result;
  })().finally(() => inFlight.delete(backend));
  inFlight.set(backend, task);
  return task;
};

/** Check `backend` only when its last result is missing or older than 48h. */
export const checkCliIfStale = async (backend: string, now = Date.now()): Promise<void> => {
  if (!findCatalogEntry(backend)) return;
  const previous = (await readState()).results[backend];
  if (previous && now - previous.checkedAt < CHECK_INTERVAL_MS) return;
  await checkCli(backend, now);
};

/**
 * Launch-time check of the most-used CLIs, at most once every 48h. Runs the
 * CLIs one after another to keep disk and CPU load low; CLIs that are not
 * installed are skipped and not recorded.
 */
export const runAutoCheck = async (now = Date.now()): Promise<boolean> => {
  const state = await readState();
  if (state.lastAutoCheckAt && now - state.lastAutoCheckAt < CHECK_INTERVAL_MS) return false;
  for (const entry of CLI_CATALOG.filter((e) => e.autoCheck)) {
    // Sequential on purpose: each check spawns a CLI, and running them in parallel would load the machine.
    // eslint-disable-next-line no-await-in-loop
    const result = await checkEntry(entry, now);
    if (result.installed) state.results[entry.backend] = result;
    // An uninstalled CLI must not keep a stale "update available" result.
    else delete state.results[entry.backend];
  }
  state.lastAutoCheckAt = now;
  await writeState(state);
  const outdated = Object.values(state.results).filter((r) => r.updateAvailable);
  console.log(
    `[AgentCli] auto-check done: ${Object.keys(state.results).length} checked, ${outdated.length} with updates`
  );
  return true;
};

const tail = (text: string): string => text.trim().split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join('\n');

/** Update one CLI with its npm or self-update command, then re-check it. */
export const updateCli = async (backend: string): Promise<AgentCliUpdateResult> => {
  const entry = findCatalogEntry(backend);
  if (!entry) return { success: false, error: 'unknown-cli' };
  const binaryPath = findBinary(entry.binary);
  if (!binaryPath) return { success: false, error: 'not-installed' };
  const plan = await planUpdate(entry, binaryPath);
  if (!plan.run) return { success: false, error: 'manual-update' };
  console.log(`[AgentCli] updating ${backend} via ${plan.method}`);
  const run = await runFile(plan.run.file, plan.run.args, UPDATE_TIMEOUT_MS);
  const output = tail(`${run.stdout}\n${run.stderr}`);
  const result = await checkCli(backend);
  if (run.code !== 0) {
    console.warn(`[AgentCli] update of ${backend} failed (code ${run.code}${run.timedOut ? ', timed out' : ''})`);
    return { success: false, result, output, error: run.timedOut ? 'timeout' : 'command-failed' };
  }
  return { success: true, result, output };
};
