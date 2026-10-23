/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Message } from '@arco-design/web-react';
import { Download, Upload } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import PreferenceRow from '../SettingsModal/contents/SystemModalContent/PreferenceRow';
import BackupSummaryModal, { type BackupSummary } from './BackupSummaryModal';
import PasswordPromptModal from './PasswordPromptModal';
import { defaultBackupFileName, importBackupErrorKey, isPaviiBackupPath, isPasswordError } from './backupErrors';

const BACKUP_INFO_KEY = 'pavii-data.backup-info';

/**
 * Settings → System "Backup & restore": shows the automatic backup, exports a portable
 * `.pavii` file and imports one (button or drag-and-drop).
 */
const BackupRestoreSection: React.FC = () => {
  const { t } = useTranslation();
  const { data: info } = useSWR(BACKUP_INFO_KEY, () => ipcBridge.paviiData.getBackupInfo.invoke());

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleExport = useCallback(
    async (password: string | undefined) => {
      setExportOpen(false);
      const fileName = defaultBackupFileName();
      let defaultPath = fileName;
      try {
        const documents = await ipcBridge.application.getPath.invoke({ name: 'documents' });
        if (documents) defaultPath = `${documents}${documents.includes('\\') ? '\\' : '/'}${fileName}`;
      } catch {
        // Fall back to the bare file name; the dialog picks its own folder.
      }
      try {
        const path = await ipcBridge.dialog.showSave.invoke({
          defaultPath,
          filters: [{ name: t('settings.paviiData.fileFilterName'), extensions: ['pavii'] }],
        });
        if (!path) return;
        setExporting(true);
        const result = await ipcBridge.paviiData.exportBackup.invoke({ path, password });
        if (result.success) {
          Message.success(t('settings.paviiData.exportSuccess', { path: result.path }));
        } else {
          Message.error(t('settings.paviiData.exportFailed'));
        }
      } catch {
        Message.error(t('settings.paviiData.exportFailed'));
      } finally {
        setExporting(false);
      }
    },
    [t]
  );

  const handleChooseImport = useCallback(async () => {
    try {
      const files = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile'],
        filters: [{ name: t('settings.paviiData.fileFilterName'), extensions: ['pavii'] }],
      });
      if (files && files[0]) setImportPath(files[0]);
    } catch (error) {
      console.error('[BackupRestoreSection] Failed to open file dialog:', error);
    }
  }, [t]);

  const handleImport = useCallback(
    async (password: string | undefined) => {
      if (!importPath) return;
      setImporting(true);
      try {
        const result = await ipcBridge.paviiData.importBackup.invoke({ path: importPath, password });
        // 'in' narrows the result union (boolean discriminants do not without strictNullChecks).
        if ('error' in result) {
          Message.error(t(importBackupErrorKey(result.error)));
          // Keep the prompt open so a different password can be tried.
          if (!isPasswordError(result.error)) setImportPath(null);
          return;
        }
        setImportPath(null);
        setSummary({ summary: result.summary, secretsRestored: result.secretsRestored });
      } catch {
        Message.error(t(importBackupErrorKey(undefined)));
        setImportPath(null);
      } finally {
        setImporting(false);
      }
    },
    [importPath, t]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const path = window.electronAPI?.getPathForFile?.(file) || '';
      if (!path || !isPaviiBackupPath(path)) {
        Message.warning(t('settings.paviiData.dropInvalid'));
        return;
      }
      setImportPath(path);
    },
    [t]
  );

  const lastSaved = info?.lastAutoSaveAt
    ? new Date(info.lastAutoSaveAt).toLocaleString()
    : t('settings.paviiData.neverSaved');

  return (
    <div
      className={classNames(
        'px-[12px] md:px-[32px] py-16px bg-2 rd-16px border-2 border-dashed transition-colors',
        dragging ? 'border-primary-6' : 'border-transparent'
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid='pavii-backup-section'
    >
      <div className='text-14px font-medium text-t-primary mb-4px'>{t('settings.paviiData.title')}</div>
      <div className='text-12px text-t-secondary mb-8px'>{t('settings.paviiData.description')}</div>

      <div className='w-full flex flex-col divide-y divide-border-2'>
        <PreferenceRow label={t('settings.paviiData.locationLabel')}>
          <span className='text-12px text-t-secondary break-all text-right'>{info?.path ?? ''}</span>
        </PreferenceRow>
        <PreferenceRow label={t('settings.paviiData.lastAutoSaveLabel')}>
          <span className='text-12px text-t-secondary'>{lastSaved}</span>
        </PreferenceRow>
        <PreferenceRow label={t('settings.paviiData.fileLabel')} description={t('settings.paviiData.dropHint')}>
          <div className='flex gap-8px'>
            <Button
              size='small'
              icon={<Upload theme='outline' size='14' />}
              loading={exporting}
              onClick={() => setExportOpen(true)}
            >
              {t('settings.paviiData.exportButton')}
            </Button>
            <Button size='small' icon={<Download theme='outline' size='14' />} onClick={handleChooseImport}>
              {t('settings.paviiData.importButton')}
            </Button>
          </div>
        </PreferenceRow>
      </div>

      <PasswordPromptModal
        visible={exportOpen}
        title={t('settings.paviiData.exportTitle')}
        hint={t('settings.paviiData.exportPasswordHint')}
        okText={t('settings.paviiData.exportContinue')}
        requireConfirm
        onOk={(password) => void handleExport(password)}
        onCancel={() => setExportOpen(false)}
      />
      <PasswordPromptModal
        visible={importPath !== null}
        title={t('settings.paviiData.importTitle')}
        hint={t('settings.paviiData.importPasswordHint')}
        okText={t('settings.paviiData.importContinue')}
        loading={importing}
        onOk={(password) => void handleImport(password)}
        onCancel={() => setImportPath(null)}
      />
      <BackupSummaryModal result={summary} onClose={() => setSummary(null)} />
    </div>
  );
};

export default BackupRestoreSection;
