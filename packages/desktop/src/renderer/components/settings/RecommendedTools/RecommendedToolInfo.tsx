/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RecommendedTool } from '@/common/types/agent/recommendedTools';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Link, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { toolPurposeKey } from './toolText';

/** Name, license, source link and one-line purpose of a recommended tool. */
const RecommendedToolInfo: React.FC<{ tool: RecommendedTool }> = ({ tool }) => {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col gap-2px min-w-0'>
      <div className='flex items-center gap-8px flex-wrap'>
        <span className='text-14px text-t-primary font-medium'>{tool.name}</span>
        <Tag size='small'>{tool.license}</Tag>
        <Link
          className='text-12px'
          onClick={() => void openExternalUrl(tool.repoUrl)}
          data-testid={`recommended-tool-repo-${tool.id}`}
        >
          {t('settings.recommendedTools.source')}
        </Link>
      </div>
      <div className='text-12px text-t-secondary'>{t(toolPurposeKey(tool.id))}</div>
    </div>
  );
};

export default RecommendedToolInfo;
