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
  getStatus: vi.fn(),
  install: vi.fn(),
  getOffer: vi.fn(),
  dismiss: vi.fn(),
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
        getFirstRunOffer: provider('getFirstRunOffer'),
        dismissFirstRunOffer: provider('dismissFirstRunOffer'),
      },
    },
  };
});

vi.mock('@process/agentCli/recommendedTools/status', () => ({ getRecommendedToolStatus: mocks.getStatus }));
vi.mock('@process/agentCli/recommendedTools/install', () => ({ installRecommendedTools: mocks.install }));
vi.mock('@process/agentCli/recommendedTools/firstRunOffer', () => ({
  getFirstRunOffer: mocks.getOffer,
  dismissFirstRunOffer: mocks.dismiss,
}));

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
  it('returns the service status', async () => {
    mocks.getStatus.mockReturnValue([{ id: 'trail', installed: true, version: '0.25.0' }]);
    await expect(mocks.handlers.getStatus()).resolves.toEqual([{ id: 'trail', installed: true, version: '0.25.0' }]);
  });

  it('reports every tool not installed when the status check throws', async () => {
    mocks.getStatus.mockImplementation(() => {
      throw new Error('fs down');
    });
    await expect(mocks.handlers.getStatus()).resolves.toEqual([
      { id: 'trail', installed: false },
      { id: 'headroom', installed: false },
      { id: 'graphify', installed: false },
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

describe('recommended tools bridge: first-run offer', () => {
  it('returns the service answer', async () => {
    mocks.getOffer.mockResolvedValue(true);
    await expect(mocks.handlers.getFirstRunOffer()).resolves.toBe(true);
  });

  it('does not offer when the check throws', async () => {
    mocks.getOffer.mockRejectedValue(new Error('storage down'));
    await expect(mocks.handlers.getFirstRunOffer()).resolves.toBe(false);
  });

  it('dismisses through the service', async () => {
    mocks.dismiss.mockResolvedValue(undefined);
    await mocks.handlers.dismissFirstRunOffer();
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
  });

  it('logs instead of rejecting when dismissing fails', async () => {
    mocks.dismiss.mockRejectedValue(new Error('disk full'));
    await expect(mocks.handlers.dismissFirstRunOffer()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
