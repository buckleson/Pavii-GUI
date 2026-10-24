/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IMcpServer, ISessionMcpServer } from '@/common/config/storage';

const { getClientBusinessSettingMock, mcpServiceMock } = vi.hoisted(() => ({
  getClientBusinessSettingMock: vi.fn(),
  mcpServiceMock: {
    listServers: { invoke: vi.fn() },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: getClientBusinessSettingMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: mcpServiceMock,
}));

import { ensureBackendMcpCatalog, toSessionMcpServer, withPaviiToolSessionServers } from '@/renderer/hooks/mcp/catalog';

describe('ensureBackendMcpCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientBusinessSettingMock.mockResolvedValue([]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'user-1',
        name: 'user one',
        enabled: true,
        transport: { type: 'stdio', command: 'user', args: [] },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: false,
      },
    ]);
  });

  it('reads MCP catalog from backend settings without falling back to configService', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'builtin-1',
        name: 'builtin one',
        enabled: true,
        transport: { type: 'stdio', command: 'builtin', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toHaveLength(1);
    expect(result.builtinServers).toHaveLength(1);
    expect(result.allServers).toHaveLength(2);
  });

  it('does not re-import legacy user MCP rows from backend client settings at runtime', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'legacy-user-1',
        name: 'legacy user server',
        enabled: true,
        transport: { type: 'stdio', command: 'legacy-user', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: false,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toEqual([]);
    expect(result.builtinServers).toEqual([]);
    expect(result.allServers).toEqual([]);
  });
});

const stdioRow = (name: string, builtin?: boolean, args: string[] = ['/script.js', name, '/data']) => ({
  id: `${name}-id`,
  name,
  builtin,
  transport: { type: 'stdio' as const, command: 'node', args, env: { DO_NOT_TRACK: '1' } },
});

describe('toSessionMcpServer', () => {
  const WORKSPACE = 'D:\\Repos\\my app';

  it.each(['pavii-code-map', 'pavii-graph'])('appends the custom workspace as the last arg of builtin %s', (name) => {
    expect(toSessionMcpServer(stdioRow(name, true), WORKSPACE)).toEqual({
      id: `${name}-id`,
      name,
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['/script.js', name, '/data', WORKSPACE],
        env: { DO_NOT_TRACK: '1' },
      },
    });
  });

  it('does not mutate the stored row when appending the workspace', () => {
    const row = stdioRow('pavii-code-map', true);
    toSessionMcpServer(row, WORKSPACE);
    expect(row.transport.args).toEqual(['/script.js', 'pavii-code-map', '/data']);
  });

  it('starts a new args list when the builtin row has none', () => {
    const row = stdioRow('pavii-code-map', true);
    const session = toSessionMcpServer({ ...row, transport: { type: 'stdio', command: 'node' } }, WORKSPACE);
    expect(session.transport).toEqual(expect.objectContaining({ args: [WORKSPACE] }));
  });

  it('leaves Headroom unchanged because it does not take a workspace', () => {
    const row = stdioRow('pavii-compress', true);
    expect(toSessionMcpServer(row, WORKSPACE).transport).toBe(row.transport);
  });

  it.each([
    ['a non-pavii builtin row', stdioRow('pavii-browser', true)],
    ['a user row named like a code-map tool', stdioRow('pavii-code-map', false)],
    ['a row without the builtin flag', stdioRow('pavii-graph')],
  ])('leaves %s unchanged', (_label, row) => {
    expect(toSessionMcpServer(row, WORKSPACE).transport).toBe(row.transport);
  });

  it('leaves a non-stdio builtin code-map row unchanged', () => {
    const row = {
      id: 'code-map-http',
      name: 'pavii-code-map',
      builtin: true,
      transport: { type: 'http' as const, url: 'http://localhost:1' },
    };
    expect(toSessionMcpServer(row, WORKSPACE).transport).toBe(row.transport);
  });

  it.each([undefined, ''])('leaves args unchanged when the workspace is %j', (workspace) => {
    const row = stdioRow('pavii-code-map', true);
    expect(toSessionMcpServer(row, workspace).transport).toBe(row.transport);
  });

  it('copies only id, name and transport into the session snapshot', () => {
    const row = { ...stdioRow('user-tool', false), enabled: true, description: 'x' };
    expect(Object.keys(toSessionMcpServer(row))).toEqual(['id', 'name', 'transport']);
  });
});

describe('withPaviiToolSessionServers', () => {
  const WORKSPACE = 'D:\\Repos\\my app';

  /** A stored MCP row; only the fields the helper reads matter. */
  const mcpRow = (name: string, overrides: Partial<IMcpServer> = {}): IMcpServer => ({
    id: `${name}-id`,
    name,
    enabled: true,
    builtin: true,
    transport: { type: 'stdio', command: 'node', args: ['/script.js', name, '/data'] },
    created_at: 1,
    updated_at: 1,
    original_json: '{}',
    ...overrides,
  });

  const session = (name: string): ISessionMcpServer => toSessionMcpServer(mcpRow(name));

  it('adds every enabled builtin Pavii tool row after the selected servers', () => {
    const selected = [session('user-tool')];
    const available = [mcpRow('pavii-compress'), mcpRow('pavii-search', { transport: { type: 'http', url: 'u' } })];
    expect(withPaviiToolSessionServers(selected, available).map((server) => server.name)).toEqual([
      'user-tool',
      'pavii-compress',
      'pavii-search',
    ]);
  });

  it('skips a disabled Pavii row', () => {
    const result = withPaviiToolSessionServers([], [mcpRow('pavii-graph', { enabled: false })]);
    expect(result).toEqual([]);
  });

  it('skips a user row named like a Pavii tool', () => {
    const result = withPaviiToolSessionServers([], [mcpRow('pavii-search', { builtin: false })]);
    expect(result).toEqual([]);
  });

  it('skips a builtin row that is not a Pavii agent tool', () => {
    const result = withPaviiToolSessionServers([], [mcpRow('chrome-devtools')]);
    expect(result).toEqual([]);
  });

  it('does not add a row already selected with the same id', () => {
    const selected = [{ ...session('pavii-compress'), name: 'renamed' }];
    expect(withPaviiToolSessionServers(selected, [mcpRow('pavii-compress')])).toHaveLength(1);
  });

  it('does not add a row whose name is already selected', () => {
    const selected = [{ ...session('pavii-compress'), id: 'other-id' }];
    expect(withPaviiToolSessionServers(selected, [mcpRow('pavii-compress')])).toHaveLength(1);
  });

  it('adds only one row when two rows share a Pavii tool name', () => {
    const available = [mcpRow('pavii-compress'), mcpRow('pavii-compress', { id: 'duplicate-id' })];
    expect(withPaviiToolSessionServers([], available).map((server) => server.id)).toEqual(['pavii-compress-id']);
  });

  it('appends the workspace to the args of an added code-map row', () => {
    const [added] = withPaviiToolSessionServers([], [mcpRow('pavii-code-map')], WORKSPACE);
    expect(added.transport).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['/script.js', 'pavii-code-map', '/data', WORKSPACE],
    });
  });

  it('does not append the workspace to an added Compress row', () => {
    const row = mcpRow('pavii-compress');
    const [added] = withPaviiToolSessionServers([], [row], WORKSPACE);
    expect(added.transport).toBe(row.transport);
  });

  it('returns the same array when nothing is added', () => {
    const selected = [session('user-tool')];
    expect(withPaviiToolSessionServers(selected, [mcpRow('pavii-graph', { enabled: false })])).toBe(selected);
  });

  it('returns the selection unchanged when no rows are available', () => {
    const selected: ISessionMcpServer[] = [];
    expect(withPaviiToolSessionServers(selected, [])).toBe(selected);
  });
});
