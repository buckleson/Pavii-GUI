/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import brandLogo from '@renderer/assets/logos/brand/app.png';
import { Button, Modal } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import React, { useEffect, useRef } from 'react';
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

/** Renders the activity card to a canvas and offers save + share intents. */
const ShareModal: React.FC<ShareModalProps> = ({ visible, onClose, data, isDark }) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const theme = isDark ? SHARE_CARD_DARK : SHARE_CARD_LIGHT;
    const logo = new Image();
    logo.onload = () => renderShareCard(canvas, data, theme, logo);
    logo.onerror = () => renderShareCard(canvas, data, theme);
    logo.src = brandLogo;
  }, [visible, data, isDark]);

  const saveCard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'pavii-activity.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const shareTo = (network: ShareNetwork) => {
    void ipcBridge.shell.openExternal.invoke(buildShareIntentUrl(network, buildShareText(data)));
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={t('profile.shareTitle', { defaultValue: 'Share your activity' })}
      style={{ width: 720 }}
    >
      <canvas
        ref={canvasRef}
        width={SHARE_CARD_WIDTH}
        height={SHARE_CARD_HEIGHT}
        className='w-full rounded-12px border border-base'
        data-testid='share-card-canvas'
      />
      <div className='mt-16px flex items-center justify-center gap-12px'>
        <Button onClick={() => shareTo('x')}>X</Button>
        <Button onClick={() => shareTo('linkedin')}>LinkedIn</Button>
        <Button onClick={() => shareTo('reddit')}>Reddit</Button>
        <Button type='primary' icon={<Download size={14} />} onClick={saveCard}>
          {t('profile.shareSave', { defaultValue: 'Save image' })}
        </Button>
      </div>
      <div className='mt-8px text-center text-12px text-t-tertiary'>
        {t('profile.shareHint', {
          defaultValue: 'Sharing opens a post with your stats. Save the image to attach it.',
        })}
      </div>
    </Modal>
  );
};

export default ShareModal;
