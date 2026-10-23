/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automatic backup: scheduled 45 s after the renderer loads, skipped while a
 * restore offer is pending, and never throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const { exportBackup, getRestoreOffer, config } = vi.hoisted(() => ({
  exportBackup: vi.fn(),
  getRestoreOffer: vi.fn(),
  config: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('@process/paviiData/backup', () => ({ exportBackup }));
vi.mock('@process/paviiData/restoreOffer', () => ({ getRestoreOffer }));
vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: config }));

import { AUTO_SAVE_DELAY_MS, runBackupAutoSave, scheduleBackupAutoSave } from '@process/paviiData/scheduleAutoSave';

const fakeWindow = () => {
  const listeners = new Map<string, () => void>();
  const window = {
    webContents: { once: vi.fn((event: string, cb: () => void) => listeners.set(event, cb)) },
  } as unknown as BrowserWindow;
  return { window, fire: (event: string) => listeners.get(event)?.() };
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exportBackup.mockResolvedValue({ success: true, path: '/p', includesSecrets: false });
  getRestoreOffer.mockResolvedValue(null);
  config.set.mockResolvedValue(undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
});

describe('scheduleBackupAutoSave', () => {
  it('does nothing before the window has finished loading', async () => {
    vi.useFakeTimers();
    const { window } = fakeWindow();

    scheduleBackupAutoSave(window);
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 2);

    expect(exportBackup).not.toHaveBeenCalled();
  });

  it('waits the full delay after did-finish-load', async () => {
    vi.useFakeTimers();
    const { window, fire } = fakeWindow();
    scheduleBackupAutoSave(window);

    fire('did-finish-load');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS - 1);

    expect(AUTO_SAVE_DELAY_MS).toBe(45_000);
    expect(exportBackup).not.toHaveBeenCalled();
  });

  it('saves once the 45 s delay has passed', async () => {
    vi.useFakeTimers();
    const { window, fire } = fakeWindow();
    scheduleBackupAutoSave(window);

    fire('did-finish-load');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    await vi.waitFor(() => expect(exportBackup).toHaveBeenCalledTimes(1));

    expect(window.webContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
  });
});

describe('runBackupAutoSave', () => {
  it('writes a backup without secrets and records the time', async () => {
    await runBackupAutoSave();

    expect(exportBackup).toHaveBeenCalledWith();
    expect(config.set).toHaveBeenCalledWith('paviiData.lastAutoSaveAt', expect.any(Number));
  });

  it('skips the save while a restore offer is pending', async () => {
    getRestoreOffer.mockResolvedValue({ reason: 'empty-profile' });

    await runBackupAutoSave();

    expect(exportBackup).not.toHaveBeenCalled();
  });

  it('saves despite a pending offer when forced', async () => {
    getRestoreOffer.mockResolvedValue({ reason: 'empty-profile' });

    await runBackupAutoSave({ force: true });

    expect(getRestoreOffer).not.toHaveBeenCalled();
    expect(exportBackup).toHaveBeenCalled();
  });

  it('logs a failed export without recording a save time', async () => {
    exportBackup.mockResolvedValue({ success: false, error: 'write-failed', message: 'EPERM' });

    await runBackupAutoSave();

    expect(warn).toHaveBeenCalledWith('[PaviiData] auto-save failed:', 'write-failed', 'EPERM');
    expect(config.set).not.toHaveBeenCalled();
  });

  it('logs instead of throwing when the offer check throws', async () => {
    getRestoreOffer.mockRejectedValue(new Error('engine down'));

    await expect(runBackupAutoSave()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[PaviiData] auto-save failed:', 'engine down');
  });
});
