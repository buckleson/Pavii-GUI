/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';

/** Delay after the renderer has loaded, so the save never competes with startup. */
export const AUTO_SAVE_DELAY_MS = 45_000;

/**
 * Write the default backup without secrets and record when it happened.
 * Unless `force` is set, nothing is written while a restore offer for the
 * existing backup is pending: a fresh profile would otherwise overwrite the
 * backup it is about to be offered. The backup modules are loaded on demand;
 * failures are only logged.
 */
export async function runBackupAutoSave(options: { force?: boolean } = {}): Promise<void> {
  try {
    const [{ exportBackup }, { ProcessConfig }, { getRestoreOffer }] = await Promise.all([
      import('./backup'),
      import('@process/utils/initStorage'),
      import('./restoreOffer'),
    ]);
    if (!options.force && (await getRestoreOffer())) return;
    const result = await exportBackup();
    if (result.success === false) {
      console.warn('[PaviiData] auto-save failed:', result.error, result.message ?? '');
      return;
    }
    await ProcessConfig.set('paviiData.lastAutoSaveAt', Date.now());
  } catch (error) {
    console.warn('[PaviiData] auto-save failed:', error instanceof Error ? error.message : error);
  }
}

/** Schedule one automatic backup {@link AUTO_SAVE_DELAY_MS} after the window has finished loading. */
export function scheduleBackupAutoSave(window: BrowserWindow): void {
  window.webContents.once('did-finish-load', () => {
    const timer = setTimeout(() => {
      void runBackupAutoSave();
    }, AUTO_SAVE_DELAY_MS);
    timer.unref?.();
  });
}
