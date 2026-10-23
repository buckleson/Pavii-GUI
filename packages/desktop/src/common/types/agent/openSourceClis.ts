/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How an open-source CLI gets onto the machine:
 * - `npm`: Pavii installs `pkg` into its managed-tools folder.
 * - `npx`: the engine launches it through `npx`, so there is nothing to install.
 * - `docs`: no verified package; the user follows the official install guide.
 */
export type OpenSourceCliInstall = { kind: 'npm'; pkg: string } | { kind: 'npx' } | { kind: 'docs' };

export type OpenSourceCli = {
  /** Engine agent backend id (`agent_metadata.backend`). */
  backend: string;
  repoUrl: string;
  /** SPDX license id, from the GitHub API. */
  license: string;
  docsUrl: string;
  install: OpenSourceCliInstall;
};

/**
 * Open-source agent CLIs shown on the Agents page "Open source" tab, in
 * GitHub-star order. Licenses and stars were read from the GitHub API and npm
 * packages/binaries from registry.npmjs.org; Hermes's npm package is an
 * unofficial wrapper, so it points at the official docs instead.
 */
export const OPEN_SOURCE_CLIS: readonly OpenSourceCli[] = [
  {
    backend: 'openclaw',
    repoUrl: 'https://github.com/openclaw/openclaw',
    license: 'MIT',
    docsUrl: 'https://github.com/openclaw/openclaw#readme',
    install: { kind: 'npm', pkg: 'openclaw' },
  },
  {
    backend: 'hermes',
    repoUrl: 'https://github.com/NousResearch/hermes-agent',
    license: 'MIT',
    docsUrl: 'https://github.com/NousResearch/hermes-agent#readme',
    install: { kind: 'docs' },
  },
  {
    backend: 'opencode',
    repoUrl: 'https://github.com/sst/opencode',
    license: 'MIT',
    docsUrl: 'https://opencode.ai/docs',
    install: { kind: 'npm', pkg: 'opencode-ai' },
  },
  {
    backend: 'codex',
    repoUrl: 'https://github.com/openai/codex',
    license: 'Apache-2.0',
    docsUrl: 'https://github.com/openai/codex#readme',
    install: { kind: 'npm', pkg: '@openai/codex' },
  },
  {
    backend: 'pi',
    repoUrl: 'https://github.com/badlogic/pi-mono',
    license: 'MIT',
    docsUrl: 'https://github.com/badlogic/pi-mono#readme',
    install: { kind: 'npx' },
  },
  {
    backend: 'gemini',
    repoUrl: 'https://github.com/google-gemini/gemini-cli',
    license: 'Apache-2.0',
    docsUrl: 'https://github.com/google-gemini/gemini-cli#readme',
    install: { kind: 'npm', pkg: '@google/gemini-cli' },
  },
  {
    backend: 'goose',
    repoUrl: 'https://github.com/block/goose',
    license: 'Apache-2.0',
    docsUrl: 'https://goose-docs.ai/docs/getting-started/installation',
    install: { kind: 'docs' },
  },
  {
    backend: 'deepagents',
    repoUrl: 'https://github.com/langchain-ai/deepagents',
    license: 'MIT',
    docsUrl: 'https://github.com/langchain-ai/deepagents#readme',
    install: { kind: 'npx' },
  },
  {
    backend: 'qwen',
    repoUrl: 'https://github.com/QwenLM/qwen-code',
    license: 'Apache-2.0',
    docsUrl: 'https://github.com/QwenLM/qwen-code#readme',
    install: { kind: 'npm', pkg: '@qwen-code/qwen-code' },
  },
  {
    backend: 'kilo',
    repoUrl: 'https://github.com/Kilo-Org/kilocode',
    license: 'MIT',
    docsUrl: 'https://kilo.ai/docs',
    install: { kind: 'npx' },
  },
];

export const findOpenSourceCli = (backend: string | undefined): OpenSourceCli | undefined =>
  backend ? OPEN_SOURCE_CLIS.find((cli) => cli.backend === backend) : undefined;

/** Outcome of `ipcBridge.agentCli.install`. */
export type AgentCliInstallResult = {
  success: boolean;
  /** `unknown-cli` | `not-installable` | `npm-missing` | `timeout` | `command-failed` */
  error?: string;
  /** Last lines of npm output, for diagnostics. */
  output?: string;
};
