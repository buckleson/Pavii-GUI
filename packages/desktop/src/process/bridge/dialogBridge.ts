/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, dialog } from 'electron';
import { ipcBridge } from '@/common';

/** The focused window, else the first one: dialogs then open in front and modal on Windows. */
const getParentWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

export function initDialogBridge(): void {
  ipcBridge.dialog.showOpen.provider((options) => {
    const parentWindow = getParentWindow();
    const dialogOptions = {
      defaultPath: options?.defaultPath,
      properties: options?.properties,
      filters: options?.filters,
    };

    const showDialogPromise = parentWindow
      ? dialog.showOpenDialog(parentWindow, dialogOptions)
      : dialog.showOpenDialog(dialogOptions);

    return showDialogPromise.then((res) => {
      return res.filePaths;
    });
  });

  ipcBridge.dialog.showSave.provider(async (options) => {
    const parentWindow = getParentWindow();
    const dialogOptions = { defaultPath: options?.defaultPath, filters: options?.filters };
    const res = parentWindow
      ? await dialog.showSaveDialog(parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    return res.canceled || !res.filePath ? undefined : res.filePath;
  });
}
