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
 * A document path an agent wrote in chat, with three small actions:
 * "Click here" reveals the file selected in the OS file manager, the copy
 * button puts the location on the clipboard, and Open hands the file to the
 * OS default app.
 *
 * STYLING CONTRACT: renders inside ShadowView's shadow root, where UnoCSS
 * and Arco styles do not exist — every class here must be defined in
 * ShadowView.tsx (`.pavii-inline-*`).
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
    <span className='pavii-inline-chip' data-testid='inline-file-chip'>
      {messageContext}
      <FileDisplayOne theme='outline' size='16' />
      <span className='pavii-inline-name' title={path}>
        {basename}
      </span>
      <Button
        size='mini'
        type='text'
        className='pavii-inline-btn pavii-inline-btn-accent'
        onClick={reveal}
        data-testid='inline-file-reveal'
      >
        {t('messages.revealFile', { defaultValue: 'Click here' })}
      </Button>
      <Button
        size='mini'
        type='secondary'
        className='pavii-inline-btn'
        onClick={copy}
        icon={<Copy theme='outline' size='13' />}
        title={t('messages.copyFilePath', { defaultValue: 'Copy file location' })}
        data-testid='inline-file-copy'
      />
      <Button
        size='mini'
        type='secondary'
        className='pavii-inline-btn'
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
