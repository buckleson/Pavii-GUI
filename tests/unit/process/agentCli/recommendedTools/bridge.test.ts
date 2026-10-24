/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the recommended tools IPC bridge: each handler delegates to
 * its service and falls back to a safe answer when the service throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (payload?: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, Handler>,
  getStates: vi.fn(),
  setEnabled: vi.fn(),
  install: vi.fn(),
}));

vi.mock('@/common', () => {
  const provider = (name: string) => ({
    provider: (handler: Handler) => {
      mocks.handlers[name] = handler;
    },
  });
  return {
    ipcBridge: {
      recommendedTools: {
        getStatus: provider('getStatus'),
        install: provider('install'),
        setEnabled: provider('setEnabled'),
      },
    },
  };
});

vi.mock('@process/agentCli/recommendedTools/toolState', () => ({
  getRecommendedToolStates: mocks.getStates,
  setRecommendedToolEnabled: mocks.setEnabled,
}));
vi.mock('@process/agentCli/recommendedTools/install', () => ({ installRecommendedTools: mocks.install }));

import { initRecommendedToolsBridge } from '@process/agentCli/recommendedTools/bridge';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  initRecommendedToolsBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recommended tools bridge: getStatus', () => {
  it('returns the tool states', async () => {
    mocks.getStates.mockResolvedValue([{ id: 'trail', installed: true, version: '0.25.0', enabled: true }]);
    await expect(mocks.handlers.getStatus()).resolves.toEqual([
      { id: 'trail', installed: true, version: '0.25.0', enabled: true },
    ]);
  });

  it('reports every tool not installed when the state check throws', async () => {
    mocks.getStates.mockRejectedValue(new Error('fs down'));
    await expect(mocks.handlers.getStatus()).resolves.toEqual([
      { id: 'trail', installed: false },
      { id: 'headroom', installed: false },
      { id: 'graphify', installed: false },
      { id: 'reach', installed: false },
    ]);
  });
});

describe('recommended tools bridge: install', () => {
  it('passes the requested ids to the installer', async () => {
    mocks.install.mockResolvedValue({ outcomes: [{ id: 'headroom', success: true }] });
    await mocks.handlers.install({ tools: ['headroom'] });
    expect(mocks.install).toHaveBeenCalledWith(['headroom']);
  });

  it('reports command-failed for each requested id when the installer throws', async () => {
    mocks.install.mockRejectedValue(new Error('boom'));
    await expect(mocks.handlers.install({ tools: ['trail', 'graphify'] })).resolves.toEqual({
      outcomes: [
        { id: 'trail', success: false, error: 'command-failed' },
        { id: 'graphify', success: false, error: 'command-failed' },
      ],
    });
  });
});

describe('recommended tools bridge: setEnabled', () => {
  it('passes the id and the requested state to the switch', async () => {
    mocks.setEnabled.mockResolvedValue(undefined);
    await mocks.handlers.setEnabled({ id: 'reach', enabled: false });
    expect(mocks.setEnabled).toHaveBeenCalledWith('reach', false);
  });

  it('logs and rejects when switching fails, so the renderer can show an error', async () => {
    mocks.setEnabled.mockRejectedValue(new Error('toggle failed'));
    await expect(mocks.handlers.setEnabled({ id: 'trail', enabled: true })).rejects.toThrow('toggle failed');
    expect(warn).toHaveBeenCalled();
  });
});
