/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent CLIs that Pavii.Ai can check for updates.
 *
 * Package names and binaries were verified against the npm registry
 * (`registry.npmjs.org/<pkg>/latest` → `bin`), and self-update commands
 * against each CLI's own `--help` output (claude 2.1.300, codex 0.147.0,
 * opencode 1.18.35). Qwen Code and OpenClaw have no verified self-update
 * command, so they update through npm only. Kiro's updater has not been verified, so it is
 * manual-only (the UI tells the user to use its installer) and has no
 * registry package.
 */
export type CliCatalogEntry = {
  /** Agent backend id as stored by the engine (`agent.backend`). */
  backend: string;
  name: string;
  /** Executable name looked up on PATH. */
  binary: string;
  /** npm package, when the CLI is published there. */
  npmPackage?: string;
  /** Arguments for the CLI's own updater, run as `<binary> ...selfUpdateArgs`. */
  selfUpdateArgs?: string[];
  /** Included in the automatic launch-time / on-use check. */
  autoCheck: boolean;
};

export const CLI_CATALOG: readonly CliCatalogEntry[] = [
  {
    backend: 'claude',
    name: 'Claude Code',
    binary: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    selfUpdateArgs: ['update'],
    autoCheck: true,
  },
  {
    backend: 'codex',
    name: 'Codex CLI',
    binary: 'codex',
    npmPackage: '@openai/codex',
    selfUpdateArgs: ['update'],
    autoCheck: true,
  },
  {
    backend: 'gemini',
    name: 'Gemini CLI',
    binary: 'gemini',
    npmPackage: '@google/gemini-cli',
    autoCheck: true,
  },
  {
    backend: 'opencode',
    name: 'OpenCode',
    binary: 'opencode',
    npmPackage: 'opencode-ai',
    selfUpdateArgs: ['upgrade'],
    autoCheck: true,
  },
  {
    backend: 'qwen',
    name: 'Qwen Code',
    binary: 'qwen',
    npmPackage: '@qwen-code/qwen-code',
    autoCheck: false,
  },
  {
    backend: 'openclaw',
    name: 'OpenClaw',
    binary: 'openclaw',
    npmPackage: 'openclaw',
    autoCheck: false,
  },
  {
    backend: 'kiro',
    name: 'Kiro CLI',
    binary: 'kiro-cli',
    autoCheck: true,
  },
];

export const findCatalogEntry = (backend: string | undefined): CliCatalogEntry | undefined =>
  backend ? CLI_CATALOG.find((entry) => entry.backend === backend) : undefined;
