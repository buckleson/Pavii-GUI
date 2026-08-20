/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Modal } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Close tab confirmation state
 */
export interface CloseTabConfirmState {
  /**
   * Whether to show confirmation dialog
   */
  show: boolean;

  /**
   * Tab ID to close
   */
  tabId: string | null;

  /**
   * Every tab id in a bulk close, clean ones included.
   *
   * Left empty for a single tab, which takes the original `tabId` path. Bulk closes (left, right,
   * other, all, collapse panel) used to bypass the confirmation entirely and silently discard
   * unsaved edits: closing one tab asked, closing ten did not, giving one action two safety levels.
   *
   * All tab ids this batch will close (including clean ones). Empty for a
   * single-tab close, which keeps using `tabId`. Batch closes (left/right/others/
   * all, collapsing the panel) previously skipped confirmation entirely and
   * silently discarded unsaved edits — closing one tab asked, closing ten did
   * not, two safety levels for the same "close" gesture.
   */
  batchTabIds?: string[];

  /**
   * How many tabs in the batch are unsaved, for the message.
   */
  dirtyCount?: number;
}

/**
 * Refresh confirmation state
 *
 * Reloading a tab replaces its content with what is on disk, so an unsaved edit has
 * to be dealt with first — dropped deliberately, or saved. Skipping this prompt would
 * make "refresh" destroy work, which is the one thing the refresh button must not do.
 */
export interface RefreshConfirmState {
  show: boolean;
  /** Tab awaiting the user's decision. */
  tabId: string | null;
}

/**
 * PreviewConfirmModals component props
 */
interface PreviewConfirmModalsProps {
  /**
   * Close tab confirmation state
   */
  closeTabConfirm: CloseTabConfirmState;

  /**
   * Refresh confirmation state
   */
  refreshConfirm?: RefreshConfirmState;

  /** Discard the edit and reload */
  onRefreshWithoutSave?: () => void;

  /** Cancel the reload */
  onCancelRefresh?: () => void;

  /**
   * Save and close tab
   */
  onSaveAndCloseTab: () => void;

  /**
   * Close tab without saving
   */
  onCloseWithoutSave: () => void;

  /**
   * Cancel close tab
   */
  onCancelCloseTab: () => void;
}

/**
 * Preview panel confirmation modals component
 *
 * Contains the close tab confirmation dialog
 */
const PreviewConfirmModals: React.FC<PreviewConfirmModalsProps> = ({
  closeTabConfirm,
  refreshConfirm,
  onRefreshWithoutSave,
  onCancelRefresh,
  onSaveAndCloseTab,
  onCloseWithoutSave,
  onCancelCloseTab,
}) => {
  const { t } = useTranslation();

  // A dialog per unsaved tab in a bulk close would wear the user down, so it collapses into one
  // confirmation stating how many are unsaved. A single tab keeps the original wording.
  //
  // Prompting once per dirty tab in a batch would just train the user to click
  // through, so a batch collapses into a single confirmation that states how many
  // tabs are unsaved. A single close keeps its original wording.
  const dirtyCount = closeTabConfirm.dirtyCount ?? 0;
  const isBatch = (closeTabConfirm.batchTabIds?.length ?? 0) > 0 && dirtyCount > 1;

  return (
    <>
      {/* Close tab confirmation modal */}
      <Modal
        visible={closeTabConfirm.show}
        title={isBatch ? t('preview.closeTabsTitle') : t('preview.closeTabTitle')}
        onCancel={onCancelCloseTab}
        onOk={onSaveAndCloseTab}
        okText={t('preview.saveAndClose')}
        cancelText={t('common.cancel')}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
        footer={
          <div className='flex justify-end gap-8px'>
            <button
              className='px-16px py-6px cursor-pointer border-none hover:bg-bg-3 transition-colors text-14px text-t-primary'
              onClick={onCancelCloseTab}
            >
              {t('common.cancel')}
            </button>
            <button
              className='px-16px py-6px cursor-pointer border-none hover:bg-bg-3 transition-colors text-14px text-t-primary'
              onClick={onCloseWithoutSave}
            >
              {t('preview.closeWithoutSave')}
            </button>
            <button
              className='px-16px py-6px cursor-pointer border-none bg-primary text-white hover:opacity-80 transition-opacity text-14px'
              onClick={onSaveAndCloseTab}
            >
              {t('preview.saveAndClose')}
            </button>
          </div>
        }
      >
        <div className='text-14px text-t-secondary'>
          {isBatch ? t('preview.closeTabsMessage', { count: dirtyCount }) : t('preview.closeTabMessage')}
        </div>
      </Modal>

      {/* Unsaved-work confirmation before reloading */}
      <Modal
        visible={refreshConfirm?.show === true}
        title={t('preview.refresh.confirmTitle')}
        onCancel={onCancelRefresh}
        onOk={onRefreshWithoutSave}
        okText={t('preview.refresh.discardAndRefresh')}
        cancelText={t('common.cancel')}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
        footer={
          <div className='flex justify-end gap-8px'>
            <button
              className='px-16px py-6px cursor-pointer border-none hover:bg-bg-3 transition-colors text-14px text-t-primary'
              onClick={onCancelRefresh}
            >
              {t('common.cancel')}
            </button>
            <button
              className='px-16px py-6px cursor-pointer border-none bg-primary text-white hover:opacity-80 transition-opacity text-14px'
              onClick={onRefreshWithoutSave}
            >
              {t('preview.refresh.discardAndRefresh')}
            </button>
          </div>
        }
      >
        <div className='text-14px text-t-secondary'>{t('preview.refresh.confirmMessage')}</div>
      </Modal>
    </>
  );
};

export default PreviewConfirmModals;
