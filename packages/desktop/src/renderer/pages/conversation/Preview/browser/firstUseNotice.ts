/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-time notice shown the first time the agent drives the in-app browser.
 *
 * Product constraint: non-blocking, no confirmation. The first time the side browser moves on
 * its own the user wonders who is driving it, so it deserves a word - but this is expected
 * behaviour and should not stop the agent with a dialog.
 *
 * One-time notice shown the first time the agent drives the in-app browser.
 * Product constraint: non-blocking and requiring no confirmation. The first time a
 * user sees the side browser move by itself they wonder who is doing it, so it
 * needs saying — but this is expected behavior and must not block the agent behind
 * a modal.
 */

import { Notification } from '@arco-design/web-react';
import i18next from 'i18next';

/**
 * Whether the notice has been shown. localStorage rather than an in-memory flag, because
 * "first time" means first on this machine, and a restart should not show it again.
 *
 * Whether the notice has been shown. Stored in localStorage rather than memory
 * because "first time" means first time on this machine — restarting the app must
 * not show it again.
 */
const FIRST_USE_STORAGE_KEY = 'aionui_agent_browser_first_use_notified';

/**
 * An in-process flag, so consecutive tool calls in one session cannot show it twice.
 * localStorage writes are synchronous, but several calls can still land between the read and the write.
 *
 * In-process guard against duplicate notices from back-to-back tool calls within a
 * single session: localStorage writes are synchronous, but several events can still
 * fire between the read and the write.
 */
let notifiedThisSession = false;

const hasNotified = (): boolean => {
  if (notifiedThisSession) return true;
  try {
    return localStorage.getItem(FIRST_USE_STORAGE_KEY) === '1';
  } catch {
    // If localStorage is unavailable, prefer never notifying over notifying always.
    return true;
  }
};

const rememberNotified = (): void => {
  notifiedThisSession = true;
  try {
    localStorage.setItem(FIRST_USE_STORAGE_KEY, '1');
  } catch {
    // Non-critical: the in-process guard still prevents repeats this session.
  }
};

/**
 * Shows the one-time notice unless it has already been shown. No-op otherwise.
 */
export const maybeNotifyFirstAgentBrowserUse = (): void => {
  if (hasNotified()) return;
  rememberNotified();

  Notification.info({
    // The i18next singleton is used directly rather than @/renderer/services/i18n, which
    // initializes i18n and subscribes to IPC at module load, dragging those side effects into anything that imports this file.
    // Use the i18next singleton rather than @/renderer/services/i18n: the latter
    // initializes i18n and subscribes to IPC at module load, dragging those side
    // effects into anything that imports this file.
    title: i18next.t('preview.browser.agentFirstUseTitle'),
    content: i18next.t('preview.browser.agentFirstUseContent'),
    duration: 8000,
  });
};
