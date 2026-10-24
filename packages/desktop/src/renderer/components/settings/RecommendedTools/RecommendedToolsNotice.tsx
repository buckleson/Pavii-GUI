/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { RECOMMENDED_TOOLS, type InstallRecommendedToolsResult } from '@/common/types/agent/recommendedTools';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Notification } from '@arco-design/web-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const toolNames = (result: InstallRecommendedToolsResult, success: boolean): string =>
  result.outcomes
    .filter((outcome) => outcome.success === success)
    .map((outcome) => RECOMMENDED_TOOLS.find((tool) => tool.id === outcome.id)?.name ?? outcome.id)
    .join(', ');

/**
 * Renders nothing. When the automatic background install of the Pavii agent
 * tools finishes, shows one short non-blocking notice: what installed, and
 * what failed (retry in Settings → Tools). Desktop app only; mounted once in
 * the app layout.
 */
const RecommendedToolsNotice: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isElectronDesktop()) return;
    return ipcBridge.recommendedTools.autoInstallFinished.on((result) => {
      const installed = toolNames(result, true);
      const failed = toolNames(result, false);
      if (failed) {
        Notification.warning({
          title: t('settings.recommendedTools.autoInstallTitle'),
          content: installed
            ? t('settings.recommendedTools.autoInstallPartial', { installed, failed })
            : t('settings.recommendedTools.autoInstallFailed', { failed }),
          duration: 10000,
        });
      } else if (installed) {
        Notification.success({
          title: t('settings.recommendedTools.autoInstallTitle'),
          content: t('settings.recommendedTools.autoInstallDone', { installed }),
          duration: 6000,
        });
      }
    });
  }, [t]);

  return null;
};

export default RecommendedToolsNotice;
