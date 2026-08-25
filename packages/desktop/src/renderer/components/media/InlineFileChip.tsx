/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Message } from '@arco-design/web-react';
import { Copy, FileDisplayOne, FolderOpen } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A document path an agent wrote in chat, with three small actions.
 *
 * Deliberately not a viewer: a docx/pptx/pdf is best opened by the app the
 * user already has, so Open hands the file to the OS default via the existing
 * `/api/fs/open-system` route. "Click here" reveals the file selected in the
 * OS file manager (`/api/shell/show-item-in-folder`) so the user can find it
 * on disk, and the copy button puts the location on the clipboard.
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

  const reveal = useCallback(() => {
    ipcBridge.shell.showItemInFolder.invoke(path).catch((error) => {
      console.warn('[InlineFileChip] Failed to reveal file:', { path, error });
      messageApi.error(t('messages.revealFileFailed', { defaultValue: 'Could not open File Explorer' }));
    });
  }, [path, messageApi, t]);

  const copy = useCallback(() => {
    copyText(path)
      .then(() => messageApi.success(t('messages.filePathCopied', { defaultValue: 'File location copied' })))
      .catch(() => messageApi.error(t('common.copyFailed', { defaultValue: 'Copy failed' })));
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
        type='text'
        onClick={reveal}
        style={{ color: 'var(--electric-violet)' }}
        data-testid='inline-file-reveal'
      >
        {t('messages.revealFile', { defaultValue: 'Click here' })}
      </Button>
      <Button
        size='mini'
        type='secondary'
        onClick={copy}
        icon={<Copy theme='outline' size='13' />}
        title={t('messages.copyFilePath', { defaultValue: 'Copy file location' })}
        data-testid='inline-file-copy'
      />
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
