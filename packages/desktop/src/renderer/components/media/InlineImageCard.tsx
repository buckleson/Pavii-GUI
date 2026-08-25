/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Image, Message } from '@arco-design/web-react';
import { Copy, Pic } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Inline card for an image an agent referenced by bare file path; the image
 * loads as soon as the card mounts. It owns its own fetch instead of reusing
 * LocalImageView because that component's failure mode is a broken <img> with
 * no error state — a card whose path may point anywhere (or at a since-deleted
 * temp file) needs a visible failure with a retry.
 *
 * Pixels come from the sandboxed `/api/fs/image-base64` endpoint (temp + home
 * + workspace roots). A path outside those roots fails closed into the error
 * state — that is the intended posture, NOT a bug to fix by switching to the
 * unrestricted `/api/fs/content` route.
 */
const InlineImageCard: React.FC<{ path: string }> = ({ path }) => {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [messageApi, messageContext] = Message.useMessage();

  const basename = path.split(/[\\/]/).pop() || path;

  const copy = useCallback(() => {
    copyText(path)
      .then(() => messageApi.success(t('messages.imagePathCopied', { defaultValue: 'Image location copied to clipboard' })))
      .catch(() => messageApi.error(t('common.copyFailed', { defaultValue: 'Copy failed' })));
  }, [path, messageApi, t]);

  const load = useCallback(() => {
    setState('loading');
    ipcBridge.fs.getImageBase64
      .invoke({ path })
      .then((base64) => {
        if (base64) {
          setDataUrl(base64);
          setState('shown');
        } else {
          setState('failed');
        }
      })
      .catch((error) => {
        console.warn('[InlineImageCard] Failed to load image:', { path, error });
        setState('failed');
      });
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === 'shown' && dataUrl) {
    return (
      <span className='block my-8px' data-testid='inline-image-shown'>
        {messageContext}
        <Image src={dataUrl} alt={basename} className='max-w-full rounded-8px' style={{ maxHeight: 420 }} />
        <span className='flex items-center gap-8px mt-4px'>
          <span className='text-12px text-t-tertiary truncate' title={path}>
            {basename}
          </span>
          <Button
            size='mini'
            type='secondary'
            onClick={copy}
            icon={<Copy theme='outline' size='13' />}
            data-testid='inline-image-copy'
          >
            {t('messages.copyImagePath', { defaultValue: 'Click to copy the location' })}
          </Button>
        </span>
      </span>
    );
  }

  return (
    <span
      className='inline-flex items-center gap-8px my-4px px-10px py-6px rd-8px border border-[var(--color-border-2)] bg-fill-1 max-w-full'
      data-testid='inline-image-card'
    >
      <Pic theme='outline' size='16' className='flex-shrink-0 text-t-secondary' />
      <span className='text-13px text-t-primary truncate' title={path}>
        {basename}
      </span>
      {state === 'failed' && (
        <span className='text-12px text-t-tertiary flex-shrink-0'>
          {t('messages.imageLoadFailed', { defaultValue: 'Could not load' })}
        </span>
      )}
      <Button
        size='mini'
        type='secondary'
        loading={state === 'loading'}
        disabled={state === 'loading'}
        onClick={load}
        data-testid='inline-image-show'
      >
        {state === 'failed' ? t('messages.imageRetry', { defaultValue: 'Retry' }) : null}
      </Button>
    </span>
  );
};

export default InlineImageCard;
