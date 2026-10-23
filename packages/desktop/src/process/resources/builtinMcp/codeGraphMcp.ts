/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in stdio MCP wrapper for the recommended agent tools.
 *
 * Launched as `node codeGraphMcp.js <toolId> <dataDir> [workspace]`. The
 * engine gives a session MCP server no workspace (the stdio spec is only
 * command/args/env), so the renderer appends the conversation's custom
 * workspace as the last argument. For the code-map tools (Trail, graphify) the
 * wrapper builds the graph under `<dataDir>/code-graphs/` (never in the
 * workspace), then hands stdio to the real MCP server. Missing tool, missing
 * workspace, a workspace that is not a code base, or a failed first build →
 * a minimal MCP server with no tools, so the agent just sees nothing.
 *
 * Runs as a plain `node` process: no Electron imports.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getManagedToolsDir, getManagedToolsPathEntries } from '@pavii/web-host';
import {
  RECOMMENDED_TOOLS,
  RECOMMENDED_TOOLS_ENV,
  type RecommendedTool,
  type RecommendedToolId,
} from '@/common/types/agent/recommendedTools';
import { runFile } from '@process/agentCli/recommendedTools/run';

const BUILD_TIMEOUT_MS = 5 * 60_000;
const BUILD_STAMP = '.pavii-build-stamp';
const CODE_BASE_FILES = [
  '.git',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
];
const CODE_BASE_EXTENSIONS = ['.csproj', '.sln'];

type Launch = { file: string; args: string[]; env: Record<string, string> };

const log = (message: string): void => {
  process.stderr.write(`[pavii-code-graph] ${message}\n`);
};

/** Same layout as `getRecommendedToolPaths` in process/agentCli/recommendedTools/paths.ts. */
const toolLayout = (dataDir: string) => {
  const tools = getManagedToolsDir(dataDir);
  return {
    npmBinDirs: getManagedToolsPathEntries(dataDir),
    uvToolBinDir: path.join(tools, 'uv-bin'),
    codeGraphsDir: path.join(dataDir, 'code-graphs'),
  };
};

const exeName = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

const existingFile = (candidates: string[]): string | undefined =>
  candidates.find((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });

const isCodeBase = (workspace: string): boolean => {
  let entries: string[];
  try {
    entries = fs.readdirSync(workspace);
  } catch {
    return false;
  }
  return entries.some(
    (entry) => CODE_BASE_FILES.includes(entry) || CODE_BASE_EXTENSIONS.includes(path.extname(entry).toLowerCase())
  );
};

/** `<codeGraphsDir>/<sha256(normalized workspace) first 16 hex>/<toolId>/`. */
const graphDirFor = (codeGraphsDir: string, workspace: string, toolId: RecommendedToolId): string => {
  const resolved = path.resolve(workspace);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return path.join(codeGraphsDir, hash, toolId);
};

const mtimeMs = (file: string): number | undefined => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

/** Graph needs a build when it was never built, or git state changed after the last build. */
const needsBuild = (graphDir: string, workspace: string): boolean => {
  const built = mtimeMs(path.join(graphDir, BUILD_STAMP));
  if (built === undefined) return true;
  const gitTimes = ['index', 'HEAD']
    .map((name) => mtimeMs(path.join(workspace, '.git', name)))
    .filter((time): time is number => time !== undefined);
  return gitTimes.some((time) => time > built);
};

/** Build (or refresh) the graph. Returns whether a usable graph exists afterwards. */
const ensureGraph = async (build: Launch, graphDir: string, workspace: string): Promise<boolean> => {
  const stampFile = path.join(graphDir, BUILD_STAMP);
  if (!needsBuild(graphDir, workspace)) return true;
  fs.mkdirSync(graphDir, { recursive: true });
  const result = await runFile(build.file, build.args, { timeoutMs: BUILD_TIMEOUT_MS, env: build.env });
  if (result.code === 0) {
    fs.writeFileSync(stampFile, new Date().toISOString());
    return true;
  }
  log(`graph build failed (code ${result.code}${result.timedOut ? ', timed out' : ''}): ${result.output}`);
  // A stale graph is still better than none.
  return fs.existsSync(stampFile);
};

/** Build and serve commands for one tool, or undefined when it cannot run here. */
const resolveLaunches = (
  tool: RecommendedTool,
  dataDir: string,
  workspace: string | undefined
): { build?: Launch; serve: Launch; graphDir?: string } | undefined => {
  const layout = toolLayout(dataDir);
  if (tool.id === 'headroom') {
    const headroom = existingFile([path.join(layout.uvToolBinDir, exeName('headroom'))]);
    return headroom ? { serve: { file: headroom, args: ['mcp', 'serve'], env: {} } } : undefined;
  }
  if (!workspace || !isCodeBase(workspace)) return undefined;
  const graphDir = graphDirFor(layout.codeGraphsDir, workspace, tool.id);
  if (tool.id === 'trail') {
    const shim = process.platform === 'win32' ? 'trail.cmd' : 'trail';
    const trail = existingFile(layout.npmBinDirs.map((dir) => path.join(dir, shim)));
    if (!trail) return undefined;
    return {
      graphDir,
      build: { file: trail, args: ['--dir', graphDir, 'build', '--no-gitignore', '--no-ignore', workspace], env: {} },
      serve: { file: trail, args: ['--dir', graphDir, 'mcp', workspace], env: {} },
    };
  }
  const graphify = existingFile([path.join(layout.uvToolBinDir, exeName('graphify'))]);
  const graphifyMcp = existingFile([path.join(layout.uvToolBinDir, exeName('graphify-mcp'))]);
  if (!graphify || !graphifyMcp) return undefined;
  const env = { GRAPHIFY_OUT: graphDir };
  return {
    graphDir,
    build: { file: graphify, args: ['update', workspace], env },
    serve: { file: graphifyMcp, args: [path.join(graphDir, 'graph.json')], env },
  };
};

/** Minimal MCP server that offers no tools. */
const serveNoTools = (toolId: string): void => {
  const send = (message: object): void => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let request: { id?: string | number | null; method?: string; params?: { protocolVersion?: string } };
    try {
      request = JSON.parse(line) as typeof request;
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (request.id === undefined) return; // notification
    if (request.method === 'initialize') {
      send({
        id: request.id,
        result: {
          protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: `pavii-${toolId}`, version: '1.0.0' },
        },
      });
    } else if (request.method === 'tools/list') {
      send({ id: request.id, result: { tools: [] } });
    } else if (request.method === 'ping') {
      send({ id: request.id, result: {} });
    } else {
      send({ id: request.id, error: { code: -32601, message: `Method not found: ${request.method ?? ''}` } });
    }
  });
  lines.on('close', () => process.exit(0));
};

/** Hand stdio to the real MCP server and exit with its code. */
const execServer = (serve: Launch): void => {
  // Node only spawns a Windows `.cmd` launcher through a shell; quote args with spaces then.
  const useShell = process.platform === 'win32' && /\.cmd$/i.test(serve.file);
  const quote = (value: string) => (useShell && value.includes(' ') ? `"${value}"` : value);
  const child = spawn(quote(serve.file), useShell ? serve.args.map(quote) : serve.args, {
    stdio: 'inherit',
    shell: useShell,
    windowsHide: true,
    env: { ...process.env, ...RECOMMENDED_TOOLS_ENV, ...serve.env },
  });
  const forward = (signal: NodeJS.Signals) => () => {
    child.kill(signal);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('error', (error) => {
    log(`failed to start ${serve.file}: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
};

async function main(): Promise<void> {
  const [toolId, dataDir, workspace] = process.argv.slice(2);
  const tool = RECOMMENDED_TOOLS.find((candidate) => candidate.id === toolId);
  if (!tool || !dataDir) {
    log(`usage: codeGraphMcp <${RECOMMENDED_TOOLS.map((t) => t.id).join('|')}> <dataDir> [workspace]`);
    serveNoTools(toolId ?? 'unknown');
    return;
  }
  const launches = resolveLaunches(tool, dataDir, workspace);
  if (!launches) {
    serveNoTools(tool.id);
    return;
  }
  if (launches.build && launches.graphDir && workspace) {
    const ready = await ensureGraph(launches.build, launches.graphDir, workspace);
    if (!ready) {
      serveNoTools(tool.id);
      return;
    }
  }
  execServer(launches.serve);
}

void main().catch((error: unknown) => {
  log(`unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  serveNoTools(process.argv[2] ?? 'unknown');
});
