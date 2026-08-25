/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { app, session } from 'electron';
import { ipcBridge } from '@/common';
import { BROWSER_SESSION_PARTITION } from '@/common/config/constants';
import { ProcessConfig } from '@process/utils/initStorage';
import { getZoomFactor, setZoomFactor } from '@process/utils/zoom';
import { getCdpStatus, updateCdpConfig } from '@process/utils/configureChromium';
import { getCdpBridgeHandle } from '@process/utils/cdpBridgeRegistry';
import { getGpuStatus, setGpuUserOverride } from '@process/utils/gpuRecovery';
import { initApplicationBridgeCore } from './applicationBridgeCore';
import type { IStartOnBootStatus } from '@/common/adapter/ipcBridge';
import { restartApplication } from './restartApplication';

let mainWindowRef: BrowserWindow | null = null;
let pendingAuthCallback: import('../services/paviiAuthCallbackServer').AuthCallbackHandle | null = null;

const START_ON_BOOT_UNSUPPORTED_MESSAGE = 'Start on boot is only available in packaged macOS and Windows apps.';
export const START_ON_BOOT_WINDOWS_ARG = '--start-on-boot';

const isStartOnBootSupported = (): boolean => {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
};

const getStartOnBootWindowsArgs = (): string[] => [START_ON_BOOT_WINDOWS_ARG];

const getLoginItemSettings = () => {
  return process.platform === 'win32'
    ? app.getLoginItemSettings({ args: getStartOnBootWindowsArgs() })
    : app.getLoginItemSettings();
};

export function wasLaunchedAtLogin(): boolean {
  if (!app.isPackaged) {
    return false;
  }

  if (process.platform === 'darwin') {
    return Boolean(getLoginItemSettings().wasOpenedAtLogin);
  }

  if (process.platform === 'win32') {
    return process.argv.includes(START_ON_BOOT_WINDOWS_ARG);
  }

  return false;
}

export function getStartOnBootStatus(): IStartOnBootStatus {
  if (!isStartOnBootSupported()) {
    return {
      supported: false,
      enabled: false,
      isPackaged: app.isPackaged,
      platform: process.platform,
    };
  }

  const settings = getLoginItemSettings();
  const enabled =
    process.platform === 'win32'
      ? Boolean(settings.openAtLogin || settings.executableWillLaunchAtLogin)
      : Boolean(settings.openAtLogin);

  return {
    supported: true,
    enabled,
    isPackaged: app.isPackaged,
    platform: process.platform,
  };
}

export function setStartOnBootEnabled(enabled: boolean): IStartOnBootStatus {
  const currentStatus = getStartOnBootStatus();
  if (!currentStatus.supported) {
    return currentStatus;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    ...(process.platform === 'win32'
      ? {
          args: getStartOnBootWindowsArgs(),
          enabled: true,
        }
      : {}),
  });

  return getStartOnBootStatus();
}

export function setApplicationMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
}

export function initApplicationBridge(): void {
  // Platform-agnostic handlers: systemInfo, updateSystemInfo, getPath
  initApplicationBridgeCore();

  // Pavii account (Firebase via pavii.tech/login)
  ipcBridge.paviiAuth.getSession.provider(async () => {
    const { readStoredSession } = await import('../services/paviiAuth');
    const { getConfigPath } = await import('../utils/utils');
    return readStoredSession(getConfigPath());
  });

  ipcBridge.paviiAuth.signIn.provider(async (params) => {
    const { buildSignInUrl } = await import('../services/paviiAuth');
    const { shell } = await import('electron');
    const mode = params && typeof params === 'object' ? params.mode : undefined;
    // Prefer a loopback callback: browsers can silently refuse to launch the
    // pavii:// scheme (stale handler caches), while a 127.0.0.1 delivery from
    // the login page always reaches us. pavii://auth stays as the fallback.
    let redirectUri = 'pavii://auth';
    try {
      const { startAuthCallbackServer } = await import('../services/paviiAuthCallbackServer');
      const { completeAuthSignIn } = await import('../utils/deepLink');
      pendingAuthCallback?.close();
      pendingAuthCallback = await startAuthCallbackServer((idToken) => completeAuthSignIn(idToken), {
        onFocus: () => {
          if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
          if (mainWindowRef.isMinimized()) mainWindowRef.restore();
          mainWindowRef.show();
          mainWindowRef.focus();
        },
      });
      redirectUri = `http://127.0.0.1:${pendingAuthCallback.port}/auth`;
    } catch (error) {
      console.warn('[PaviiAuth] loopback callback unavailable, falling back to pavii://', error);
    }
    const signInUrl = buildSignInUrl(redirectUri, mode);
    await shell.openExternal(signInUrl);
    // Returned so the gate can offer "open again" / "copy link" fallbacks when
    // the OS default browser is not the one the user wanted.
    return signInUrl;
  });

  ipcBridge.paviiAuth.signOut.provider(async () => {
    const { clearStoredSession } = await import('../services/paviiAuth');
    const { getConfigPath } = await import('../utils/utils');
    await clearStoredSession(getConfigPath());
  });

  // App-hosted channel bridges (Slack/Discord)
  ipcBridge.paviiChannels.getStatus.provider(async () => {
    const { getSlackBridgeState } = await import('../services/channels/slackBridge');
    const { getDiscordBridgeState } = await import('../services/channels/discordBridge');
    const { readChannelStore } = await import('../services/channels/channelStore');
    const store = await readChannelStore();
    const slack = getSlackBridgeState();
    const discord = getDiscordBridgeState();
    return {
      slack: { ...slack, enabled: store.slack?.enabled === true },
      discord: { ...discord, enabled: store.discord?.enabled === true },
    };
  });

  ipcBridge.paviiChannels.enable.provider(async ({ platform, credentials }) => {
    if (platform === 'slack') {
      if (!credentials.botToken || !credentials.appToken) {
        throw new Error('Slack needs both a bot token (xoxb-...) and an app-level token (xapp-...)');
      }
      const { startSlackBridge } = await import('../services/channels/slackBridge');
      const bridgeState = await startSlackBridge({
        botToken: credentials.botToken,
        appToken: credentials.appToken,
      });
      return { ...bridgeState, enabled: true };
    }
    if (platform === 'discord') {
      if (!credentials.botToken) throw new Error('Discord needs a bot token');
      const { startDiscordBridge } = await import('../services/channels/discordBridge');
      const bridgeState = await startDiscordBridge({ botToken: credentials.botToken });
      return { ...bridgeState, enabled: true };
    }
    throw new Error(`Channel bridge not available: ${platform as string}`);
  });

  ipcBridge.paviiChannels.disable.provider(async ({ platform }) => {
    if (platform === 'slack') {
      const { stopSlackBridge } = await import('../services/channels/slackBridge');
      await stopSlackBridge();
    } else if (platform === 'discord') {
      const { stopDiscordBridge } = await import('../services/channels/discordBridge');
      await stopDiscordBridge();
    }
  });

  // Public-access tunnel for the WebUI
  ipcBridge.paviiTunnel.getStatus.provider(async () => {
    const { getTunnelState } = await import('../services/tunnelService');
    return getTunnelState();
  });

  ipcBridge.paviiTunnel.start.provider(async () => {
    const { startTunnel } = await import('../services/tunnelService');
    const { getDesktopWebUIStatus, writeTunnelEnabledPreference } = await import('../utils/webuiConfig');
    const webuiStatus = getDesktopWebUIStatus();
    if (!webuiStatus.running || !webuiStatus.port) {
      throw new Error('Enable the WebUI first, then turn on public access.');
    }
    const tunnelState = await startTunnel(webuiStatus.port);
    await writeTunnelEnabledPreference(true);
    return tunnelState;
  });

  ipcBridge.paviiTunnel.stop.provider(async () => {
    const { stopTunnel } = await import('../services/tunnelService');
    const { writeTunnelEnabledPreference } = await import('../utils/webuiConfig');
    await stopTunnel();
    await writeTunnelEnabledPreference(false);
  });

  ipcBridge.application.restart.provider(async () => {
    // Backend subprocess shutdown is handled by backendManager.stop() in the
    // main window's before-quit hook; agent children are killed transitively
    // when backend exits.
    return restartApplication(app);
  });

  // Electron-only: the id file lives under app.getPath('userData'). WebUI
  // browser mode has no provider for this and falls back to PostHog's own
  // anonymous id.
  ipcBridge.application.analyticsId.provider(async () => {
    const { getOrCreateAnalyticsId } = await import('../utils/analyticsId');
    return getOrCreateAnalyticsId();
  });

  ipcBridge.application.isDevToolsOpened.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      return Promise.resolve(mainWindowRef.webContents.isDevToolsOpened());
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.openDevTools.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      const win = mainWindowRef;
      const wasOpen = win.webContents.isDevToolsOpened();

      if (wasOpen) {
        win.webContents.closeDevTools();
        return Promise.resolve(false);
      } else {
        return new Promise((resolve) => {
          const onOpened = () => {
            win.webContents.off('devtools-opened', onOpened);
            resolve(true);
          };

          win.webContents.once('devtools-opened', onOpened);
          win.webContents.openDevTools();

          setTimeout(() => {
            win.webContents.off('devtools-opened', onOpened);
            if (win.isDestroyed()) {
              resolve(false);
              return;
            }
            resolve(win.webContents.isDevToolsOpened());
          }, 500);
        });
      }
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.getZoomFactor.provider(() => Promise.resolve(getZoomFactor()));

  ipcBridge.application.setZoomFactor.provider(async ({ factor }) => {
    const updatedFactor = setZoomFactor(factor);
    try {
      await ProcessConfig.set('ui.zoomFactor', updatedFactor);
    } catch (error) {
      console.error('[ApplicationBridge] Failed to persist zoom factor:', error);
    }
    return updatedFactor;
  });

  ipcBridge.application.writeRendererLog.provider(async ({ level, tag, message, data }) => {
    const prefix = `[Renderer:${tag}] ${message}`;
    const args = data === undefined ? [prefix] : [prefix, data];
    if (level === 'error') {
      console.error(...args);
    } else if (level === 'warn') {
      console.warn(...args);
    } else if (level === 'debug') {
      console.debug(...args);
    } else {
      console.info(...args);
    }
  });

  // CDP status and configuration
  ipcBridge.application.getCdpStatus.provider(async () => {
    try {
      const status = getCdpStatus();
      // If port is set, CDP is considered enabled (verification is optional)
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.updateCdpConfig.provider(async (config) => {
    try {
      const updatedConfig = updateCdpConfig(config);
      return { success: true, data: updatedConfig };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  /**
   * Clear the in-app browser session and caches.
   *
   * The session is shared globally (every tab and project uses one partition), so this
   * is the single "sign out of every site" entry point. Already-open browser tabs only
   * reflect it after a refresh, which the settings copy tells the user.
   *
   * Clear the in-app browser's sign-in state and cache. Sign-in state is globally
   * shared (one partition across all tabs and projects), so this is the only way
   * to sign out everywhere. Already-open browser tabs reflect it after a reload,
   * which the settings copy tells the user.
   */
  ipcBridge.application.clearBrowserData.provider(async () => {
    try {
      const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
      // clearStorageData only clears cookies and the storage families, not the HTTP or auth
      // caches - and the settings copy promises "clear caches", so all three are cleared.
      //
      // clearStorageData covers cookies and storages but neither the HTTP cache nor
      // the HTTP auth cache, and the settings copy promises the cache is cleared.
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      await browserSession.clearAuthCache();
      return { success: true };
    } catch (e) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.application.reportBrowserWebContentsId.provider(async ({ webContentsId }) => {
    /**
     * Attach the single-target CDP channel to the side browser.
     *
     * Re-reported on every browser tab switch: the channel serves one target at a time and
     * switching re-attaches it, so the agent always drives the page the user is looking at.
     * With many tabs this is a deliberate trade: expose the one active webContents, not ten.
     *
     * Attaches the single-target CDP bridge to the in-app browser. Re-reported on every
     * browser tab switch: the bridge serves one target at a time, so switching re-points
     * it and the agent always drives the page the user is actually looking at. With
     * multiple tabs this is a deliberate trade-off — exposing only the active webContents
     * rather than all ten at once.
     */
    try {
      const handle = getCdpBridgeHandle();
      if (!handle) return { success: false, msg: 'Agent browser control is not enabled.' };
      const result = handle.attach(webContentsId);
      if (result.ok === false) return { success: false, msg: result.reason };
      return { success: true };
    } catch (e) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.application.getStartOnBootStatus.provider(async () => {
    try {
      return { success: true, data: getStartOnBootStatus() };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.setStartOnBoot.provider(async ({ enabled }) => {
    try {
      const status = setStartOnBootEnabled(enabled);
      if (!status.supported) {
        return { success: false, msg: START_ON_BOOT_UNSUPPORTED_MESSAGE, data: status };
      }
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.getGpuStatus.provider(async () => {
    try {
      return { success: true, data: getGpuStatus() };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.setGpuOverride.provider(async ({ override }) => {
    try {
      return { success: true, data: setGpuUserOverride(override) };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });
}
