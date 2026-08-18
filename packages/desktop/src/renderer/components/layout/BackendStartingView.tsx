/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Typography } from '@arco-design/web-react';
import brandLogo from '@renderer/assets/logos/brand/app.png';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissSplash } from '@renderer/utils/ui/splash';

/**
 * Full-screen, benign "backend is still starting" view. Shown while the backend
 * process is alive but not yet ready (reason `backend_startup_pending_slow`).
 *
 * Visually continues the index.html launch splash (same mark + ring classes,
 * defined globally in index.html) so a slow engine start reads as a longer
 * splash rather than a different screen; the inline splash is dismissed on
 * mount since this view takes over.
 *
 * This is intentionally NOT an error modal: it carries no report / download /
 * restart buttons and no reinstall / antivirus / missing-resource copy — the
 * backend binary exists and was observed listening, so such guidance would be
 * misleading. The top-level gate unmounts this view as soon as the backend
 * becomes ready (switching to the App) or the process exits (switching to the
 * honest-failure view). System-level quit (window close, tray, Cmd+Q) stays
 * available at the OS/main-process layer, so no in-view exit control is needed.
 */
const BackendStartingView: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    dismissSplash();
  }, []);

  return (
    <div
      className='min-h-screen bg-base flex flex-col items-center justify-center gap-18px'
      data-testid='backend-starting-view'
    >
      <div className='pavii-splash-mark'>
        <img src={brandLogo} alt='' />
      </div>
      <div className='text-center px-24px max-w-480px'>
        <Typography.Title heading={5} className='mb-8px text-t-1'>
          {t('common.backendStartup.pendingSlow.title')}
        </Typography.Title>
        <Typography.Paragraph className='mb-0 text-t-secondary' data-testid='backend-starting-description'>
          {t('common.backendStartup.pendingSlow.description')}
        </Typography.Paragraph>
      </div>
    </div>
  );
};

export default BackendStartingView;
