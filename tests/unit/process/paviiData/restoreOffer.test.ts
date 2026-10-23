/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Launch-time restore offer: shown for an empty profile or a different
 * account, never for a dismissed backup, plus dismissal and backup info.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpRequest, backup, config } = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  backup: { getDefaultBackupPath: vi.fn(), readAccountUid: vi.fn(), readBackupMeta: vi.fn() },
  config: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpRequest,
}));
vi.mock('@process/paviiData/backup', () => backup);
vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: config }));

import {
  dismissRestoreOffer,
  getBackupInfo,
  getRestoreOffer,
  LAST_AUTO_SAVE_KEY,
} from '@process/paviiData/restoreOffer';

const META = {
  createdAt: '2026-05-01T00:00:00.000Z',
  accountUid: 'uid-old',
  hasSecrets: true,
  counts: { providers: 2, agents: 1 },
};
let profile: { providers: unknown; agents: unknown; conversations: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  backup.getDefaultBackupPath.mockReturnValue('/docs/Pavii/backup.pavii');
  backup.readBackupMeta.mockResolvedValue(META);
  backup.readAccountUid.mockResolvedValue('uid-old');
  config.get.mockResolvedValue(undefined);
  config.set.mockResolvedValue(undefined);
  profile = { providers: [], agents: [{ id: 'b', agent_source: 'builtin' }], conversations: { items: [] } };
  httpRequest.mockImplementation(async (_method: string, url: string) => {
    if (url === '/api/providers') return profile.providers;
    if (url === '/api/agents/management') return profile.agents;
    if (url === '/api/conversations?limit=1') return profile.conversations;
    throw new Error(`unexpected ${url}`);
  });
});

describe('getRestoreOffer', () => {
  it('returns null when there is no default backup', async () => {
    backup.readBackupMeta.mockResolvedValue(null);

    await expect(getRestoreOffer()).resolves.toBeNull();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('returns null when this backup was dismissed', async () => {
    config.get.mockResolvedValue(META.createdAt);

    await expect(getRestoreOffer()).resolves.toBeNull();
    expect(config.get).toHaveBeenCalledWith('paviiData.restoreDismissedFor');
  });

  it('offers a newer backup even after an older one was dismissed', async () => {
    config.get.mockResolvedValue('2020-01-01T00:00:00.000Z');

    await expect(getRestoreOffer()).resolves.toMatchObject({ reason: 'empty-profile' });
  });

  it('offers an empty-profile restore with path, secrets flag and counts', async () => {
    await expect(getRestoreOffer()).resolves.toEqual({
      path: '/docs/Pavii/backup.pavii',
      createdAt: META.createdAt,
      hasSecrets: true,
      counts: META.counts,
      reason: 'empty-profile',
    });
  });

  it('treats a profile with a custom agent as non-empty', async () => {
    profile.agents = [{ id: 'c', agent_source: 'custom' }];

    await expect(getRestoreOffer()).resolves.toBeNull();
  });

  it('treats a profile with a conversation list (array shape) as non-empty', async () => {
    profile.conversations = [{ id: 'c1' }];

    await expect(getRestoreOffer()).resolves.toBeNull();
  });

  it("offers 'new-account' when a different account signs into a non-empty profile", async () => {
    profile.providers = [{ id: 'p' }];
    backup.readAccountUid.mockResolvedValue('uid-new');

    await expect(getRestoreOffer()).resolves.toMatchObject({ reason: 'new-account' });
  });

  it('returns null for the same account on a non-empty profile', async () => {
    profile.providers = [{ id: 'p' }];

    await expect(getRestoreOffer()).resolves.toBeNull();
  });

  it('returns null when nobody is signed in on a non-empty profile', async () => {
    profile.providers = [{ id: 'p' }];
    backup.readAccountUid.mockRejectedValue(new Error('no session'));

    await expect(getRestoreOffer()).resolves.toBeNull();
  });

  it('treats an unreadable dismissal setting as not dismissed', async () => {
    config.get.mockRejectedValue(new Error('storage broken'));

    await expect(getRestoreOffer()).resolves.toMatchObject({ reason: 'empty-profile' });
  });

  it('rejects when the engine cannot be queried', async () => {
    httpRequest.mockRejectedValue(new Error('engine down'));

    await expect(getRestoreOffer()).rejects.toThrow('engine down');
  });
});

describe('dismissRestoreOffer', () => {
  it('remembers the createdAt of the current backup', async () => {
    await dismissRestoreOffer();

    expect(config.set).toHaveBeenCalledWith('paviiData.restoreDismissedFor', META.createdAt);
  });

  it('stores nothing when there is no backup', async () => {
    backup.readBackupMeta.mockResolvedValue(null);

    await dismissRestoreOffer();

    expect(config.set).not.toHaveBeenCalled();
  });
});

describe('getBackupInfo', () => {
  it('returns the default path and the last auto-save time', async () => {
    config.get.mockResolvedValue(1234);

    await expect(getBackupInfo()).resolves.toEqual({ path: '/docs/Pavii/backup.pavii', lastAutoSaveAt: 1234 });
    expect(config.get).toHaveBeenCalledWith(LAST_AUTO_SAVE_KEY);
  });

  it('omits lastAutoSaveAt when it was never saved or cannot be read', async () => {
    config.get.mockRejectedValue(new Error('broken'));

    await expect(getBackupInfo()).resolves.toEqual({ path: '/docs/Pavii/backup.pavii' });
  });
});
