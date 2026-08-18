/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';

export const PROTOCOL_SCHEME = 'pavii';

/**
 * Parse a pavii:// URL into action and params.
 * Supports two formats:
 *   1. pavii://add-provider?base_url=xxx&api_key=xxx
 *   2. pavii://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 */
export const parseDeepLinkUrl = (url: string): { action: string; params: Record<string, string> } | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null;

    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // Auth callbacks carry the token in the fragment (never logged server-side):
    // pavii://auth#id_token=...
    if (parsed.hash.length > 1) {
      new URLSearchParams(parsed.hash.slice(1)).forEach((value, key) => {
        params[key] = value;
      });
    }

    // If data param exists, decode base64 JSON and merge into params
    if (params.data) {
      try {
        const json = JSON.parse(Buffer.from(params.data, 'base64').toString('utf-8'));
        if (json && typeof json === 'object') {
          Object.assign(params, json);
        }
      } catch {
        // Ignore decode errors
      }
      delete params.data;
    }

    return { action, params };
  } catch {
    return null;
  }
};

let mainWindowRef: BrowserWindow | null = null;
let pendingDeepLinkUrl: string | null = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`)) || null;

export const setDeepLinkMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

export const getPendingDeepLinkUrl = (): string | null => pendingDeepLinkUrl;

export const clearPendingDeepLinkUrl = (): void => {
  pendingDeepLinkUrl = null;
};

/**
 * Pavii account sign-in completion: verify the Firebase ID token in the main
 * process, persist the session next to the app config, and notify the renderer
 * with token-free account details. Shared by the pavii://auth deep link and
 * the loopback auth callback server. Returns whether sign-in succeeded.
 */
export const completeAuthSignIn = async (idToken: string): Promise<boolean> => {
  try {
    const { verifyFirebaseIdToken, storeSession } = await import('../services/paviiAuth');
    const session = await verifyFirebaseIdToken(idToken);
    const { getConfigPath } = await import('./utils');
    await storeSession(getConfigPath(), session);
    console.log(`[PaviiAuth] signed in as ${session.email ?? session.uid}`);
    ipcBridge.deepLink.received.emit({
      action: 'auth/success',
      params: { uid: session.uid, email: session.email ?? '' },
    });
    return true;
  } catch (error) {
    console.error('[PaviiAuth] sign-in callback rejected:', error);
    ipcBridge.deepLink.received.emit({ action: 'auth/error', params: {} });
    return false;
  }
};

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
export const handleDeepLinkUrl = (url: string): void => {
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) return;

  // Auth callbacks are handled in the main process; the raw token never
  // reaches the renderer.
  if (parsed.action === 'auth' && parsed.params.id_token) {
    void completeAuthSignIn(parsed.params.id_token);
    return;
  }

  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    pendingDeepLinkUrl = url;
    return;
  }

  ipcBridge.deepLink.received.emit(parsed);
};
