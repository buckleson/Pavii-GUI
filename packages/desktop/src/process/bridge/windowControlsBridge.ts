/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Window Controls Bridge Module
 *
 * Handles window minimize, maximize, close and other control operations
 */

import { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { getCloseToTrayEnabled, getIsQuitting } from '@process/utils/tray';

/**
 * Resolve the window targeted by title-bar controls.
 * Prefer the focused window; fall back to the first live window so Linux
 * frameless close still works when focus is momentarily lost.
 */
function resolveControlWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  const fallback = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  return fallback ?? null;
}

/**
 * Register maximize state listeners for a specific window
 *
 * @param window BrowserWindow instance to listen to
 */
export function registerWindowMaximizeListeners(window: BrowserWindow): void {
  // Notify renderer when window is maximized
  window.on('maximize', () => {
    ipcBridge.windowControls.maximizedChanged.emit({ is_maximized: true });
  });

  // Notify renderer when window is unmaximized
  window.on('unmaximize', () => {
    ipcBridge.windowControls.maximizedChanged.emit({ is_maximized: false });
  });
}

/**
 * Initialize window controls bridge
 *
 * Register IPC handlers to respond to window control requests from renderer process
 */
export function initWindowControlsBridge(): void {
  // Minimize window
  ipcBridge.windowControls.minimize.provider(() => {
    const window = resolveControlWindow();
    if (window) {
      window.minimize();
    }
    return Promise.resolve();
  });

  // Maximize window
  ipcBridge.windowControls.maximize.provider(() => {
    const window = resolveControlWindow();
    if (window) {
      window.maximize();
    }
    return Promise.resolve();
  });

  // Unmaximize window
  ipcBridge.windowControls.unmaximize.provider(() => {
    const window = resolveControlWindow();
    if (window) {
      window.unmaximize();
    }
    return Promise.resolve();
  });

  // Close window
  // Custom title-bar close (Linux frameless, etc.) goes through this IPC path.
  // Honor close-to-tray here so we hide instead of destroying the window —
  // relying only on the BrowserWindow 'close' interceptor is not enough on
  // all Linux desktop environments when the close originates from renderer IPC.
  ipcBridge.windowControls.close.provider(() => {
    const window = resolveControlWindow();
    if (!window) {
      return Promise.resolve();
    }
    if (getCloseToTrayEnabled() && !getIsQuitting()) {
      window.hide();
    } else {
      window.close();
    }
    return Promise.resolve();
  });

  // Get window maximized state
  ipcBridge.windowControls.isMaximized.provider(() => {
    const window = resolveControlWindow();
    return Promise.resolve(window?.isMaximized() ?? false);
  });

  // Register listeners for all existing windows
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach((window) => {
    registerWindowMaximizeListeners(window);
  });
}
