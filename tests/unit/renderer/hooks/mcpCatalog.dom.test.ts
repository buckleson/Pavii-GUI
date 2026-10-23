/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { ensureBackendMcpCatalog, toSessionMcpServer } from '@/renderer/hooks/mcp/catalog';

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

  it.each(['pavii-trail', 'pavii-graphify'])('appends the custom workspace as the last arg of builtin %s', (name) => {
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
    const row = stdioRow('pavii-trail', true);
    toSessionMcpServer(row, WORKSPACE);
    expect(row.transport.args).toEqual(['/script.js', 'pavii-trail', '/data']);
  });

  it('starts a new args list when the builtin row has none', () => {
    const row = stdioRow('pavii-trail', true);
    const session = toSessionMcpServer({ ...row, transport: { type: 'stdio', command: 'node' } }, WORKSPACE);
    expect(session.transport).toEqual(expect.objectContaining({ args: [WORKSPACE] }));
  });

  it('leaves Headroom unchanged because it does not take a workspace', () => {
    const row = stdioRow('pavii-headroom', true);
    expect(toSessionMcpServer(row, WORKSPACE).transport).toBe(row.transport);
  });

  it.each([
    ['a non-pavii builtin row', stdioRow('pavii-browser', true)],
    ['a user row named like a code-map tool', stdioRow('pavii-trail', false)],
    ['a row without the builtin flag', stdioRow('pavii-graphify')],
  ])('leaves %s unchanged', (_label, row) => {
    expect(toSessionMcpServer(row, WORKSPACE).transport).toBe(row.transport);
  });

  it('leaves a non-stdio builtin code-map row unchanged', () => {
    const row = {
      id: 'trail-http',
      name: 'pavii-trail',
      builtin: true,
      transport: { type: 'http' as const, url: 'http://localhost:1' },
    };
    expect(toSessionMcpServer(row, WORKSPACE).transport).toBe(row.transport);
  });

  it.each([undefined, ''])('leaves args unchanged when the workspace is %j', (workspace) => {
    const row = stdioRow('pavii-trail', true);
    expect(toSessionMcpServer(row, workspace).transport).toBe(row.transport);
  });

  it('copies only id, name and transport into the session snapshot', () => {
    const row = { ...stdioRow('user-tool', false), enabled: true, description: 'x' };
    expect(Object.keys(toSessionMcpServer(row))).toEqual(['id', 'name', 'transport']);
  });
});
