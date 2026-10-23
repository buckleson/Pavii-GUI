/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Agent CLI bridge: the PATH refresh hands the current PATH to the engine,
 * and the IPC providers delegate to the lazily loaded update and install services.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = (params?: unknown) => Promise<unknown>;

const { providers, httpRequest, hydrateWindowsProcessPath, service, installer } = vi.hoisted(() => ({
  providers: new Map<string, Provider>(),
  httpRequest: vi.fn(),
  hydrateWindowsProcessPath: vi.fn(),
  service: {
    readState: vi.fn(),
    checkCli: vi.fn(),
    updateCli: vi.fn(),
    checkCliIfStale: vi.fn(),
  },
  installer: { installCli: vi.fn() },
}));

vi.mock('@/common', () => {
  const providerFor = (name: string) => ({
    provider: (fn: Provider) => {
      providers.set(name, fn);
    },
  });
  return {
    ipcBridge: {
      agentCli: {
        getState: providerFor('getState'),
        check: providerFor('check'),
        update: providerFor('update'),
        checkIfStale: providerFor('checkIfStale'),
        install: providerFor('install'),
        refreshPath: providerFor('refreshPath'),
      },
    },
  };
});
vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest }));
vi.mock('@process/startup/windowsPath', () => ({ hydrateWindowsProcessPath }));
vi.mock('@process/agentCli/cliUpdateService', () => service);
vi.mock('@process/agentCli/installCli', () => installer);

import { initAgentCliBridge, refreshAgentPath } from '@process/agentCli/agentCliBridge';

const originalPlatform = process.platform;
const originalPath = process.env.PATH;

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

beforeEach(() => {
  vi.clearAllMocks();
  providers.clear();
  httpRequest.mockResolvedValue(undefined);
});

afterEach(() => {
  setPlatform(originalPlatform);
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
});

describe('refreshAgentPath', () => {
  it('posts the process PATH to the engine on macOS/Linux', async () => {
    setPlatform('linux');
    process.env.PATH = '/usr/bin:/opt/new/bin';

    await refreshAgentPath();

    expect(httpRequest).toHaveBeenCalledWith('POST', '/api/agents/refresh-path', { path: '/usr/bin:/opt/new/bin' });
    expect(hydrateWindowsProcessPath).not.toHaveBeenCalled();
  });

  it('posts the registry-hydrated PATH on Windows', async () => {
    setPlatform('win32');
    hydrateWindowsProcessPath.mockReturnValue('C:\\Windows;C:\\Users\\me\\AppData\\Roaming\\npm');

    await refreshAgentPath();

    expect(httpRequest).toHaveBeenCalledWith('POST', '/api/agents/refresh-path', {
      path: 'C:\\Windows;C:\\Users\\me\\AppData\\Roaming\\npm',
    });
  });

  it('sends nothing when the PATH is empty', async () => {
    setPlatform('win32');
    hydrateWindowsProcessPath.mockReturnValue('');

    await refreshAgentPath();

    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('propagates an engine request failure to the caller', async () => {
    setPlatform('linux');
    process.env.PATH = '/usr/bin';
    httpRequest.mockRejectedValue(new Error('engine down'));

    await expect(refreshAgentPath()).rejects.toThrow('engine down');
  });
});

describe('initAgentCliBridge', () => {
  beforeEach(() => {
    setPlatform('linux');
    process.env.PATH = '/usr/bin';
    initAgentCliBridge();
  });

  it('refreshPath posts the PATH to the engine', async () => {
    await providers.get('refreshPath')?.();

    expect(httpRequest).toHaveBeenCalledWith('POST', '/api/agents/refresh-path', { path: '/usr/bin' });
  });

  it('refreshPath swallows engine errors and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    httpRequest.mockRejectedValue(new Error('engine down'));

    await expect(providers.get('refreshPath')?.()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[AgentCli] PATH refresh failed:', expect.any(Error));
  });

  it('check and update delegate to the update service', async () => {
    service.checkCli.mockResolvedValue({ backend: 'claude' });
    service.updateCli.mockResolvedValue({ success: true });

    await expect(providers.get('check')?.({ backend: 'claude' })).resolves.toEqual({ backend: 'claude' });
    await expect(providers.get('update')?.({ backend: 'codex' })).resolves.toEqual({ success: true });
    expect(service.updateCli).toHaveBeenCalledWith('codex');
  });

  it('getState returns the persisted state', async () => {
    service.readState.mockResolvedValue({ results: {} });

    await expect(providers.get('getState')?.()).resolves.toEqual({ results: {} });
  });

  it('checkIfStale returns immediately and logs a failing background check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    service.checkCliIfStale.mockRejectedValue(new Error('spawn failed'));

    await expect(providers.get('checkIfStale')?.({ backend: 'claude' })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[AgentCli] on-use check failed:', expect.any(Error)));
  });

  it('install delegates to the lazily loaded installer', async () => {
    installer.installCli.mockResolvedValue({ success: true });

    await expect(providers.get('install')?.({ backend: 'opencode' })).resolves.toEqual({ success: true });
    expect(installer.installCli).toHaveBeenCalledWith('opencode');
  });

  it('install passes an installer failure result through unchanged', async () => {
    installer.installCli.mockResolvedValue({ success: false, error: 'npm-missing' });

    await expect(providers.get('install')?.({ backend: 'codex' })).resolves.toEqual({
      success: false,
      error: 'npm-missing',
    });
  });

  it('install maps a thrown installer error to command-failed and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installer.installCli.mockRejectedValue(new Error('EPERM'));

    await expect(providers.get('install')?.({ backend: 'codex' })).resolves.toEqual({
      success: false,
      error: 'command-failed',
    });
    expect(warn).toHaveBeenCalledWith('[AgentCli] install failed:', expect.any(Error));
  });
});
