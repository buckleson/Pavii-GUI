/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Message } from '@arco-design/web-react';
import { Copy, Pic } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Inline card for an image an agent referenced by bare file path; the image
 * loads as soon as the card mounts.
 *
 * STYLING CONTRACT: this renders inside ShadowView's shadow root, where
 * UnoCSS utilities and Arco's stylesheet do not exist. Every class used here
 * must be defined in ShadowView.tsx's stylesheet (`.pavii-inline-*`), and the
 * image is a plain <img> because Arco's Image component is unstyled and
 * unconstrained in there — it shipped once rendering a generated image at
 * natural size over the whole conversation.
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
      .then(() =>
        messageApi.success(t('messages.imagePathCopied', { defaultValue: 'Image location copied to clipboard' }))
      )
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
      <span className='pavii-inline-media' data-testid='inline-image-shown'>
        {messageContext}
        <img className='pavii-inline-media-img' src={dataUrl} alt={basename} />
        <span className='pavii-inline-media-caption'>
          <span className='pavii-inline-name-secondary' title={path}>
            {basename}
          </span>
          <Button
            size='mini'
            type='secondary'
            className='pavii-inline-btn'
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
    <span className='pavii-inline-chip' data-testid='inline-image-card'>
      <Pic theme='outline' size='16' />
      <span className='pavii-inline-name' title={path}>
        {basename}
      </span>
      {state === 'failed' && (
        <span className='pavii-inline-note'>{t('messages.imageLoadFailed', { defaultValue: 'Could not load' })}</span>
      )}
      <Button
        size='mini'
        type='secondary'
        className='pavii-inline-btn'
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
