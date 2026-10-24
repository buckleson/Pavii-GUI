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
import { Button, Message, Switch, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Settings → Tools: the Pavii agent tools. Each shows its status, an on/off
 * switch (off: agents do not get the tool; installed files stay) and Retry
 * when the last install failed. Tools install automatically at first start.
 */
const RecommendedToolsSection: React.FC = () => {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<RecommendedToolStatus[]>([]);
  const [busy, setBusy] = useState<{ id: RecommendedToolId; action: 'retry' | 'toggle' } | null>(null);

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
    // The automatic install may finish while this page is open.
    return ipcBridge.recommendedTools.autoInstallFinished.on(() => {
      void refresh();
    });
  }, [refresh]);

  const handleRetry = useCallback(
    async (tool: RecommendedTool) => {
      setBusy({ id: tool.id, action: 'retry' });
      try {
        const result = await ipcBridge.recommendedTools.install.invoke({ tools: [tool.id] });
        const outcome = result.outcomes.find((item) => item.id === tool.id);
        if (outcome?.success) {
          Message.success(t('settings.recommendedTools.installedToast', { name: tool.name }));
        } else {
          Message.error(
            t('settings.recommendedTools.installFailedToast', {
              name: tool.name,
              error: t(installErrorKey(outcome?.error)),
            })
          );
        }
      } catch (error) {
        console.error('[RecommendedToolsSection] Retry failed:', error);
        Message.error(
          t('settings.recommendedTools.installFailedToast', { name: tool.name, error: t(installErrorKey(undefined)) })
        );
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh, t]
  );

  const handleToggle = useCallback(
    async (tool: RecommendedTool, enabled: boolean) => {
      setBusy({ id: tool.id, action: 'toggle' });
      try {
        await ipcBridge.recommendedTools.setEnabled.invoke({ id: tool.id, enabled });
      } catch (error) {
        console.error('[RecommendedToolsSection] Switching the tool failed:', error);
        Message.error(t('settings.recommendedTools.toggleFailed', { name: tool.name }));
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh, t]
  );

  const renderStatus = (tool: RecommendedTool, status: RecommendedToolStatus | undefined) => {
    if (status?.installing || (busy?.action === 'retry' && busy.id === tool.id)) {
      return <Tag color='arcoblue'>{t('settings.recommendedTools.installing')}</Tag>;
    }
    if (status?.installed) {
      return (
        <Tag color='green'>
          {status.version
            ? t('settings.recommendedTools.installedVersion', { version: status.version })
            : t('settings.recommendedTools.installed')}
        </Tag>
      );
    }
    if (status?.lastError) {
      return (
        <div className='flex items-center gap-8px'>
          <Tag color='red'>
            {t('settings.recommendedTools.installFailed', { error: t(installErrorKey(status.lastError)) })}
          </Tag>
          <Button
            type='primary'
            size='small'
            disabled={busy !== null}
            onClick={() => void handleRetry(tool)}
            data-testid={`recommended-tool-retry-${tool.id}`}
          >
            {t('settings.recommendedTools.retry')}
          </Button>
        </div>
      );
    }
    return <Tag>{t('settings.recommendedTools.pending')}</Tag>;
  };

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
              <div className='flex-shrink-0 flex items-center gap-12px'>
                {renderStatus(tool, status)}
                <Switch
                  size='small'
                  checked={status?.enabled === true}
                  disabled={!status?.installed || busy !== null}
                  onChange={(checked: boolean) => void handleToggle(tool, checked)}
                  aria-label={t('settings.recommendedTools.toggleLabel', { name: tool.name })}
                  data-testid={`recommended-tool-switch-${tool.id}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RecommendedToolsSection;
