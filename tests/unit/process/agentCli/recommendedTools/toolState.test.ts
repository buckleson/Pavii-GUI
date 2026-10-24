/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the Settings → Tools state (installing, last error, on/off)
 * and the per-tool on/off switch, which toggles the tool's builtin MCP row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendedToolId } from '@/common/types/agent/recommendedTools';

const mocks = vi.hoisted(() => ({
  listServers: vi.fn(),
  toggleServer: vi.fn(),
  getStatus: vi.fn(),
  getRecords: vi.fn(),
  getInstalling: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: { listServers: { invoke: mocks.listServers }, toggleServer: { invoke: mocks.toggleServer } },
}));
vi.mock('@process/agentCli/recommendedTools/status', () => ({ getRecommendedToolStatus: mocks.getStatus }));
vi.mock('@process/agentCli/recommendedTools/install', () => ({
  getInstallRecords: mocks.getRecords,
  getInstallingToolIds: mocks.getInstalling,
}));

import { getRecommendedToolStates, setRecommendedToolEnabled } from '@process/agentCli/recommendedTools/toolState';

const row = (name: string, enabled: boolean, builtin = true) => ({ id: `${name}-id`, name, enabled, builtin });
const status = (id: RecommendedToolId, installed: boolean) => ({ id, installed });
const stateOf = async (id: RecommendedToolId) => (await getRecommendedToolStates()).find((state) => state.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.listServers.mockResolvedValue([]);
  mocks.getRecords.mockResolvedValue({});
  mocks.getInstalling.mockReturnValue([]);
  mocks.getStatus.mockReturnValue([
    status('trail', true),
    status('headroom', false),
    status('graphify', false),
    status('reach', true),
  ]);
});

describe('getRecommendedToolStates', () => {
  it('marks a queued or running tool as installing', async () => {
    mocks.getInstalling.mockReturnValue(['headroom']);
    expect(await stateOf('headroom')).toMatchObject({ installing: true });
  });

  it('reports the error of the last failed attempt for a missing tool', async () => {
    mocks.getRecords.mockResolvedValue({ headroom: { appVersion: '1', success: false, error: 'timeout', at: 1 } });
    expect(await stateOf('headroom')).toMatchObject({ lastError: 'timeout' });
  });

  it('falls back to command-failed when a failed record has no error code', async () => {
    mocks.getRecords.mockResolvedValue({ graphify: { appVersion: '1', success: false, at: 1 } });
    expect(await stateOf('graphify')).toMatchObject({ lastError: 'command-failed' });
  });

  it('drops an old failure once the tool is installed', async () => {
    mocks.getRecords.mockResolvedValue({ trail: { appVersion: '1', success: false, error: 'timeout', at: 1 } });
    expect(await stateOf('trail')).not.toHaveProperty('lastError');
  });

  it('reports enabled from the builtin MCP row of an installed tool', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-search', true), row('pavii-code-map', false)]);
    const states = await getRecommendedToolStates();
    expect(states.map((state) => [state.id, state.enabled])).toEqual([
      ['trail', false],
      ['headroom', false],
      ['graphify', false],
      ['reach', true],
    ]);
  });

  it('does not report a user row with the same name as enabled', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-search', true, false)]);
    expect(await stateOf('reach')).toMatchObject({ enabled: false });
  });

  it('reports a not-installed tool as off even when its row is enabled', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-compress', true)]);
    expect(await stateOf('headroom')).toMatchObject({ enabled: false });
  });

  it('reports every tool as off when the MCP rows cannot be listed', async () => {
    mocks.listServers.mockRejectedValue(new Error('ipc down'));
    const states = await getRecommendedToolStates();
    expect(states.map((state) => state.enabled)).toEqual([false, false, false, false]);
  });
});

describe('setRecommendedToolEnabled', () => {
  it('toggles the builtin row when the state changes', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-search', true)]);
    await setRecommendedToolEnabled('reach', false);
    expect(mocks.toggleServer).toHaveBeenCalledWith({ id: 'pavii-search-id' });
  });

  it('turns on an installed tool whose row is off', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-code-map', false)]);
    await setRecommendedToolEnabled('trail', true);
    expect(mocks.toggleServer).toHaveBeenCalledWith({ id: 'pavii-code-map-id' });
  });

  it('does nothing for an unknown tool id', async () => {
    await setRecommendedToolEnabled('nope' as RecommendedToolId, true);
    expect(mocks.listServers).not.toHaveBeenCalled();
    expect(mocks.toggleServer).not.toHaveBeenCalled();
  });

  it('does not turn on a tool that is not installed', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-compress', false)]);
    await setRecommendedToolEnabled('headroom', true);
    expect(mocks.toggleServer).not.toHaveBeenCalled();
  });

  it('can turn off a tool that is not installed', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-compress', true)]);
    await setRecommendedToolEnabled('headroom', false);
    expect(mocks.toggleServer).toHaveBeenCalledWith({ id: 'pavii-compress-id' });
  });

  it('does nothing when the tool has no builtin row', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-search', false, false)]);
    await setRecommendedToolEnabled('reach', true);
    expect(mocks.toggleServer).not.toHaveBeenCalled();
  });

  it('does nothing when the row already has the requested state', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-search', true)]);
    await setRecommendedToolEnabled('reach', true);
    expect(mocks.toggleServer).not.toHaveBeenCalled();
  });

  it('rejects when toggling the row fails', async () => {
    mocks.listServers.mockResolvedValue([row('pavii-search', true)]);
    mocks.toggleServer.mockRejectedValue(new Error('toggle failed'));
    await expect(setRecommendedToolEnabled('reach', false)).rejects.toThrow('toggle failed');
  });
});
