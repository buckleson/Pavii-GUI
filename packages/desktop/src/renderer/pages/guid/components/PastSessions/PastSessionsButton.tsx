/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { History } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isElectronDesktop } from '@/renderer/utils/platform';
import PastSessionsDrawer from './PastSessionsDrawer';

type PastSessionsButtonProps = {
  /** The selected workspace folder; the button renders nothing without one, or outside the desktop app. */
  folder: string;
};

/** Entry point next to the new-chat workspace selector for past sessions in that folder. */
const PastSessionsButton: React.FC<PastSessionsButtonProps> = ({ folder }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Reading CLI session files and importing them happens in the desktop main process.
  if (!folder || !isElectronDesktop()) return null;

  return (
    <>
      <Button
        type='text'
        size='mini'
        icon={<History theme='outline' size='12' />}
        onClick={() => setOpen(true)}
        data-testid='past-sessions-btn'
      >
        {t('conversation.paviiData.pastSessions.button')}
      </Button>
      <PastSessionsDrawer visible={open} folder={folder} onClose={() => setOpen(false)} />
    </>
  );
};

export default PastSessionsButton;
