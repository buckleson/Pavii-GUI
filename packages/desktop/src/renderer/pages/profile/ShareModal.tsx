/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import brandLogo from '@renderer/assets/logos/brand/app.png';
import { Button, Message, Modal } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShareCardData, ShareNetwork } from './shareCard';
import {
  SHARE_CARD_DARK,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_LIGHT,
  SHARE_CARD_WIDTH,
  buildShareIntentUrl,
  renderShareCard,
  shareCardBlob,
} from './shareCard';

type ShareModalProps = {
  visible: boolean;
  onClose: () => void;
  data: ShareCardData;
  isDark: boolean;
};

type ShareAction = {
  glyph: React.ReactNode;
  key: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
};

/** Renders the activity card to a canvas and offers save + share intents. */
const ShareModal: React.FC<ShareModalProps> = ({ visible, onClose, data, isDark }) => {
  const { t } = useTranslation();
  // Arco's static `Message.*` helpers mount through the legacy
  // `ReactDOM.render`, which React 19 removed, so they reject instead of
  // showing anything. The hook form is what the rest of the app uses.
  const [messageApi, messageContext] = Message.useMessage();
  // A ref would still be null when this component's effect first runs: Arco
  // mounts the modal body on its own later render, so the canvas does not
  // exist yet and the card was never drawn. Tracking the node in state means
  // the draw happens as soon as it actually mounts.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!visible || !canvas) return;
    const theme = isDark ? SHARE_CARD_DARK : SHARE_CARD_LIGHT;
    // Draw straight away rather than waiting on the logo. Hanging the whole
    // card off an image load means a slow or never-resolving asset leaves the
    // user staring at a blank canvas; the logo is a garnish, so it just
    // triggers a redraw when it arrives.
    renderShareCard(canvas, data, theme);
    const logo = new Image();
    logo.onload = () => renderShareCard(canvas, data, theme, logo);
    logo.src = brandLogo;
  }, [visible, canvas, data, isDark]);

  const saveCard = useCallback(() => {
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'pavii-activity.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [canvas]);

  // No web intent can attach a file — `text` is the only payload X, LinkedIn
  // and Reddit accept — so the card goes to the clipboard for the user to
  // paste into the composer. Without this the post carries only prose, and the
  // image X shows is the unfurled link's own artwork, not the activity card.
  const copyCard = useCallback(async (): Promise<boolean> => {
    if (!canvas) return false;
    if (!navigator.clipboard || !window.isSecureContext || typeof navigator.clipboard.write !== 'function') {
      return false;
    }
    try {
      const blob = await shareCardBlob(canvas);
      if (!blob) return false;
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    } catch (error) {
      console.warn('[ShareModal] Could not copy the activity card:', error);
      return false;
    }
  }, [canvas]);

  const shareTo = useCallback(
    (network: ShareNetwork) => {
      // Fire the copy and the composer independently. Awaiting the clipboard
      // before opening would let a rejected write swallow the share and leave
      // the button looking dead; a failed copy costs the image, not the post.
      void copyCard().then((copied) => {
        if (copied) {
          messageApi.success(
            t('profile.shareCopied', { defaultValue: 'Card copied — paste it into the post with Ctrl+V' })
          );
        } else {
          messageApi.info(
            t('profile.shareCopyFailed', {
              defaultValue: 'Could not copy the card. Use Save image, then attach it to the post.',
            })
          );
        }
      });
      void ipcBridge.shell.openExternal.invoke(buildShareIntentUrl(network, data));
    },
    [copyCard, data, messageApi, t]
  );

  // icon-park ships no LinkedIn or Reddit mark, and those brands are wordmarks
  // anyway, so the social buttons use typographic glyphs for a consistent row.
  const actions: ShareAction[] = [
    {
      key: 'x',
      glyph: <span className='text-18px font-600 leading-none'>X</span>,
      label: 'X',
      onClick: () => shareTo('x'),
    },
    {
      key: 'linkedin',
      glyph: <span className='text-15px font-700 leading-none'>in</span>,
      label: 'LinkedIn',
      onClick: () => shareTo('linkedin'),
    },
    {
      key: 'reddit',
      glyph: <span className='text-18px font-700 leading-none'>r</span>,
      label: 'Reddit',
      onClick: () => shareTo('reddit'),
    },
    {
      key: 'save',
      glyph: <Download size={18} />,
      label: t('profile.shareSave', { defaultValue: 'Save' }),
      onClick: saveCard,
      primary: true,
    },
  ];

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={t('profile.shareTitle', { defaultValue: 'Share your activity' })}
      style={{ width: 720 }}
    >
      {messageContext}
      <canvas
        ref={setCanvas}
        width={SHARE_CARD_WIDTH}
        height={SHARE_CARD_HEIGHT}
        className='w-full rounded-16px'
        data-testid='share-card-canvas'
      />
      <div className='mt-20px flex items-start justify-center gap-24px'>
        {actions.map((action) => (
          <div key={action.key} className='flex flex-col items-center gap-6px'>
            <Button
              shape='circle'
              size='large'
              type={action.primary ? 'primary' : 'secondary'}
              onClick={action.onClick}
              aria-label={action.label}
              data-testid={`share-action-${action.key}`}
            >
              {action.glyph}
            </Button>
            <span className='text-12px text-t-tertiary'>{action.label}</span>
          </div>
        ))}
      </div>
      <div className='mt-12px text-center text-12px text-t-tertiary'>
        {t('profile.shareHint', {
          defaultValue: 'Sharing copies your card and opens a post. Paste the card in with Ctrl+V.',
        })}
      </div>
    </Modal>
  );
};

export default ShareModal;
