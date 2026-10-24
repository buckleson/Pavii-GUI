/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';

/** Delay after the renderer has loaded, so the install never competes with startup. */
export const AUTO_INSTALL_DELAY_MS = 60_000;

/**
 * Schedule the automatic background install of the Pavii agent tools: after
 * the window has finished loading plus {@link AUTO_INSTALL_DELAY_MS}, load the
 * installer and let it decide what to install. Never awaited on the startup path.
 */
export function scheduleRecommendedToolsAutoInstall(window: BrowserWindow): void {
  window.webContents.once('did-finish-load', () => {
    const timer = setTimeout(() => {
      void import('./autoInstall')
        .then((service) => service.runRecommendedToolsAutoInstall())
        .catch((error: unknown) => console.warn('[RecommendedTools] automatic install failed:', error));
    }, AUTO_INSTALL_DELAY_MS);
    timer.unref?.();
  });
}
