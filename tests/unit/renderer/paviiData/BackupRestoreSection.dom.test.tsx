/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const { messageSuccess, messageWarning, messageError } = vi.hoisted(() => ({
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn(),
}));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: { success: messageSuccess, warning: messageWarning, error: messageError },
  };
});

const bridge = vi.hoisted(() => ({
  getBackupInfo: vi.fn(),
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
  getPath: vi.fn(),
  showSave: vi.fn(),
  showOpen: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    paviiData: {
      getBackupInfo: { invoke: bridge.getBackupInfo },
      exportBackup: { invoke: bridge.exportBackup },
      importBackup: { invoke: bridge.importBackup },
    },
    application: { getPath: { invoke: bridge.getPath } },
    dialog: {
      showSave: { invoke: bridge.showSave },
      showOpen: { invoke: bridge.showOpen },
    },
  },
}));

import BackupRestoreSection from '@/renderer/components/settings/PaviiBackup/BackupRestoreSection';

const SAVED_PATH = 'C:\\Users\\me\\Documents\\out.pavii';
const OPENED_PATH = 'D:\\backups\\old.pavii';
const LAST_SAVE = 1_700_000_000_000;
const SUMMARY = [{ section: 'providers', restored: 2, skipped: 1, failed: 0 }];

const renderSection = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BackupRestoreSection />
    </SWRConfig>
  );

const clickButton = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

const typePassword = (testId: string, value: string) => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

const dropFile = (name: string) => {
  const file = new File(['x'], name);
  fireEvent.drop(screen.getByTestId('pavii-backup-section'), { dataTransfer: { files: [file] } });
};

const setElectronPath = (path: string) => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { getPathForFile: () => path };
};

const openExport = async () => {
  renderSection();
  clickButton('settings.paviiData.exportButton');
  await screen.findByText('settings.paviiData.exportTitle');
};

const startImport = async () => {
  renderSection();
  clickButton('settings.paviiData.importButton');
  await screen.findByText('settings.paviiData.importTitle');
};

describe('BackupRestoreSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.getBackupInfo.mockResolvedValue({ path: 'C:\\Users\\me\\.pavii\\backup.pavii', lastAutoSaveAt: LAST_SAVE });
    bridge.getPath.mockResolvedValue('C:\\Users\\me\\Documents');
    bridge.showSave.mockResolvedValue(SAVED_PATH);
    bridge.exportBackup.mockResolvedValue({ success: true, path: SAVED_PATH, includesSecrets: false });
    bridge.showOpen.mockResolvedValue([OPENED_PATH]);
    bridge.importBackup.mockResolvedValue({ success: true, summary: SUMMARY, secretsRestored: false });
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  describe('backup info', () => {
    it('shows the backup path and the formatted last auto-save time', async () => {
      renderSection();
      expect(await screen.findByText('C:\\Users\\me\\.pavii\\backup.pavii')).toBeInTheDocument();
      expect(screen.getByText(new Date(LAST_SAVE).toLocaleString())).toBeInTheDocument();
    });

    it('shows "not saved yet" when there has been no automatic save', async () => {
      bridge.getBackupInfo.mockResolvedValue({ path: 'C:\\b.pavii' });
      renderSection();
      expect(await screen.findByText('C:\\b.pavii')).toBeInTheDocument();
      expect(screen.getByText('settings.paviiData.neverSaved')).toBeInTheDocument();
    });

    it('still renders "not saved yet" when loading the info fails', async () => {
      bridge.getBackupInfo.mockRejectedValue(new Error('boom'));
      renderSection();
      await waitFor(() => expect(bridge.getBackupInfo).toHaveBeenCalled());
      expect(screen.getByText('settings.paviiData.neverSaved')).toBeInTheDocument();
    });
  });

  describe('export', () => {
    it('keeps the continue button disabled while the passwords do not match', async () => {
      await openExport();
      typePassword('pavii-backup-password', 'secret');
      typePassword('pavii-backup-password-confirm', 'other');
      expect(screen.getByRole('button', { name: 'settings.paviiData.exportContinue' })).toBeDisabled();
      expect(screen.getByText('settings.paviiData.passwordMismatch')).toBeInTheDocument();
    });

    it('saves through the .pavii dialog in Documents, then exports with the password', async () => {
      await openExport();
      typePassword('pavii-backup-password', 'secret');
      typePassword('pavii-backup-password-confirm', 'secret');
      clickButton('settings.paviiData.exportContinue');
      await waitFor(() => expect(bridge.exportBackup).toHaveBeenCalledWith({ path: SAVED_PATH, password: 'secret' }));
      expect(bridge.showSave).toHaveBeenCalledWith({
        defaultPath: expect.stringMatching(/^C:\\Users\\me\\Documents\\pavii-backup-\d{4}-\d{2}-\d{2}\.pavii$/),
        filters: [{ name: 'settings.paviiData.fileFilterName', extensions: ['pavii'] }],
      });
      expect(messageSuccess).toHaveBeenCalledWith('settings.paviiData.exportSuccess');
    });

    it('uses a forward slash when the Documents folder is a POSIX path', async () => {
      bridge.getPath.mockResolvedValue('/home/me/Documents');
      await openExport();
      clickButton('settings.paviiData.exportContinue');
      await waitFor(() => expect(bridge.showSave).toHaveBeenCalled());
      expect(bridge.showSave.mock.calls[0][0].defaultPath).toMatch(/^\/home\/me\/Documents\/pavii-backup-/);
    });

    it('exports without a password and with the bare file name when Documents is unavailable', async () => {
      bridge.getPath.mockRejectedValue(new Error('no documents'));
      await openExport();
      clickButton('settings.paviiData.exportContinue');
      await waitFor(() => expect(bridge.exportBackup).toHaveBeenCalledWith({ path: SAVED_PATH, password: undefined }));
      expect(bridge.showSave.mock.calls[0][0].defaultPath).toMatch(/^pavii-backup-\d{4}-\d{2}-\d{2}\.pavii$/);
    });

    it('does not export when the save dialog is cancelled', async () => {
      bridge.showSave.mockResolvedValue(undefined);
      await openExport();
      clickButton('settings.paviiData.exportContinue');
      await waitFor(() => expect(bridge.showSave).toHaveBeenCalled());
      expect(bridge.exportBackup).not.toHaveBeenCalled();
      expect(messageError).not.toHaveBeenCalled();
    });

    it('shows the export-failed message when the export reports a failure', async () => {
      bridge.exportBackup.mockResolvedValue({ success: false, error: 'write-failed' });
      await openExport();
      clickButton('settings.paviiData.exportContinue');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.exportFailed'));
      expect(messageSuccess).not.toHaveBeenCalled();
    });

    it('shows the export-failed message when the export call throws', async () => {
      bridge.exportBackup.mockRejectedValue(new Error('ipc down'));
      await openExport();
      clickButton('settings.paviiData.exportContinue');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.exportFailed'));
    });
  });

  describe('import', () => {
    it('picks a .pavii file, asks for a password, imports and shows the summary', async () => {
      await startImport();
      expect(bridge.showOpen).toHaveBeenCalledWith({
        properties: ['openFile'],
        filters: [{ name: 'settings.paviiData.fileFilterName', extensions: ['pavii'] }],
      });
      clickButton('settings.paviiData.importContinue');
      expect(await screen.findByTestId('pavii-backup-summary')).toBeInTheDocument();
      expect(bridge.importBackup).toHaveBeenCalledWith({ path: OPENED_PATH, password: undefined });
    });

    it('does not open the password prompt when the open dialog is cancelled', async () => {
      bridge.showOpen.mockResolvedValue([]);
      renderSection();
      clickButton('settings.paviiData.importButton');
      await waitFor(() => expect(bridge.showOpen).toHaveBeenCalled());
      expect(screen.queryByText('settings.paviiData.importTitle')).not.toBeInTheDocument();
    });

    it('keeps the prompt open after a wrong password so another can be tried', async () => {
      bridge.importBackup.mockResolvedValue({ success: false, error: 'wrong-password' });
      await startImport();
      typePassword('pavii-backup-password', 'bad');
      clickButton('settings.paviiData.importContinue');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.errors.wrongPassword'));
      expect(bridge.importBackup).toHaveBeenCalledWith({ path: OPENED_PATH, password: 'bad' });
      expect(screen.getByRole('button', { name: 'settings.paviiData.importContinue' })).toBeInTheDocument();
    });

    it('shows the invalid-file message and closes the prompt for a corrupt file', async () => {
      bridge.importBackup.mockResolvedValue({ success: false, error: 'invalid-file' });
      await startImport();
      clickButton('settings.paviiData.importContinue');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.errors.invalidFile'));
      await waitFor(() => expect(screen.queryByText('settings.paviiData.importTitle')).not.toBeInTheDocument());
      expect(screen.queryByTestId('pavii-backup-summary')).not.toBeInTheDocument();
    });

    it('shows the unknown-error message when the import call throws', async () => {
      bridge.importBackup.mockRejectedValue(new Error('ipc down'));
      await startImport();
      clickButton('settings.paviiData.importContinue');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.errors.unknown'));
    });
  });

  describe('drag and drop', () => {
    it('warns and does not import when a non-.pavii file is dropped', () => {
      setElectronPath('C:\\Users\\me\\notes.txt');
      renderSection();
      dropFile('notes.txt');
      expect(messageWarning).toHaveBeenCalledWith('settings.paviiData.dropInvalid');
      expect(screen.queryByText('settings.paviiData.importTitle')).not.toBeInTheDocument();
      expect(bridge.importBackup).not.toHaveBeenCalled();
    });

    it('warns when the dropped file has no resolvable path outside Electron', () => {
      renderSection();
      dropFile('backup.pavii');
      expect(messageWarning).toHaveBeenCalledWith('settings.paviiData.dropInvalid');
    });

    it('starts the import flow for a dropped .pavii file', async () => {
      setElectronPath('C:\\Users\\me\\Backup.PAVII');
      renderSection();
      dropFile('Backup.PAVII');
      await screen.findByText('settings.paviiData.importTitle');
      clickButton('settings.paviiData.importContinue');
      await waitFor(() =>
        expect(bridge.importBackup).toHaveBeenCalledWith({ path: 'C:\\Users\\me\\Backup.PAVII', password: undefined })
      );
      expect(messageWarning).not.toHaveBeenCalled();
    });
  });
});
