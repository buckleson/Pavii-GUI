/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * application.getPath: 'documents' comes from Electron (it can be relocated,
 * e.g. by OneDrive); the other names resolve from the home folder.
 */

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = (params?: unknown) => Promise<unknown>;

const { providers, getPath } = vi.hoisted(() => ({
  providers: new Map<string, Provider>(),
  getPath: vi.fn(),
}));

vi.mock('electron', () => ({ app: { getPath } }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fake = { ...actual, homedir: () => '/home/tester' };
  return { ...fake, default: fake };
});
vi.mock('@/common', () => {
  const providerFor = (name: string) => ({
    provider: (fn: Provider) => {
      providers.set(name, fn);
    },
  });
  return {
    ipcBridge: {
      fs: { listSkillFiles: providerFor('listSkillFiles'), readSkillFile: providerFor('readSkillFile') },
      application: { updateSystemInfo: providerFor('updateSystemInfo'), getPath: providerFor('getPath') },
    },
  };
});
vi.mock('@process/services/skills', () => ({ createSkillFileService: () => ({ list: vi.fn(), read: vi.fn() }) }));
vi.mock('@process/utils/initStorage', () => ({ getSystemDir: vi.fn(), ProcessEnv: { set: vi.fn() } }));
vi.mock('@process/utils', () => ({
  copyDirectoryRecursively: vi.fn(),
  getConfigPath: vi.fn(),
  getDataPath: vi.fn(),
  resolveCliSafePath: vi.fn(),
}));

import { initApplicationBridgeCore } from '@process/bridge/applicationBridgeCore';

const getPathProvider = (name: string) => (providers.get('getPath') as Provider)({ name });

beforeEach(() => {
  vi.clearAllMocks();
  providers.clear();
  getPath.mockReturnValue('/onedrive/Documents');
  initApplicationBridgeCore();
});

describe('application.getPath', () => {
  it("asks Electron for 'documents'", async () => {
    await expect(getPathProvider('documents')).resolves.toBe('/onedrive/Documents');
    expect(getPath).toHaveBeenCalledWith('documents');
  });

  it('resolves desktop and downloads from the home folder without Electron', async () => {
    await expect(getPathProvider('desktop')).resolves.toBe(path.join('/home/tester', 'Desktop'));
    await expect(getPathProvider('downloads')).resolves.toBe(path.join('/home/tester', 'Downloads'));
    expect(getPath).not.toHaveBeenCalled();
  });

  it('falls back to the home folder for an unknown name', async () => {
    await expect(getPathProvider('nonsense')).resolves.toBe('/home/tester');
  });

  it('rejects when Electron cannot resolve documents', async () => {
    getPath.mockImplementation(() => {
      throw new Error('no documents dir');
    });

    await expect(async () => getPathProvider('documents')).rejects.toThrow('no documents dir');
  });
});
