/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `.pavii` data bridge: past CLI sessions per folder and the portable backup.
 * The services are imported on first use so registering these handlers costs
 * nothing at launch. Failures become typed results; logs never carry secrets.
 */

import { ipcBridge } from '@/common';

const loadSessions = () => import('./externalSessions');
const loadBackup = () => import('./backup');
const loadOffer = () => import('./restoreOffer');

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * After a restore: when it came from the default backup, mark that backup as
 * handled (rewriting it now would drop its encrypted secrets); otherwise save
 * the restored profile to the default location right away.
 */
async function afterSuccessfulImport(importedPath: string, defaultPath: string): Promise<void> {
  try {
    const { normalizeFolder } = await import('./claudeSessions');
    if (normalizeFolder(importedPath) === normalizeFolder(defaultPath)) {
      await (await loadOffer()).dismissRestoreOffer();
      return;
    }
    const { runBackupAutoSave } = await import('./scheduleAutoSave');
    await runBackupAutoSave({ force: true });
  } catch (error) {
    console.warn('[PaviiData] post-restore save failed:', errorMessage(error));
  }
}

export function initPaviiDataBridge(): void {
  ipcBridge.paviiData.listExternalSessions.provider(async ({ folder }) => {
    try {
      return await (await loadSessions()).listExternalSessions(folder);
    } catch (error) {
      console.warn('[PaviiData] listing past sessions failed:', errorMessage(error));
      return {
        sessions: [],
        unavailable: [
          { backend: 'claude', reason: errorMessage(error) },
          { backend: 'codex', reason: errorMessage(error) },
        ],
        paviiSessions: [],
      };
    }
  });

  ipcBridge.paviiData.importExternalSession.provider(async (params) => {
    try {
      return await (await loadSessions()).importExternalSession(params);
    } catch (error) {
      console.warn('[PaviiData] session import failed:', errorMessage(error));
      return { success: false, error: 'import-failed', message: errorMessage(error) };
    }
  });

  ipcBridge.paviiData.exportBackup.provider(async (params) => {
    try {
      return await (await loadBackup()).exportBackup(params ?? {});
    } catch (error) {
      console.warn('[PaviiData] backup export failed:', errorMessage(error));
      return { success: false, error: 'collect-failed', message: errorMessage(error) };
    }
  });

  ipcBridge.paviiData.importBackup.provider(async (params) => {
    try {
      const backup = await loadBackup();
      const result = await backup.importBackup(params);
      if (result.success) void afterSuccessfulImport(params.path, backup.getDefaultBackupPath());
      return result;
    } catch (error) {
      console.warn('[PaviiData] backup import failed:', errorMessage(error));
      return { success: false, error: 'read-failed', message: errorMessage(error) };
    }
  });

  ipcBridge.paviiData.getRestoreOffer.provider(async () => {
    try {
      return await (await loadOffer()).getRestoreOffer();
    } catch (error) {
      console.warn('[PaviiData] restore offer check failed:', errorMessage(error));
      return null;
    }
  });

  ipcBridge.paviiData.dismissRestoreOffer.provider(async () => {
    try {
      await (await loadOffer()).dismissRestoreOffer();
    } catch (error) {
      console.warn('[PaviiData] dismissing restore offer failed:', errorMessage(error));
    }
  });

  ipcBridge.paviiData.getBackupInfo.provider(async () => (await loadOffer()).getBackupInfo());
}
