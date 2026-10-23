/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Native dialogs used by the backup UI: open forwards file filters, save
 * resolves to the chosen path or undefined when cancelled.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = (params?: unknown) => Promise<unknown>;

const { providers, dialog, BrowserWindow } = vi.hoisted(() => ({
  providers: new Map<string, Provider>(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(), getAllWindows: vi.fn() },
}));

vi.mock('electron', () => ({ dialog, BrowserWindow }));
vi.mock('@/common', () => {
  const providerFor = (name: string) => ({
    provider: (fn: Provider) => {
      providers.set(name, fn);
    },
  });
  return { ipcBridge: { dialog: { showOpen: providerFor('showOpen'), showSave: providerFor('showSave') } } };
});

import { initDialogBridge } from '@process/bridge/dialogBridge';

const FOCUSED = { id: 'focused' };
const FILTERS = [{ name: 'Pavii backup', extensions: ['pavii'] }];
const call = (name: string, params?: unknown) => (providers.get(name) as Provider)(params);

beforeEach(() => {
  vi.clearAllMocks();
  providers.clear();
  BrowserWindow.getFocusedWindow.mockReturnValue(FOCUSED);
  BrowserWindow.getAllWindows.mockReturnValue([]);
  initDialogBridge();
});

describe('dialog.showOpen', () => {
  it('forwards filters to the native open dialog on the focused window', async () => {
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/in/a.pavii'] });

    const result = await call('showOpen', { defaultPath: '/in', properties: ['openFile'], filters: FILTERS });

    expect(result).toEqual(['/in/a.pavii']);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(FOCUSED, {
      defaultPath: '/in',
      properties: ['openFile'],
      filters: FILTERS,
    });
  });

  it('opens an unparented dialog when no window exists', async () => {
    BrowserWindow.getFocusedWindow.mockReturnValue(null);
    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(call('showOpen')).resolves.toEqual([]);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({
      defaultPath: undefined,
      properties: undefined,
      filters: undefined,
    });
  });
});

describe('dialog.showSave', () => {
  it('returns the chosen path and forwards defaultPath and filters', async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/b.pavii' });

    const result = await call('showSave', { defaultPath: '/out/backup.pavii', filters: FILTERS });

    expect(result).toBe('/out/b.pavii');
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(FOCUSED, { defaultPath: '/out/backup.pavii', filters: FILTERS });
  });

  it('falls back to the first window when none is focused', async () => {
    const first = { id: 'first' };
    BrowserWindow.getFocusedWindow.mockReturnValue(null);
    BrowserWindow.getAllWindows.mockReturnValue([first]);
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/x' });

    await call('showSave');

    expect(dialog.showSaveDialog.mock.calls[0][0]).toBe(first);
  });

  it('returns undefined when the user cancels', async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '/ignored' });

    await expect(call('showSave', {})).resolves.toBeUndefined();
  });

  it('returns undefined when no path comes back', async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '' });

    await expect(call('showSave', {})).resolves.toBeUndefined();
  });

  it('rejects when the native dialog fails', async () => {
    dialog.showSaveDialog.mockRejectedValue(new Error('dialog crashed'));

    await expect(call('showSave', {})).rejects.toThrow('dialog crashed');
  });
});
