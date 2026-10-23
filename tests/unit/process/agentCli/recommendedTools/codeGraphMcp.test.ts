/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the built-in code-graph MCP wrapper
 * (process/resources/builtinMcp/codeGraphMcp.ts). The module exports nothing
 * and runs `main()` on import, so each test sets `process.argv`, re-imports
 * the module with an in-memory `node:fs`, a fake `spawn`, a fake build runner
 * and a controllable readline, then inspects what it served or launched.
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECOMMENDED_TOOLS_ENV } from '@/common/types/agent/recommendedTools';

type FakeChild = EventEmitter & { kill: ReturnType<typeof vi.fn> };

const h = vi.hoisted(() => ({
  /** File path → mtimeMs. */
  files: new Map<string, number>(),
  /** Directory path → entries. */
  dirs: new Map<string, string[]>(),
  runFileMock: vi.fn(),
  spawnMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  lines: undefined as unknown as import('node:events').EventEmitter | undefined,
  now: 10_000,
}));

vi.mock('node:fs', () => {
  const fake = {
    statSync: (file: string) => {
      const mtimeMs = h.files.get(file);
      if (mtimeMs === undefined) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
      return { isFile: () => true, mtimeMs };
    },
    readdirSync: (dir: string) => {
      const entries = h.dirs.get(dir);
      if (!entries) throw Object.assign(new Error(`ENOENT: ${dir}`), { code: 'ENOENT' });
      return entries;
    },
    existsSync: (file: string) => h.files.has(file),
    mkdirSync: (...args: unknown[]) => h.mkdirSyncMock(...args),
    writeFileSync: (file: string, ...rest: unknown[]) => {
      h.writeFileSyncMock(file, ...rest);
      h.files.set(file, h.now);
    },
  };
  return { ...fake, default: fake };
});

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => h.spawnMock(...args),
  default: { spawn: (...args: unknown[]) => h.spawnMock(...args) },
}));

vi.mock('node:readline', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  const createInterface = () => {
    h.lines = new Emitter();
    return h.lines;
  };
  return { createInterface, default: { createInterface } };
});

vi.mock('@pavii/web-host', async () => {
  const nodePath = await import('node:path');
  return {
    getManagedToolsDir: (dataDir: string) => nodePath.join(dataDir, 'managed-tools'),
    getManagedToolsPathEntries: (dataDir: string) => [
      nodePath.join(dataDir, 'managed-tools', 'node_modules', '.bin'),
      nodePath.join(dataDir, 'managed-tools', 'bin'),
    ],
  };
});

vi.mock('@process/agentCli/recommendedTools/run', () => ({
  runFile: (...args: unknown[]) => h.runFileMock(...args),
}));

const originalPlatform = process.platform;
const originalArgv = process.argv;
const originalOn = process.on.bind(process);

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

const DATA_DIR = path.resolve('/pavii-data');
const WORKSPACE = path.resolve('/repos/app');
const toolsDir = (dataDir = DATA_DIR) => path.join(dataDir, 'managed-tools');
const uvBin = (name: string, dataDir = DATA_DIR) => path.join(toolsDir(dataDir), 'uv-bin', name);
const trailShim = (shim: string, dataDir = DATA_DIR) => path.join(toolsDir(dataDir), 'bin', shim);

/** Graph dir the wrapper should use, computed with the same rule (lowercase on win32). */
const graphDir = (workspace: string, toolId: string, dataDir = DATA_DIR) => {
  const resolved = path.resolve(workspace);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return path.join(dataDir, 'code-graphs', hash, toolId);
};
const stampOf = (dir: string) => path.join(dir, '.pavii-build-stamp');

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let signalHandlers: Map<string, () => void>;
let child: FakeChild;

/** Let pending promise chains settle (all mocks resolve as microtasks). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Run the wrapper with `node codeGraphMcp.js ...args`. */
const runWrapper = async (...args: string[]) => {
  process.argv = ['node', 'codeGraphMcp.js', ...args];
  vi.resetModules();
  await import('@process/resources/builtinMcp/codeGraphMcp');
  await flush();
};

/** JSON-RPC messages written to stdout. */
const responses = () =>
  stdoutSpy.mock.calls
    .map(([chunk]) => String(chunk))
    .filter((chunk) => chunk.startsWith('{'))
    .map((chunk) => JSON.parse(chunk) as Record<string, unknown>);

const stderrText = () => stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join('');

const sendLine = (line: string) => {
  if (!h.lines) throw new Error('no-tools server is not listening');
  h.lines.emit('line', line);
};

/** Assert the wrapper fell back to the empty MCP server and launched nothing. */
const expectNoToolsServer = (serverName: string) => {
  expect(h.spawnMock).not.toHaveBeenCalled();
  expect(h.lines).toBeDefined();
  sendLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  sendLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  expect(responses()).toEqual([
    {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: '1.0.0' },
      },
    },
    { jsonrpc: '2.0', id: 2, result: { tools: [] } },
  ]);
};

const addCodeBase = (workspace = WORKSPACE, entries = ['.git', 'src']) => {
  h.dirs.set(workspace, entries);
};
const installTrail = (shim: string, dataDir = DATA_DIR) => {
  h.files.set(trailShim(shim, dataDir), 1);
};

beforeEach(() => {
  h.files.clear();
  h.dirs.clear();
  h.lines = undefined;
  h.now = 10_000;
  h.runFileMock.mockReset();
  h.runFileMock.mockResolvedValue({ code: 0, output: '', timedOut: false });
  h.mkdirSyncMock.mockReset();
  h.writeFileSyncMock.mockReset();
  child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  h.spawnMock.mockReset();
  h.spawnMock.mockReturnValue(child);
  setPlatform('linux');
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  signalHandlers = new Map();
  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
    if (event === 'SIGINT' || event === 'SIGTERM') {
      signalHandlers.set(event, handler);
      return process;
    }
    return originalOn(event as never, handler as never);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(originalPlatform);
  process.argv = originalArgv;
});

describe('codeGraphMcp no-tools server', () => {
  it('answers initialize, tools/list and ping for an unknown tool and launches nothing', async () => {
    await runWrapper('bogus', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).not.toHaveBeenCalled();
    expect(h.spawnMock).not.toHaveBeenCalled();
    expect(stderrText()).toContain('usage: codeGraphMcp <trail|headroom|graphify>');

    sendLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
    );
    sendLine(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'tools/list' }));
    sendLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }));
    expect(responses()).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'pavii-bogus', version: '1.0.0' },
        },
      },
      { jsonrpc: '2.0', id: 'a', result: { tools: [] } },
      { jsonrpc: '2.0', id: 3, result: {} },
    ]);
  });

  it('rejects other methods with -32601 and bad JSON with -32700, and ignores notifications', async () => {
    await runWrapper('bogus', DATA_DIR);

    sendLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    sendLine(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call' }));
    sendLine(JSON.stringify({ jsonrpc: '2.0', id: 5 }));
    sendLine('{not json');
    expect(responses()).toEqual([
      { jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Method not found: tools/call' } },
      { jsonrpc: '2.0', id: 5, error: { code: -32601, message: 'Method not found: ' } },
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
    ]);
  });

  it('exits with code 0 when stdin closes', async () => {
    await runWrapper('bogus', DATA_DIR);
    h.lines?.emit('close');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('serves no tools when the data dir argument is missing', async () => {
    await runWrapper('trail');
    expect(h.runFileMock).not.toHaveBeenCalled();
    expectNoToolsServer('pavii-trail');
  });

  it('names the server pavii-unknown when no arguments are given', async () => {
    await runWrapper();
    expectNoToolsServer('pavii-unknown');
  });
});

describe('codeGraphMcp code-map tool gating', () => {
  it.each(['trail', 'graphify'])('serves no tools for %s without a workspace', async (toolId) => {
    installTrail('trail');
    h.files.set(uvBin('graphify'), 1);
    h.files.set(uvBin('graphify-mcp'), 1);

    await runWrapper(toolId, DATA_DIR);

    expect(h.runFileMock).not.toHaveBeenCalled();
    expectNoToolsServer(`pavii-${toolId}`);
  });

  it('serves no tools when the workspace is not a code base', async () => {
    installTrail('trail');
    addCodeBase(WORKSPACE, ['notes.txt', 'photo.png', 'README.md']);

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).not.toHaveBeenCalled();
    expectNoToolsServer('pavii-trail');
  });

  it('serves no tools when the workspace cannot be read', async () => {
    installTrail('trail');

    await runWrapper('trail', DATA_DIR, path.resolve('/does/not/exist'));

    expect(h.runFileMock).not.toHaveBeenCalled();
    expectNoToolsServer('pavii-trail');
  });

  it.each([
    '.git',
    'package.json',
    'Cargo.toml',
    'pyproject.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'composer.json',
    'Gemfile',
    'App.csproj',
    'Solution.SLN',
  ])('treats a folder containing %s as a code base', async (marker) => {
    installTrail('trail');
    addCodeBase(WORKSPACE, ['notes.txt', marker]);

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).toHaveBeenCalledOnce();
    expect(h.spawnMock).toHaveBeenCalledOnce();
  });

  it('serves no tools when Trail is not installed', async () => {
    addCodeBase();

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).not.toHaveBeenCalled();
    expectNoToolsServer('pavii-trail');
  });

  it('serves no tools when graphify-mcp is missing even though graphify is installed', async () => {
    addCodeBase();
    h.files.set(uvBin('graphify'), 1);

    await runWrapper('graphify', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).not.toHaveBeenCalled();
    expectNoToolsServer('pavii-graphify');
  });
});

describe('codeGraphMcp Trail launch', () => {
  it('builds the graph outside the workspace, stamps it, then serves Trail MCP (linux)', async () => {
    installTrail('trail');
    addCodeBase();
    const dir = graphDir(WORKSPACE, 'trail');
    const trail = trailShim('trail');

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.mkdirSyncMock).toHaveBeenCalledWith(dir, { recursive: true });
    expect(h.runFileMock).toHaveBeenCalledWith(
      trail,
      ['--dir', dir, 'build', '--no-gitignore', '--no-ignore', WORKSPACE],
      { timeoutMs: 5 * 60_000, env: {} }
    );
    expect(h.writeFileSyncMock).toHaveBeenCalledWith(stampOf(dir), expect.any(String));
    expect(h.spawnMock).toHaveBeenCalledWith(trail, ['--dir', dir, 'mcp', WORKSPACE], {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: expect.objectContaining(RECOMMENDED_TOOLS_ENV),
    });
    expect(dir.startsWith(path.join(DATA_DIR, 'code-graphs'))).toBe(true);
    expect(dir.startsWith(WORKSPACE)).toBe(false);
  });

  it('does not quote paths with spaces when no shell is used (linux)', async () => {
    const dataDir = path.resolve('/pavii data');
    const workspace = path.resolve('/my repos/app');
    installTrail('trail', dataDir);
    addCodeBase(workspace);

    await runWrapper('trail', dataDir, workspace);

    const [file, args, options] = h.spawnMock.mock.calls[0] as [string, string[], { shell: boolean }];
    expect(file).toBe(trailShim('trail', dataDir));
    expect(args).toEqual(['--dir', graphDir(workspace, 'trail', dataDir), 'mcp', workspace]);
    expect(options.shell).toBe(false);
  });

  it('launches trail.cmd through a shell with quoted paths on win32', async () => {
    setPlatform('win32');
    const dataDir = path.resolve('/Pavii Data');
    const workspace = path.resolve('/My Repos/app');
    installTrail('trail.cmd', dataDir);
    addCodeBase(workspace);
    const dir = graphDir(workspace, 'trail', dataDir);

    await runWrapper('trail', dataDir, workspace);

    expect(h.runFileMock).toHaveBeenCalledWith(
      trailShim('trail.cmd', dataDir),
      ['--dir', dir, 'build', '--no-gitignore', '--no-ignore', workspace],
      expect.objectContaining({ env: {} })
    );
    expect(h.spawnMock).toHaveBeenCalledWith(
      `"${trailShim('trail.cmd', dataDir)}"`,
      ['--dir', `"${dir}"`, 'mcp', `"${workspace}"`],
      expect.objectContaining({ shell: true, windowsHide: true, stdio: 'inherit' })
    );
  });

  it('ignores a posix trail shim on win32', async () => {
    setPlatform('win32');
    installTrail('trail');
    addCodeBase();

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expectNoToolsServer('pavii-trail');
  });

  it('uses one graph dir per workspace regardless of path case on win32', async () => {
    setPlatform('win32');
    const upper = path.resolve('/Repos/APP');
    const lower = path.resolve('/repos/app');
    expect(graphDir(upper, 'trail')).toBe(graphDir(lower, 'trail'));

    installTrail('trail.cmd');
    addCodeBase(upper);
    await runWrapper('trail', DATA_DIR, upper);

    expect(h.mkdirSyncMock).toHaveBeenCalledWith(graphDir(lower, 'trail'), { recursive: true });
  });

  it('keeps case-different workspaces apart off win32', () => {
    expect(graphDir(path.resolve('/Repos/APP'), 'trail')).not.toBe(graphDir(path.resolve('/repos/app'), 'trail'));
  });
});

describe('codeGraphMcp graphify launch', () => {
  it('builds with GRAPHIFY_OUT in the graph dir and serves graphify-mcp on graph.json', async () => {
    addCodeBase(WORKSPACE, ['pyproject.toml']);
    h.files.set(uvBin('graphify'), 1);
    h.files.set(uvBin('graphify-mcp'), 1);
    const dir = graphDir(WORKSPACE, 'graphify');

    await runWrapper('graphify', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).toHaveBeenCalledWith(uvBin('graphify'), ['update', WORKSPACE], {
      timeoutMs: 5 * 60_000,
      env: { GRAPHIFY_OUT: dir },
    });
    expect(h.spawnMock).toHaveBeenCalledWith(
      uvBin('graphify-mcp'),
      [path.join(dir, 'graph.json')],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({ ...RECOMMENDED_TOOLS_ENV, GRAPHIFY_OUT: dir }),
      })
    );
  });

  it('looks for .exe launchers on win32 and spawns them without a shell', async () => {
    setPlatform('win32');
    addCodeBase();
    h.files.set(uvBin('graphify.exe'), 1);
    h.files.set(uvBin('graphify-mcp.exe'), 1);

    await runWrapper('graphify', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).toHaveBeenCalledWith(uvBin('graphify.exe'), ['update', WORKSPACE], expect.anything());
    expect(h.spawnMock).toHaveBeenCalledWith(
      uvBin('graphify-mcp.exe'),
      [path.join(graphDir(WORKSPACE, 'graphify'), 'graph.json')],
      expect.objectContaining({ shell: false })
    );
  });
});

describe('codeGraphMcp Headroom launch', () => {
  it('serves headroom mcp serve without building and ignores the workspace', async () => {
    h.files.set(uvBin('headroom'), 1);
    addCodeBase();

    await runWrapper('headroom', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).not.toHaveBeenCalled();
    expect(h.spawnMock).toHaveBeenCalledWith(uvBin('headroom'), ['mcp', 'serve'], {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: expect.objectContaining(RECOMMENDED_TOOLS_ENV),
    });
  });

  it('serves headroom even without a workspace or in a non-code folder', async () => {
    h.files.set(uvBin('headroom'), 1);
    h.dirs.set(WORKSPACE, ['notes.txt']);

    await runWrapper('headroom', DATA_DIR, WORKSPACE);
    expect(h.spawnMock).toHaveBeenCalledOnce();

    h.spawnMock.mockClear();
    await runWrapper('headroom', DATA_DIR);
    expect(h.spawnMock).toHaveBeenCalledOnce();
  });

  it('serves no tools when Headroom is not installed', async () => {
    await runWrapper('headroom', DATA_DIR);
    expectNoToolsServer('pavii-headroom');
  });
});

describe('codeGraphMcp rebuild decision', () => {
  const dir = () => graphDir(WORKSPACE, 'trail');
  const gitFile = (name: string) => path.join(WORKSPACE, '.git', name);

  beforeEach(() => {
    installTrail('trail');
    addCodeBase();
  });

  it('skips the build when the stamp is newer than .git/index and .git/HEAD', async () => {
    h.files.set(stampOf(dir()), 500);
    h.files.set(gitFile('index'), 400);
    h.files.set(gitFile('HEAD'), 300);

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).not.toHaveBeenCalled();
    expect(h.mkdirSyncMock).not.toHaveBeenCalled();
    expect(h.spawnMock).toHaveBeenCalledOnce();
  });

  it('rebuilds when .git/index is newer than the stamp', async () => {
    h.files.set(stampOf(dir()), 500);
    h.files.set(gitFile('index'), 600);
    h.files.set(gitFile('HEAD'), 300);

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).toHaveBeenCalledOnce();
    expect(h.writeFileSyncMock).toHaveBeenCalledWith(stampOf(dir()), expect.any(String));
    expect(h.spawnMock).toHaveBeenCalledOnce();
  });

  it('rebuilds when only .git/HEAD is newer than the stamp', async () => {
    h.files.set(stampOf(dir()), 500);
    h.files.set(gitFile('index'), 100);
    h.files.set(gitFile('HEAD'), 501);

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).toHaveBeenCalledOnce();
  });

  it('does not rebuild when the stamp has the same mtime as .git/index', async () => {
    h.files.set(stampOf(dir()), 500);
    h.files.set(gitFile('index'), 500);

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).not.toHaveBeenCalled();
  });

  it('builds once and then reuses the graph in a folder without .git', async () => {
    addCodeBase(WORKSPACE, ['package.json']);

    await runWrapper('trail', DATA_DIR, WORKSPACE);
    expect(h.runFileMock).toHaveBeenCalledOnce();

    h.runFileMock.mockClear();
    await runWrapper('trail', DATA_DIR, WORKSPACE);
    expect(h.runFileMock).not.toHaveBeenCalled();
    expect(h.spawnMock).toHaveBeenCalledTimes(2);
  });

  it('serves no tools and logs when the first build fails', async () => {
    h.runFileMock.mockResolvedValue({ code: 2, output: 'boom', timedOut: true });

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.writeFileSyncMock).not.toHaveBeenCalled();
    expect(stderrText()).toContain('graph build failed (code 2, timed out): boom');
    expectNoToolsServer('pavii-trail');
  });

  it('serves the stale graph when a rebuild fails but an earlier build exists', async () => {
    h.files.set(stampOf(dir()), 500);
    h.files.set(gitFile('index'), 900);
    h.runFileMock.mockResolvedValue({ code: 1, output: 'parse error', timedOut: false });

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(h.runFileMock).toHaveBeenCalledOnce();
    expect(h.writeFileSyncMock).not.toHaveBeenCalled();
    expect(stderrText()).toContain('graph build failed (code 1): parse error');
    expect(h.spawnMock).toHaveBeenCalledWith(trailShim('trail'), ['--dir', dir(), 'mcp', WORKSPACE], expect.anything());
  });

  it('falls back to no tools when preparing the graph dir throws unexpectedly', async () => {
    h.mkdirSyncMock.mockImplementation(() => {
      throw new Error('EACCES');
    });

    await runWrapper('trail', DATA_DIR, WORKSPACE);

    expect(stderrText()).toContain('unexpected error: EACCES');
    expectNoToolsServer('pavii-trail');
  });
});

describe('codeGraphMcp child process lifecycle', () => {
  beforeEach(async () => {
    h.files.set(uvBin('headroom'), 1);
    await runWrapper('headroom', DATA_DIR);
  });

  it('forwards SIGINT and SIGTERM to the MCP server', () => {
    signalHandlers.get('SIGINT')?.();
    signalHandlers.get('SIGTERM')?.();
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGINT');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGTERM');
  });

  it('exits with the MCP server exit code', () => {
    child.emit('exit', 3);
    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  it('exits with 1 when the MCP server ends without a code', () => {
    child.emit('exit', null);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs and exits with 1 when the MCP server cannot start', () => {
    child.emit('error', new Error('ENOENT'));
    expect(stderrText()).toContain(`failed to start ${uvBin('headroom')}: ENOENT`);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
