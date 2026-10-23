/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';

/** Delay after the renderer has loaded, so the check never competes with startup. */
export const AUTO_CHECK_DELAY_MS = 30_000;

/**
 * Schedule the launch-time CLI update check: after the window has finished
 * loading plus {@link AUTO_CHECK_DELAY_MS}, load the update service and let it
 * decide (48h throttle) whether to run. Never awaited on the startup path.
 */
export function scheduleAgentCliAutoCheck(window: BrowserWindow): void {
  window.webContents.once('did-finish-load', () => {
    const timer = setTimeout(() => {
      void import('./cliUpdateService')
        .then((service) => service.runAutoCheck())
        .catch((error: unknown) => console.warn('[AgentCli] auto-check failed:', error));
    }, AUTO_CHECK_DELAY_MS);
    timer.unref?.();
  });
}
