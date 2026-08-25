/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Message } from '@arco-design/web-react';
import { FileDisplayOne, FolderOpen } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A document path an agent wrote in chat, with one small Open button.
 *
 * Deliberately not a viewer: a docx/pptx/pdf is best opened by the app the
 * user already has, so the button hands the file to the OS default via the
 * existing `/api/fs/open-system` route. The path stays visible — it is
 * information, and the whole point was that it used to be ONLY information.
 */
const InlineFileChip: React.FC<{ path: string }> = ({ path }) => {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [messageApi, messageContext] = Message.useMessage();

  const basename = path.split(/[\\/]/).pop() || path;

  const open = useCallback(() => {
    setOpening(true);
    ipcBridge.fs.openSystem
      .invoke({ file: { kind: 'local', path } })
      .catch((error) => {
        console.warn('[InlineFileChip] Failed to open file:', { path, error });
        messageApi.error(t('messages.openFileFailed', { defaultValue: 'Could not open the file' }));
      })
      .finally(() => setOpening(false));
  }, [path, messageApi, t]);

  return (
    <span
      className='inline-flex items-center gap-8px my-4px px-10px py-6px rd-8px border border-[var(--color-border-2)] bg-fill-1 max-w-full'
      data-testid='inline-file-chip'
    >
      {messageContext}
      <FileDisplayOne theme='outline' size='16' className='flex-shrink-0 text-t-secondary' />
      <span className='text-13px text-t-primary truncate' title={path}>
        {basename}
      </span>
      <Button
        size='mini'
        type='secondary'
        loading={opening}
        onClick={open}
        icon={<FolderOpen theme='outline' size='13' />}
        data-testid='inline-file-open'
      >
        {t('messages.openFile', { defaultValue: 'Open' })}
      </Button>
    </span>
  );
};

export default InlineFileChip;
