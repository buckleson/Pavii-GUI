/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the first-run offer of the recommended tools: shown only
 * when nothing is installed and the user has not dismissed it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendedToolStatus } from '@/common/types/agent/recommendedTools';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), status: vi.fn() }));

vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: { get: mocks.get, set: mocks.set } }));
vi.mock('@process/agentCli/recommendedTools/status', () => ({ getRecommendedToolStatus: mocks.status }));

import { dismissFirstRunOffer, getFirstRunOffer } from '@process/agentCli/recommendedTools/firstRunOffer';

const NONE_INSTALLED: RecommendedToolStatus[] = [
  { id: 'trail', installed: false },
  { id: 'headroom', installed: false },
  { id: 'graphify', installed: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(undefined);
  mocks.set.mockResolvedValue(undefined);
  mocks.status.mockReturnValue(NONE_INSTALLED);
});

describe('getFirstRunOffer', () => {
  it('offers when nothing is installed and the offer was never dismissed', async () => {
    await expect(getFirstRunOffer()).resolves.toBe(true);
  });

  it('does not offer once dismissed, without checking the status', async () => {
    mocks.get.mockResolvedValue(true);
    await expect(getFirstRunOffer()).resolves.toBe(false);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('does not offer when any tool is already installed', async () => {
    mocks.status.mockReturnValue([{ id: 'trail', installed: true, version: '0.25.0' }, ...NONE_INSTALLED.slice(1)]);
    await expect(getFirstRunOffer()).resolves.toBe(false);
  });

  it('still offers when reading the dismissed flag fails', async () => {
    mocks.get.mockRejectedValue(new Error('storage down'));
    await expect(getFirstRunOffer()).resolves.toBe(true);
  });

  it('reads the recommendedTools.firstRunDismissed key', async () => {
    await getFirstRunOffer();
    expect(mocks.get).toHaveBeenCalledWith('recommendedTools.firstRunDismissed');
  });
});

describe('dismissFirstRunOffer', () => {
  it('stores the dismissed flag', async () => {
    await dismissFirstRunOffer();
    expect(mocks.set).toHaveBeenCalledWith('recommendedTools.firstRunDismissed', true);
  });

  it('rejects when the flag cannot be stored', async () => {
    mocks.set.mockRejectedValue(new Error('disk full'));
    await expect(dismissFirstRunOffer()).rejects.toThrow('disk full');
  });
});
