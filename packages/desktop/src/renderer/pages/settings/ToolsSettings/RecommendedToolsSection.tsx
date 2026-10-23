/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  RECOMMENDED_TOOLS,
  type RecommendedTool,
  type RecommendedToolId,
  type RecommendedToolStatus,
} from '@/common/types/agent/recommendedTools';
import RecommendedToolInfo from '@/renderer/components/settings/RecommendedTools/RecommendedToolInfo';
import { installErrorKey } from '@/renderer/components/settings/RecommendedTools/toolText';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Button, Message, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Settings → Tools: install status of the recommended agent tools, with per-tool Install. */
const RecommendedToolsSection: React.FC = () => {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<RecommendedToolStatus[]>([]);
  const [installingId, setInstallingId] = useState<RecommendedToolId | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatuses(await ipcBridge.recommendedTools.getStatus.invoke());
    } catch (error) {
      console.error('[RecommendedToolsSection] Failed to load tool status:', error);
      Message.error(t('settings.recommendedTools.statusLoadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showFailure = useCallback(
    (tool: RecommendedTool, error: string | undefined) => {
      Message.error({
        content: (
          <span>
            {t('settings.recommendedTools.installFailedToast', { name: tool.name, error: t(installErrorKey(error)) })}{' '}
            <Button type='text' size='mini' onClick={() => void openExternalUrl(tool.docsUrl)}>
              {t('settings.recommendedTools.docs')}
            </Button>
          </span>
        ),
        duration: 8000,
      });
    },
    [t]
  );

  const handleInstall = useCallback(
    async (tool: RecommendedTool) => {
      setInstallingId(tool.id);
      try {
        const result = await ipcBridge.recommendedTools.install.invoke({ tools: [tool.id] });
        const outcome = result.outcomes.find((item) => item.id === tool.id);
        if (outcome?.success) {
          Message.success(t('settings.recommendedTools.installedToast', { name: tool.name }));
        } else {
          showFailure(tool, outcome?.error);
        }
      } catch (error) {
        console.error('[RecommendedToolsSection] Install failed:', error);
        showFailure(tool, undefined);
      } finally {
        setInstallingId(null);
        await refresh();
      }
    },
    [refresh, showFailure, t]
  );

  return (
    <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px' data-testid='recommended-tools-section'>
      <div className='text-14px text-t-primary font-medium'>{t('settings.recommendedTools.sectionTitle')}</div>
      <div className='text-12px text-t-secondary mt-4px'>{t('settings.recommendedTools.sectionDescription')}</div>
      <div className='flex flex-col divide-y divide-border-2 mt-8px'>
        {RECOMMENDED_TOOLS.map((tool) => {
          const status = statuses.find((item) => item.id === tool.id);
          return (
            <div
              key={tool.id}
              className='flex items-center justify-between gap-16px py-12px'
              data-testid={`recommended-tool-status-${tool.id}`}
            >
              <RecommendedToolInfo tool={tool} />
              <div className='flex-shrink-0'>
                {status?.installed ? (
                  <Tag color='green'>
                    {status.version
                      ? t('settings.recommendedTools.installedVersion', { version: status.version })
                      : t('settings.recommendedTools.installed')}
                  </Tag>
                ) : (
                  <Button
                    type='primary'
                    size='small'
                    loading={installingId === tool.id}
                    disabled={installingId !== null && installingId !== tool.id}
                    onClick={() => void handleInstall(tool)}
                    data-testid={`recommended-tool-install-${tool.id}`}
                  >
                    {t('settings.recommendedTools.install')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RecommendedToolsSection;
