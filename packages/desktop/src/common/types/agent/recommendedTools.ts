/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent tools Pavii offers to install (first-run prompt, Settings → Tools).
 * Versions are pinned; packages and commands were verified on npm / PyPI
 * and in each tool's README. Pavii never runs their global setup commands
 * (`trail init`, `headroom wrap`, `graphify install`): those write
 * `~/.claude*`, `~/.codex` or the user's repo.
 */

export type RecommendedToolId = 'trail' | 'headroom' | 'graphify';

export type RecommendedTool = {
  id: RecommendedToolId;
  name: string;
  /** SPDX license id. */
  license: string;
  repoUrl: string;
  docsUrl: string;
  /** `node`: npm package in managed-tools; `uv`: `uv tool install` with managed uv. */
  runtime: 'node' | 'uv';
  /** npm package spec or PyPI requirement, pinned. */
  packageSpec: string;
  version: string;
  /** Code-map tools are only active in a workspace that looks like a code base. */
  codeBaseOnly: boolean;
  /** Builtin MCP server row name. */
  mcpServerName: string;
};

export const RECOMMENDED_TOOLS: readonly RecommendedTool[] = [
  {
    id: 'trail',
    name: 'Trail-Code',
    license: 'MIT',
    repoUrl: 'https://github.com/trailhq/Trail-Code',
    docsUrl: 'https://github.com/trailhq/Trail-Code#readme',
    runtime: 'node',
    packageSpec: '@trailhq/trail-code@0.25.0',
    version: '0.25.0',
    codeBaseOnly: true,
    mcpServerName: 'pavii-trail',
  },
  {
    id: 'headroom',
    name: 'Headroom',
    license: 'Apache-2.0',
    repoUrl: 'https://github.com/headroomlabs-ai/headroom',
    docsUrl: 'https://github.com/headroomlabs-ai/headroom#readme',
    runtime: 'uv',
    packageSpec: 'headroom-ai[mcp]==0.41.0',
    version: '0.41.0',
    codeBaseOnly: false,
    mcpServerName: 'pavii-headroom',
  },
  {
    id: 'graphify',
    name: 'graphify',
    license: 'Apache-2.0',
    repoUrl: 'https://github.com/Graphify-Labs/graphify',
    docsUrl: 'https://github.com/Graphify-Labs/graphify#readme',
    runtime: 'uv',
    packageSpec: 'graphifyy[mcp]==0.9.95',
    version: '0.9.95',
    codeBaseOnly: true,
    mcpServerName: 'pavii-graphify',
  },
];

/**
 * Telemetry and network switches set on every command Pavii runs for these
 * tools (install, graph build, MCP server). Sources: each tool's README.
 */
export const RECOMMENDED_TOOLS_ENV: Readonly<Record<string, string>> = {
  DO_NOT_TRACK: '1',
  HEADROOM_TELEMETRY: 'off',
  HEADROOM_BEACON: 'off',
  HEADROOM_UPDATE_CHECK: 'off',
  GRAPHIFY_BACKEND: 'none',
  GRAPHIFY_QUERY_LOG_DISABLE: '1',
};

/**
 * Pinned uv for the Python tools: astral-sh/uv release 0.12.24 (2026-10-08).
 * SHA-256 values are the release's published `.sha256` files; the Windows
 * x64 one was also re-hashed locally. Key: `${process.platform}-${process.arch}`.
 */
export const UV_VERSION = '0.12.24';
export const UV_ASSETS: Readonly<Record<string, { file: string; sha256: string }>> = {
  'win32-x64': {
    file: 'uv-x86_64-pc-windows-msvc.zip',
    sha256: '7c38608c8a18ee137d748a1773053b07ec8f3a30fab49aebaa6f4e4efeceb019',
  },
  'win32-arm64': {
    file: 'uv-aarch64-pc-windows-msvc.zip',
    sha256: '4b783bda5cc44bbae0651a837223873a7acee31152381aef5fc86ef6bef25997',
  },
  'darwin-x64': {
    file: 'uv-x86_64-apple-darwin.tar.gz',
    sha256: '4fa82e37cb94767661f532b001e470b67a186c7260e305bd84ddb78fd545c0b6',
  },
  'darwin-arm64': {
    file: 'uv-aarch64-apple-darwin.tar.gz',
    sha256: '0c4346de7abdb49495b393b9ec809fe387aa43e586be20fecb972216c1e71732',
  },
  'linux-x64': {
    file: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    sha256: 'b4dfaef47d491a7296981f8374a4595f55dbf84e8937c8ecd2983574d8bb3da6',
  },
  'linux-arm64': {
    file: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    sha256: '5231be65f496304623895dacdbf1de8504fec90303684bdf05805aa34414dd21',
  },
};

export type RecommendedToolStatus = {
  id: RecommendedToolId;
  installed: boolean;
  /** Installed version, when known. */
  version?: string;
};

export type RecommendedToolInstallOutcome = {
  id: RecommendedToolId;
  success: boolean;
  /** `unsupported-platform` | `download-failed` | `checksum-mismatch` | `npm-missing` | `timeout` | `command-failed` */
  error?: string;
  /** Last lines of tool output, for diagnostics. */
  output?: string;
};

export type InstallRecommendedToolsResult = { outcomes: RecommendedToolInstallOutcome[] };

/** Builtin skill id of the STE100 reply style (excluded per conversation when the setting is off). */
export const STE100_SKILL_NAME = 'ste100-replies';
/** Client preference key of the STE100 switch; absent means on. */
export const STE100_PREF_KEY = 'replyStyle.ste100';
