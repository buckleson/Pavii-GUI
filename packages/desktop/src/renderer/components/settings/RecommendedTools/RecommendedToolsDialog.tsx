/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  RECOMMENDED_TOOLS,
  type RecommendedToolId,
  type RecommendedToolInstallOutcome,
} from '@/common/types/agent/recommendedTools';
import { isElectronDesktop, openExternalUrl } from '@/renderer/utils/platform';
import { Button, Checkbox, Link, Modal } from '@arco-design/web-react';
import { CheckOne, CloseOne } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RecommendedToolInfo from './RecommendedToolInfo';
import { installErrorKey } from './toolText';

/** How long the all-success result stays visible before the dialog closes. */
const SUCCESS_CLOSE_DELAY_MS = 2000;

/**
 * First-run offer to install the recommended agent tools. Desktop app only;
 * mounted once in the app layout.
 */
const RecommendedToolsDialog: React.FC = () => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<RecommendedToolId[]>(() => RECOMMENDED_TOOLS.map((tool) => tool.id));
  const [installing, setInstalling] = useState(false);
  const [outcomes, setOutcomes] = useState<RecommendedToolInstallOutcome[] | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isElectronDesktop()) return;
    let cancelled = false;
    ipcBridge.recommendedTools.getFirstRunOffer
      .invoke()
      .then((show) => {
        if (!cancelled && show) setVisible(true);
      })
      .catch((error) => {
        console.error('[RecommendedToolsDialog] Failed to load the first-run offer:', error);
      });
    return () => {
      cancelled = true;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setVisible(false);
    ipcBridge.recommendedTools.dismissFirstRunOffer.invoke().catch((error) => {
      console.error('[RecommendedToolsDialog] Failed to dismiss the first-run offer:', error);
    });
  }, []);

  const toggleTool = useCallback((id: RecommendedToolId, checked: boolean) => {
    setSelected((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }, []);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      const result = await ipcBridge.recommendedTools.install.invoke({ tools: selected });
      setOutcomes(result.outcomes);
      if (result.outcomes.every((outcome) => outcome.success)) {
        closeTimerRef.current = setTimeout(() => setVisible(false), SUCCESS_CLOSE_DELAY_MS);
      }
    } catch (error) {
      console.error('[RecommendedToolsDialog] Install failed:', error);
      setOutcomes(selected.map((id) => ({ id, success: false })));
    } finally {
      setInstalling(false);
    }
  }, [selected]);

  const footer = outcomes ? (
    <div className='flex justify-end'>
      <Button type='primary' onClick={handleClose} data-testid='recommended-tools-close'>
        {t('settings.recommendedTools.close')}
      </Button>
    </div>
  ) : (
    <div className='flex justify-end gap-8px'>
      <Button onClick={handleClose} disabled={installing} data-testid='recommended-tools-not-now'>
        {t('settings.recommendedTools.notNow')}
      </Button>
      <Button
        type='primary'
        loading={installing}
        disabled={selected.length === 0}
        onClick={() => void handleInstall()}
        data-testid='recommended-tools-install'
      >
        {t('settings.recommendedTools.install')}
      </Button>
    </div>
  );

  return (
    <Modal
      visible={visible}
      title={t('settings.recommendedTools.title')}
      onCancel={installing ? undefined : handleClose}
      closable={!installing}
      maskClosable={false}
      autoFocus={false}
      unmountOnExit
      footer={footer}
    >
      <div className='flex flex-col gap-12px' data-testid='recommended-tools-offer'>
        <div className='text-14px text-t-primary'>{t('settings.recommendedTools.description')}</div>
        <div className='flex flex-col divide-y divide-border-2'>
          {RECOMMENDED_TOOLS.map((tool) => {
            const outcome = outcomes?.find((item) => item.id === tool.id);
            return (
              <div
                key={tool.id}
                className='flex items-start gap-12px py-8px'
                data-testid={`recommended-tool-${tool.id}`}
              >
                {!outcomes && (
                  <Checkbox
                    className='mt-2px'
                    checked={selected.includes(tool.id)}
                    disabled={installing}
                    onChange={(checked: boolean) => toggleTool(tool.id, checked)}
                    data-testid={`recommended-tool-checkbox-${tool.id}`}
                  />
                )}
                <div className='flex-1 min-w-0 flex flex-col gap-4px'>
                  <RecommendedToolInfo tool={tool} />
                  {outcome && (
                    <div className='flex flex-col gap-2px text-12px' data-testid={`recommended-tool-result-${tool.id}`}>
                      {outcome.success ? (
                        <span className='flex items-center gap-4px text-success'>
                          <CheckOne theme='filled' size={14} />
                          {t('settings.recommendedTools.installSucceeded')}
                        </span>
                      ) : (
                        <>
                          <span className='flex items-center gap-4px text-danger'>
                            <CloseOne theme='filled' size={14} />
                            {t('settings.recommendedTools.installFailed', { error: t(installErrorKey(outcome.error)) })}
                          </span>
                          <Link className='text-12px' onClick={() => void openExternalUrl(tool.docsUrl)}>
                            {t('settings.recommendedTools.docs')}
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className='text-12px text-t-secondary'>{t('settings.recommendedTools.note')}</div>
      </div>
    </Modal>
  );
};

export default RecommendedToolsDialog;
