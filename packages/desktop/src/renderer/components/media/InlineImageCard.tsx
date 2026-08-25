/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Image } from '@arco-design/web-react';
import { Pic } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Click-to-view card for an image an agent referenced by bare file path.
 *
 * Deliberately deferred: the image loads when the user asks for it, not the
 * moment a message mentions a path. It owns its own fetch instead of reusing
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
  const [state, setState] = useState<'idle' | 'loading' | 'shown' | 'failed'>('idle');
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  const basename = path.split(/[\\/]/).pop() || path;

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

  if (state === 'shown' && dataUrl) {
    return (
      <span className='block my-8px' data-testid='inline-image-shown'>
        <Image src={dataUrl} alt={basename} className='max-w-full rounded-8px' style={{ maxHeight: 420 }} />
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
      <Button size='mini' type='secondary' loading={state === 'loading'} onClick={load} data-testid='inline-image-show'>
        {state === 'failed'
          ? t('messages.imageRetry', { defaultValue: 'Retry' })
          : t('messages.showImage', { defaultValue: 'Show image' })}
      </Button>
    </span>
  );
};

export default InlineImageCard;
