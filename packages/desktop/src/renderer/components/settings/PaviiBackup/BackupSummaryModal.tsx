/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PaviiBackupSectionSummary } from '@/common/types/agent/paviiData';
import { Button, Modal } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type BackupSummary = {
  summary: PaviiBackupSectionSummary[];
  secretsRestored: boolean;
};

type BackupSummaryModalProps = {
  /** The successful import result to show; null hides the modal. */
  result: BackupSummary | null;
  onClose: () => void;
};

/** Per-section restored / skipped / failed counts after a backup import. */
const BackupSummaryModal: React.FC<BackupSummaryModalProps> = ({ result, onClose }) => {
  const { t } = useTranslation();

  return (
    <Modal
      visible={result !== null}
      title={t('settings.paviiData.summaryTitle')}
      onCancel={onClose}
      footer={
        <Button type='primary' onClick={onClose}>
          {t('common.close')}
        </Button>
      }
      unmountOnExit
    >
      {result && (
        <div className='flex flex-col gap-12px' data-testid='pavii-backup-summary'>
          <div className='flex flex-col divide-y divide-border-2'>
            {result.summary.map((item) => (
              <div key={item.section} className='flex items-center justify-between gap-12px py-8px text-13px'>
                <span className='text-t-primary'>{t(`settings.paviiData.sections.${item.section}`)}</span>
                <span className='flex gap-12px text-t-secondary'>
                  <span>{t('settings.paviiData.summaryRestored', { count: item.restored })}</span>
                  {item.skipped > 0 && <span>{t('settings.paviiData.summarySkipped', { count: item.skipped })}</span>}
                  {item.failed > 0 && (
                    <span className='text-danger'>{t('settings.paviiData.summaryFailed', { count: item.failed })}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className='text-12px text-t-tertiary'>
            {result.secretsRestored
              ? t('settings.paviiData.summarySecretsRestored')
              : t('settings.paviiData.summarySecretsSkipped')}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default BackupSummaryModal;
