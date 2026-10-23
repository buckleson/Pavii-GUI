/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { PaviiBackupSection, RestoreOffer } from '@/common/types/agent/paviiData';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Button, Input, Message, Modal } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BackupSummaryModal, { type BackupSummary } from './BackupSummaryModal';
import { importBackupErrorKey, isPasswordError } from './backupErrors';

/**
 * Launch-time offer to restore a backup when the profile looks fresh or the signed-in
 * account changed. Desktop app only; mounted once in the app layout.
 */
const RestoreOfferDialog: React.FC = () => {
  const { t } = useTranslation();
  const [offer, setOffer] = useState<RestoreOffer | null>(null);
  const [password, setPassword] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [summary, setSummary] = useState<BackupSummary | null>(null);

  useEffect(() => {
    if (!isElectronDesktop()) return;
    let cancelled = false;
    const load = () => {
      ipcBridge.paviiData.getRestoreOffer
        .invoke()
        .then((result) => {
          if (!cancelled && result) setOffer(result);
        })
        .catch((error) => {
          console.error('[RestoreOfferDialog] Failed to load the restore offer:', error);
        });
    };
    load();
    // A sign-in can turn up a backup from another account; check again once it completes.
    const unsubscribe = ipcBridge.deepLink.received.on((payload: { action: string }) => {
      if (payload.action === 'auth/success') load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleNotNow = useCallback(() => {
    setOffer(null);
    ipcBridge.paviiData.dismissRestoreOffer.invoke().catch((error) => {
      console.error('[RestoreOfferDialog] Failed to dismiss the restore offer:', error);
    });
  }, []);

  const handleRestore = useCallback(async () => {
    if (!offer) return;
    setRestoring(true);
    try {
      const result = await ipcBridge.paviiData.importBackup.invoke({
        path: offer.path,
        password: password ? password : undefined,
      });
      // 'in' narrows the result union (boolean discriminants do not without strictNullChecks).
      if ('error' in result) {
        Message.error(t(importBackupErrorKey(result.error)));
        // Keep the dialog open so a different password can be tried.
        if (!isPasswordError(result.error)) setOffer(null);
        return;
      }
      setOffer(null);
      setSummary({ summary: result.summary, secretsRestored: result.secretsRestored });
    } catch {
      Message.error(t(importBackupErrorKey(undefined)));
      setOffer(null);
    } finally {
      setRestoring(false);
    }
  }, [offer, password, t]);

  const counts = offer
    ? (Object.entries(offer.counts) as Array<[PaviiBackupSection, number | undefined]>).filter(
        (entry): entry is [PaviiBackupSection, number] => typeof entry[1] === 'number' && entry[1] > 0
      )
    : [];

  return (
    <>
      <Modal
        visible={offer !== null}
        title={t('settings.paviiData.offer.title')}
        onCancel={handleNotNow}
        maskClosable={false}
        autoFocus={false}
        unmountOnExit
        footer={
          <div className='flex justify-end gap-8px'>
            <Button onClick={handleNotNow} disabled={restoring}>
              {t('settings.paviiData.offer.notNow')}
            </Button>
            <Button type='primary' loading={restoring} onClick={() => void handleRestore()}>
              {t('settings.paviiData.offer.restore')}
            </Button>
          </div>
        }
      >
        {offer && (
          <div className='flex flex-col gap-12px' data-testid='pavii-restore-offer'>
            <div className='text-14px text-t-primary'>
              {offer.reason === 'new-account'
                ? t('settings.paviiData.offer.newAccount')
                : t('settings.paviiData.offer.emptyProfile')}
            </div>
            <div className='text-12px text-t-secondary'>
              {t('settings.paviiData.offer.backupDate', { date: new Date(offer.createdAt).toLocaleString() })}
            </div>
            {counts.length > 0 && (
              <div className='flex flex-col divide-y divide-border-2'>
                {counts.map(([section, count]) => (
                  <div key={section} className='flex items-center justify-between py-6px text-13px'>
                    <span className='text-t-primary'>{t(`settings.paviiData.sections.${section}`)}</span>
                    <span className='text-t-secondary'>{count}</span>
                  </div>
                ))}
              </div>
            )}
            {offer.hasSecrets && (
              <>
                <div className='text-12px text-t-secondary'>{t('settings.paviiData.offer.passwordHint')}</div>
                <Input.Password
                  value={password}
                  onChange={setPassword}
                  placeholder={t('settings.paviiData.passwordPlaceholder')}
                  autoComplete='current-password'
                  data-testid='pavii-restore-password'
                />
              </>
            )}
          </div>
        )}
      </Modal>
      <BackupSummaryModal result={summary} onClose={() => setSummary(null)} />
    </>
  );
};

export default RestoreOfferDialog;
