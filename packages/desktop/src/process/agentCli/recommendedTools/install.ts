/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Installs the Pavii agent tools into Pavii's managed-tools folder: Code Map
 * (Trail-Code) with the managed npm, the Python tools with the pinned uv.
 * Nothing is written outside managed-tools and no tool setup command runs.
 * Installs run one after another (automatic install and Retry share a queue);
 * each attempt is recorded in ProcessConfig `recommendedTools.installResults`.
 */

import fs from 'node:fs';
import { app } from 'electron';
import {
  RECOMMENDED_TOOLS,
  type InstallRecommendedToolsResult,
  type RecommendedTool,
  type RecommendedToolId,
  type RecommendedToolInstallOutcome,
  type RecommendedToolInstallRecords,
} from '@/common/types/agent/recommendedTools';
import { ProcessConfig } from '@process/utils/initStorage';
import { findManagedNpm } from '../installCli';
import { getRecommendedToolPaths } from './paths';
import { runFile, type RunResult } from './run';
import { ensureUv, UvError } from './uv';

const NPM_TIMEOUT_MS = 5 * 60_000;
const UV_TOOL_TIMEOUT_MS = 10 * 60_000;
const PYTHON_VERSION = '3.12';

const RESULTS_KEY = 'recommendedTools.installResults';

type InstalledListener = (installedIds: RecommendedToolId[]) => void;
const listeners = new Set<InstalledListener>();
/** Tools queued or being installed now. */
const pending = new Set<RecommendedToolId>();
let queue: Promise<unknown> = Promise.resolve();

/** Tools that are queued for install or installing now. */
export function getInstallingToolIds(): RecommendedToolId[] {
  return [...pending];
}

/** Last install attempt of each tool; empty when nothing was recorded or the config cannot be read. */
export async function getInstallRecords(): Promise<RecommendedToolInstallRecords> {
  const records = await ProcessConfig.get(RESULTS_KEY).catch((): undefined => undefined);
  return records ?? {};
}

const recordOutcome = async (outcome: RecommendedToolInstallOutcome): Promise<void> => {
  try {
    const records = await getInstallRecords();
    records[outcome.id] = {
      appVersion: app.getVersion(),
      success: outcome.success,
      ...(outcome.error ? { error: outcome.error } : {}),
      at: Date.now(),
    };
    await ProcessConfig.set(RESULTS_KEY, records);
  } catch (error) {
    console.warn('[RecommendedTools] recording the install result failed:', error);
  }
};

/**
 * Subscribe to "tools installed" (after an install with at least one
 * success); the listener gets the ids that installed. Returns an unsubscribe.
 */
export function onRecommendedToolsInstalled(listener: InstalledListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const emitInstalled = (installedIds: RecommendedToolId[]): void => {
  for (const listener of listeners) {
    try {
      listener(installedIds);
    } catch (error) {
      console.warn('[RecommendedTools] installed listener failed:', error);
    }
  }
};

const fromRun = (id: RecommendedToolId, run: RunResult): RecommendedToolInstallOutcome =>
  run.code === 0
    ? { id, success: true }
    : { id, success: false, error: run.timedOut ? 'timeout' : 'command-failed', output: run.output };

const installNodeTool = async (tool: RecommendedTool): Promise<RecommendedToolInstallOutcome> => {
  const npm = findManagedNpm();
  if (!npm) return { id: tool.id, success: false, error: 'npm-missing' };
  const { npmPrefix } = getRecommendedToolPaths();
  fs.mkdirSync(npmPrefix, { recursive: true });
  const run = await runFile(npm, ['install', '-g', tool.packageSpec, '--prefix', npmPrefix], {
    timeoutMs: NPM_TIMEOUT_MS,
  });
  return fromRun(tool.id, run);
};

const installUvTool = async (tool: RecommendedTool): Promise<RecommendedToolInstallOutcome> => {
  let uv: string;
  try {
    uv = await ensureUv();
  } catch (error) {
    if (error instanceof UvError) return { id: tool.id, success: false, error: error.code, output: error.output };
    throw error;
  }
  const paths = getRecommendedToolPaths();
  // --managed-python: use uv's own Python under uvPythonDir, never a system
  // install (a system Python removed or upgraded later would break the tool).
  const withExecutables = (tool.executablesFrom ?? []).flatMap((pkg) => ['--with-executables-from', pkg]);
  const run = await runFile(
    uv,
    ['tool', 'install', '--managed-python', '--python', PYTHON_VERSION, ...withExecutables, tool.packageSpec],
    {
      timeoutMs: UV_TOOL_TIMEOUT_MS,
      env: {
        UV_TOOL_DIR: paths.uvToolDir,
        UV_TOOL_BIN_DIR: paths.uvToolBinDir,
        UV_PYTHON_INSTALL_DIR: paths.uvPythonDir,
        UV_CACHE_DIR: paths.uvCacheDir,
        // A downloaded Python stays in UV_PYTHON_INSTALL_DIR: no launcher in
        // ~/.local/bin and no Windows registry entry.
        UV_PYTHON_INSTALL_BIN: '0',
        UV_PYTHON_INSTALL_REGISTRY: '0',
      },
    }
  );
  return fromRun(tool.id, run);
};

const installOne = async (id: RecommendedToolId): Promise<RecommendedToolInstallOutcome> => {
  const tool = RECOMMENDED_TOOLS.find((candidate) => candidate.id === id);
  if (!tool) return { id, success: false, error: 'command-failed' };
  console.log(`[RecommendedTools] installing ${tool.id} (${tool.packageSpec})`);
  let outcome: RecommendedToolInstallOutcome;
  try {
    outcome = tool.runtime === 'node' ? await installNodeTool(tool) : await installUvTool(tool);
  } catch (error) {
    console.warn(`[RecommendedTools] install of ${tool.id} threw:`, error);
    outcome = { id, success: false, error: 'command-failed' };
  }
  if (outcome.success) console.log(`[RecommendedTools] installed ${tool.id}`);
  else console.warn(`[RecommendedTools] install of ${tool.id} failed (${outcome.error})`);
  return outcome;
};

const runInstalls = async (ids: RecommendedToolId[]): Promise<InstallRecommendedToolsResult> => {
  const outcomes: RecommendedToolInstallOutcome[] = [];
  try {
    for (const id of ids) {
      const outcome = await installOne(id);
      await recordOutcome(outcome);
      pending.delete(id);
      outcomes.push(outcome);
    }
  } finally {
    for (const id of ids) pending.delete(id);
  }
  const installedIds = outcomes.filter((outcome) => outcome.success).map((outcome) => outcome.id);
  if (installedIds.length > 0) emitInstalled(installedIds);
  return { outcomes };
};

/**
 * Install `ids` one after another, after any install already running; one
 * failure does not stop the others. A tool already queued is not queued twice.
 */
export function installRecommendedTools(ids: RecommendedToolId[]): Promise<InstallRecommendedToolsResult> {
  const fresh = [...new Set(ids)].filter((id) => !pending.has(id));
  for (const id of fresh) pending.add(id);
  const run = queue.then(() => runInstalls(fresh));
  queue = run.catch((): undefined => undefined);
  return run;
}
