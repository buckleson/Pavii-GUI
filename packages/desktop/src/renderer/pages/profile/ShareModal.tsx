/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import brandLogo from '@renderer/assets/logos/brand/app.png';
import { Button, Modal } from '@arco-design/web-react';
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
  buildShareText,
  renderShareCard,
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

  const shareTo = useCallback(
    (network: ShareNetwork) => {
      void ipcBridge.shell.openExternal.invoke(buildShareIntentUrl(network, buildShareText(data)));
    },
    [data]
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
          defaultValue: 'Sharing opens a post with your stats. Save the image to attach it.',
        })}
      </div>
    </Modal>
  );
};

export default ShareModal;
