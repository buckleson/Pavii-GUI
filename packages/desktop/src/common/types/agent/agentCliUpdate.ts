/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backends that get the Check update button. Must match the main-process
 * catalog (`process/agentCli/cliCatalog.ts`); the renderer cannot import it.
 */
export const AGENT_CLI_UPDATE_BACKENDS: readonly string[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
  'qwen',
  'openclaw',
  'kiro',
];

/** How an agent CLI is brought up to date. */
export type AgentCliUpdateMethod = 'npm' | 'self' | 'manual';

/** Outcome of checking one agent CLI for a newer release. */
export type AgentCliCheckResult = {
  /** Agent backend id, e.g. `claude`, `codex`. */
  backend: string;
  /** Display name, e.g. `Claude Code`. */
  name: string;
  /** False when the CLI binary is not on PATH. */
  installed: boolean;
  /** Version reported by `<cli> --version`, when parseable. */
  installedVersion?: string;
  /** Latest published version, when the registry could be reached. */
  latestVersion?: string;
  updateAvailable: boolean;
  method: AgentCliUpdateMethod;
  /** Command shown to the user (and run for `npm` / `self`). */
  updateCommand: string;
  /** Epoch ms of this check. */
  checkedAt: number;
};

/** Persisted update-check state, keyed by backend. */
export type AgentCliUpdateState = {
  /** Epoch ms of the last automatic (launch-time) check. */
  lastAutoCheckAt?: number;
  results: Record<string, AgentCliCheckResult>;
};

/** Outcome of running an update. */
export type AgentCliUpdateResult = {
  success: boolean;
  /** Fresh check after the update ran. */
  result?: AgentCliCheckResult;
  /** Last lines of the update command's output, for diagnostics. */
  output?: string;
  error?: string;
};
