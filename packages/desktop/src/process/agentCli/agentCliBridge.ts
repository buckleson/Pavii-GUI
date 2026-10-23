/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent CLI bridge: installs, update checks and PATH refresh. The install and
 * update services are imported on first use so registering these handlers
 * costs nothing at launch.
 */

import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import { hydrateWindowsProcessPath } from '@process/startup/windowsPath';

const loadService = () => import('./cliUpdateService');
const loadInstaller = () => import('./installCli');

/**
 * Re-read the user's PATH (on Windows, from the registry, which installers
 * update) and hand it to the engine so it re-detects CLIs installed after
 * launch.
 */
export const refreshAgentPath = async (): Promise<void> => {
  const currentPath = process.platform === 'win32' ? hydrateWindowsProcessPath() : (process.env.PATH ?? '');
  if (!currentPath) return;
  await httpRequest<void>('POST', '/api/agents/refresh-path', { path: currentPath });
};

export function initAgentCliBridge(): void {
  ipcBridge.agentCli.getState.provider(async () => (await loadService()).readState());
  ipcBridge.agentCli.check.provider(async ({ backend }) => (await loadService()).checkCli(backend));
  ipcBridge.agentCli.update.provider(async ({ backend }) => (await loadService()).updateCli(backend));
  ipcBridge.agentCli.checkIfStale.provider(async ({ backend }) => {
    // Fire-and-forget for the caller: starting a conversation must not wait on it.
    void loadService()
      .then((service) => service.checkCliIfStale(backend))
      .catch((error: unknown) => console.warn('[AgentCli] on-use check failed:', error));
  });
  ipcBridge.agentCli.install.provider(async ({ backend }) => {
    try {
      return await (await loadInstaller()).installCli(backend);
    } catch (error) {
      console.warn('[AgentCli] install failed:', error);
      return { success: false, error: 'command-failed' };
    }
  });
  ipcBridge.agentCli.refreshPath.provider(async () => {
    try {
      await refreshAgentPath();
    } catch (error) {
      // Detection still falls back to the engine's startup PATH.
      console.warn('[AgentCli] PATH refresh failed:', error);
    }
  });
}
