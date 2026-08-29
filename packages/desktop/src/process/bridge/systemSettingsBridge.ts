/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System Settings Bridge Module
 *
 * Handles read/write operations for system-level settings (e.g. close to tray)
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/utils/initStorage';
import { changeLanguage } from '@process/services/i18n';
import { createOrUpdateTray, destroyTray, setCloseToTrayEnabled } from '@process/utils/tray';
import { readCloseToTraySetting, writeCloseToTraySetting } from '@process/utils/closeToTraySetting';

type LanguageChangeListener = () => void;
let _languageChangeListener: LanguageChangeListener | null = null;

/**
 * Register a listener for language changes (used by main process index.ts)
 */
export function onLanguageChanged(listener: LanguageChangeListener): void {
  _languageChangeListener = listener;
}

export function initSystemSettingsBridge(): void {
  ipcBridge.systemSettings.getCloseToTray.provider(async () => readCloseToTraySetting());

  ipcBridge.systemSettings.setCloseToTray.provider(async ({ enabled }) => {
    await writeCloseToTraySetting(enabled);
    setCloseToTrayEnabled(enabled);
    if (enabled) {
      createOrUpdateTray();
    } else {
      destroyTray();
    }
  });

  // Language change notification, sync main process i18n and notify tray rebuild.
  // Registered on notifyLanguageChanged, not on changeLanguage: the latter is an
  // HTTP method whose `provider` is a no-op, so a handler placed there never runs.
  ipcBridge.systemSettings.notifyLanguageChanged.provider(async ({ language }) => {
    // Tray labels first — this is the visible half, and it is cheap.
    _languageChangeListener?.();

    // Update main process i18n (non-blocking – don't let a hang here block the provider)
    changeLanguage(language).catch((error) => {
      console.error('[SystemSettings] Main process changeLanguage failed:', error);
    });
  });
}
