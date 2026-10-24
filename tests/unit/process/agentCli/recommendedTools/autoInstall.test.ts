/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the automatic background install: which tools it picks
 * (missing ones, failures retried only after an app update) and when it
 * tells the renderer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendedToolId } from '@/common/types/agent/recommendedTools';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getRecords: vi.fn(),
  install: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('electron', () => ({ app: { getVersion: () => '2.3.0' } }));
vi.mock('@/common', () => ({ ipcBridge: { recommendedTools: { autoInstallFinished: { emit: mocks.emit } } } }));
vi.mock('@process/agentCli/recommendedTools/status', () => ({ getRecommendedToolStatus: mocks.getStatus }));
vi.mock('@process/agentCli/recommendedTools/install', () => ({
  getInstallRecords: mocks.getRecords,
  installRecommendedTools: mocks.install,
}));

import { runRecommendedToolsAutoInstall, selectAutoInstallTools } from '@process/agentCli/recommendedTools/autoInstall';

const installedMap = (entries: Array<[RecommendedToolId, boolean]>) => new Map(entries);

describe('selectAutoInstallTools', () => {
  it('skips tools that are already installed', () => {
    const installed = installedMap([
      ['trail', true],
      ['headroom', false],
    ]);
    expect(selectAutoInstallTools(installed, {}, '2.3.0')).toEqual(['headroom']);
  });

  it('skips a tool that already failed with this app version', () => {
    const records = { reach: { appVersion: '2.3.0', success: false, error: 'timeout', at: 1 } };
    expect(selectAutoInstallTools(installedMap([['reach', false]]), records, '2.3.0')).toEqual([]);
  });

  it('retries a tool that failed with another app version', () => {
    const records = { reach: { appVersion: '2.2.0', success: false, error: 'timeout', at: 1 } };
    expect(selectAutoInstallTools(installedMap([['reach', false]]), records, '2.3.0')).toEqual(['reach']);
  });

  it('reinstalls a tool whose success record exists but whose files are missing', () => {
    const records = { graphify: { appVersion: '2.3.0', success: true, at: 1 } };
    expect(selectAutoInstallTools(installedMap([['graphify', false]]), records, '2.3.0')).toEqual(['graphify']);
  });

  it('returns nothing for an empty status list', () => {
    expect(selectAutoInstallTools(new Map(), {}, '2.3.0')).toEqual([]);
  });
});

describe('runRecommendedToolsAutoInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.getRecords.mockResolvedValue({});
  });

  it('installs nothing and tells the renderer nothing when every tool is installed', async () => {
    mocks.getStatus.mockReturnValue([{ id: 'trail', installed: true }]);
    await runRecommendedToolsAutoInstall();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('installs the missing tools and sends the result to the renderer', async () => {
    const result = { outcomes: [{ id: 'headroom', success: false, error: 'timeout' }] };
    mocks.getStatus.mockReturnValue([
      { id: 'trail', installed: true },
      { id: 'headroom', installed: false },
    ]);
    mocks.install.mockResolvedValue(result);
    await runRecommendedToolsAutoInstall();
    expect(mocks.install).toHaveBeenCalledWith(['headroom']);
    expect(mocks.emit).toHaveBeenCalledWith(result);
  });

  it('skips a tool that failed with this app version', async () => {
    mocks.getStatus.mockReturnValue([{ id: 'headroom', installed: false }]);
    mocks.getRecords.mockResolvedValue({ headroom: { appVersion: '2.3.0', success: false, error: 'timeout', at: 1 } });
    await runRecommendedToolsAutoInstall();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('sends nothing when the install returned no outcomes (already queued by Retry)', async () => {
    mocks.getStatus.mockReturnValue([{ id: 'headroom', installed: false }]);
    mocks.install.mockResolvedValue({ outcomes: [] });
    await runRecommendedToolsAutoInstall();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('only logs when the install throws', async () => {
    mocks.getStatus.mockReturnValue([{ id: 'headroom', installed: false }]);
    mocks.install.mockRejectedValue(new Error('boom'));
    await expect(runRecommendedToolsAutoInstall()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith('[RecommendedTools] automatic install failed:', expect.any(Error));
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
