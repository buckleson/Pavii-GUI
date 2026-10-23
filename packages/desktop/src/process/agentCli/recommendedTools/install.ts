/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Installs the recommended agent tools into Pavii's managed-tools folder:
 * Trail-Code with the managed npm, the Python tools with the pinned uv.
 * Nothing is written outside managed-tools and no tool setup command runs.
 */

import fs from 'node:fs';
import {
  RECOMMENDED_TOOLS,
  type InstallRecommendedToolsResult,
  type RecommendedTool,
  type RecommendedToolId,
  type RecommendedToolInstallOutcome,
} from '@/common/types/agent/recommendedTools';
import { findManagedNpm } from '../installCli';
import { getRecommendedToolPaths } from './paths';
import { runFile, type RunResult } from './run';
import { ensureUv, UvError } from './uv';

const NPM_TIMEOUT_MS = 5 * 60_000;
const UV_TOOL_TIMEOUT_MS = 10 * 60_000;
const PYTHON_VERSION = '3.12';

type InstalledListener = () => void;
const listeners = new Set<InstalledListener>();

/** Subscribe to "recommended tools changed" (after an install with at least one success). Returns an unsubscribe. */
export function onRecommendedToolsInstalled(listener: InstalledListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const emitInstalled = (): void => {
  for (const listener of listeners) {
    try {
      listener();
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
  const run = await runFile(uv, ['tool', 'install', '--python', PYTHON_VERSION, tool.packageSpec], {
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
  });
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

/** Install `ids` one after another; one failure does not stop the others. */
export async function installRecommendedTools(ids: RecommendedToolId[]): Promise<InstallRecommendedToolsResult> {
  const outcomes: RecommendedToolInstallOutcome[] = [];
  for (const id of ids) outcomes.push(await installOne(id));
  if (outcomes.some((outcome) => outcome.success)) emitInstalled();
  return { outcomes };
}
