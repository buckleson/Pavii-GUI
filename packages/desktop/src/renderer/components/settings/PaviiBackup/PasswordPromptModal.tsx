/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, Modal } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type PasswordPromptModalProps = {
  visible: boolean;
  title: string;
  hint: string;
  okText: string;
  /** Ask for the password twice (export). */
  requireConfirm?: boolean;
  loading?: boolean;
  /** Called with the trimmed-to-undefined password (empty means "no password"). */
  onOk: (password: string | undefined) => void;
  onCancel: () => void;
};

/** Optional-password prompt shared by backup export and import. */
const PasswordPromptModal: React.FC<PasswordPromptModalProps> = ({
  visible,
  title,
  hint,
  okText,
  requireConfirm = false,
  loading = false,
  onOk,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (visible) {
      setPassword('');
      setConfirm('');
    }
  }, [visible]);

  const mismatch = requireConfirm && password !== confirm;

  return (
    <Modal
      visible={visible}
      title={title}
      okText={okText}
      cancelText={t('common.cancel')}
      confirmLoading={loading}
      okButtonProps={{ disabled: mismatch }}
      onOk={() => onOk(password ? password : undefined)}
      onCancel={onCancel}
      autoFocus={false}
      unmountOnExit
    >
      <div className='flex flex-col gap-12px'>
        <div className='text-13px text-t-secondary'>{hint}</div>
        <Input.Password
          value={password}
          onChange={setPassword}
          placeholder={t('settings.paviiData.passwordPlaceholder')}
          autoComplete='new-password'
          data-testid='pavii-backup-password'
        />
        {requireConfirm && (
          <>
            <Input.Password
              value={confirm}
              onChange={setConfirm}
              placeholder={t('settings.paviiData.confirmPasswordPlaceholder')}
              autoComplete='new-password'
              status={mismatch && confirm ? 'error' : undefined}
              data-testid='pavii-backup-password-confirm'
            />
            {mismatch && confirm && (
              <div className='text-12px text-danger'>{t('settings.paviiData.passwordMismatch')}</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default PasswordPromptModal;
