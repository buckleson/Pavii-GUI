/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { WEBUI_DEFAULT_PORT } from '@/common/config/constants';
import { paviiTunnel, shell, webui, type IWebUIStatus, type PaviiTunnelState } from '@/common/adapter/ipcBridge';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { configService } from '@/common/config/configService';
import AionModal from '@/renderer/components/base/AionModal';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useTalkToButler } from '@/renderer/hooks/assistant/useTalkToButler';
import ChannelDiscordLogo from '@/renderer/assets/channel-logos/discord.svg';
import ChannelSlackLogo from '@/renderer/assets/channel-logos/slack.svg';
import ChannelTelegramLogo from '@/renderer/assets/channel-logos/telegram.svg';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Button, Form, Input, Message, Switch, Tabs, Tooltip } from '@arco-design/web-react';
import { CheckOne, Communication, Copy, Earth, EditTwo, Refresh } from '@icon-park/react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';

/**
 * 偏好设置行组件
 * Preference row component
 */
const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, description, extra, children }) => (
  <div className='flex items-center justify-between gap-12px py-12px'>
    <div className='min-w-0 flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>{label}</span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center shrink-0'>{children}</div>
  </div>
);

const CHANNEL_LOGOS = [
  { src: ChannelTelegramLogo, alt: 'Telegram' },
  { src: ChannelSlackLogo, alt: 'Slack' },
  { src: ChannelDiscordLogo, alt: 'Discord' },
] as const;

const ChannelModalContentLazy = React.lazy(() => import('./channels/ChannelModalContent'));
const QRCodeSVGLazy = React.lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeSVG };
});

const DESKTOP_WEBUI_ENABLED_KEY = 'webui.desktop.enabled';
const DESKTOP_WEBUI_ALLOW_REMOTE_KEY = 'webui.desktop.allowRemote';

/**
 * WebUI 设置内容组件
 * WebUI settings content component
 */
const WebuiModalContent: React.FC = () => {
  const { t } = useTranslation();
  const talkToButler = useTalkToButler();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const [activeTab, setActiveTab] = useState<'webui' | 'channels'>('webui');

  // Check if running in Electron desktop environment
  const isDesktop = isElectronDesktop();

  const [status, setStatus] = useState<IWebUIStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const port = WEBUI_DEFAULT_PORT;
  const [webuiEnabled, setWebuiEnabled] = useState(false);
  const [allowRemotePreference, setAllowRemotePreference] = useState(false);
  const [cachedIP, setCachedIP] = useState<string | null>(null);
  const [cachedPassword, setCachedPassword] = useState<string | null>(null);
  // Flag for plaintext password display (first startup and not copied)
  const [canShowPlainPassword, setCanShowPlainPassword] = useState(false);
  // Set new password modal
  const [setPasswordModalVisible, setSetPasswordModalVisible] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [setUsernameModalVisible, setSetUsernameModalVisible] = useState(false);
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [form] = Form.useForm();
  const [usernameForm] = Form.useForm();

  // Public-access tunnel (Cloudflare quick tunnel managed by the main process)
  const [tunnelState, setTunnelState] = useState<PaviiTunnelState | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);

  // QR code login related state
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const qrRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadTunnelStatus = useCallback(async () => {
    try {
      setTunnelState(await paviiTunnel.getStatus.invoke());
    } catch {
      setTunnelState(null);
    }
  }, []);

  useEffect(() => {
    if (isDesktop) void loadTunnelStatus();
  }, [isDesktop, loadTunnelStatus]);

  const handleTunnelToggle = useCallback(
    async (checked: boolean) => {
      setTunnelLoading(true);
      try {
        if (checked) {
          const next = await paviiTunnel.start.invoke();
          setTunnelState(next);
          Message.success(t('settings.webui.tunnelStarted', { defaultValue: 'Public link is live.' }));
        } else {
          await paviiTunnel.stop.invoke();
          setTunnelState({ running: false, starting: false });
        }
      } catch (error) {
        Message.error(error instanceof Error ? error.message : String(error));
        await loadTunnelStatus();
      } finally {
        setTunnelLoading(false);
      }
    },
    [t, loadTunnelStatus]
  );

  // Load status
  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const savedAllowRemote = configService.get(DESKTOP_WEBUI_ALLOW_REMOTE_KEY) ?? false;
      setAllowRemotePreference(savedAllowRemote === true);

      // getStatus goes via IPC to the Electron main process which tracks the
      // WebUI lifecycle; backend does not know it's being wrapped.
      const statusData: IWebUIStatus | null = await webui.getStatus.invoke();

      if (statusData) {
        setStatus(statusData);
        // Switch must track the *real* server state, not the persisted
        // preference. Reading `webui.desktop.enabled` from config and using it
        // as the Switch's checked value used to make the Switch look "on" when
        // the main-process auto-restore silently failed (port conflict, etc.),
        // so users clicked the saved URL and got a white screen because 25808
        // was empty. The main process is the sole writer of this key — the
        // start/stop IPC providers and restoreDesktopWebUIFromPreferences own
        // reconciliation, so the renderer only reads `running` and never
        // writes the flag back.
        setWebuiEnabled(statusData.running);

        if (statusData.lanIP) {
          setCachedIP(statusData.lanIP);
        } else if (statusData.networkUrl) {
          const match = statusData.networkUrl.match(/http:\/\/([^:]+):/);
          if (match) {
            setCachedIP(match[1]);
          }
        }
        if (statusData.initialPassword) {
          setCachedPassword(statusData.initialPassword);
          // Having initial password means can show plaintext
          setCanShowPlainPassword(true);
        }
        // 注意：如果 running 但没有密码，会在下面的 useEffect 中自动重置
        // Note: If running but no password, auto-reset will be triggered in the useEffect below
      } else {
        // getStatus failed — fall back to treating server as stopped rather
        // than believing a possibly-stale config flag.
        setWebuiEnabled(false);
        setStatus(
          (prev) =>
            prev || {
              running: false,
              port: WEBUI_DEFAULT_PORT,
              allowRemote: false,
              localUrl: `http://localhost:${WEBUI_DEFAULT_PORT}`,
              adminUsername: 'admin',
            }
        );
      }
    } catch (error) {
      console.error('[WebuiModal] Failed to load WebUI status:', error);
      setWebuiEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Listen to status change events
  useEffect(() => {
    const unsubscribe = webui.statusChanged.on((data) => {
      // Keep the Switch checkbox in lock-step with the actual server state so
      // a main-process auto-restore (or external stop) is reflected in the UI
      // without a page reload.
      setWebuiEnabled(data.running === true);
      if (data.running) {
        setStatus((prev) => ({
          ...(prev || { adminUsername: 'admin' }),
          running: true,
          port: data.port ?? prev?.port ?? WEBUI_DEFAULT_PORT,
          allowRemote: prev?.allowRemote ?? false,
          localUrl: data.localUrl ?? `http://localhost:${data.port ?? WEBUI_DEFAULT_PORT}`,
          networkUrl: data.networkUrl,
          lanIP: prev?.lanIP,
          initialPassword: prev?.initialPassword,
        }));
        if (data.networkUrl) {
          const match = data.networkUrl.match(/http:\/\/([^:]+):/);
          if (match) setCachedIP(match[1]);
        }
      } else {
        setStatus((prev) => (prev ? { ...prev, running: false } : null));
      }
    });
    return () => unsubscribe();
  }, []);

  // 注意：不再自动重置密码，用户已有密码存储在数据库中
  // Note: No longer auto-reset password, user already has password stored in database
  // 如果用户忘记密码，可以手动点击重置按钮
  // If user forgets password, they can manually click reset button
  useEffect(() => {
    // 仅在组件首次加载且没有显示过密码时，标记为密文状态
    // Only when component first loads and password hasn't been shown, mark as hidden
    if (status?.running && !status?.initialPassword && !cachedPassword && !loading) {
      // 不自动重置，只是确保密码显示为 ******
      // Don't auto-reset, just ensure password shows as ******
      setCanShowPlainPassword(false);
    }
  }, [status?.running, status?.initialPassword, cachedPassword, loading]);

  // Get current IP
  const getLocalIP = useCallback(() => {
    if (status?.lanIP) return status.lanIP;
    if (cachedIP) return cachedIP;
    if (status?.networkUrl) {
      const match = status.networkUrl.match(/http:\/\/([^:]+):/);
      if (match) return match[1];
    }
    return null;
  }, [status?.lanIP, cachedIP, status?.networkUrl]);

  // Get display URL.
  // The public tunnel URL wins whenever it is live; otherwise localhost. The
  // LAN-IP URL is deliberately never shown — it silently fails under router
  // AP isolation (observed live) and confused remote access more than it
  // helped. Devices off this machine should use the tunnel.
  const getDisplayUrl = useCallback(() => {
    if (tunnelState?.running && tunnelState.url) return tunnelState.url;
    const currentPort = status?.port || port;
    return `http://localhost:${currentPort}`;
  }, [status?.port, port, tunnelState?.running, tunnelState?.url]);

  // Start/Stop WebUI
  const handleToggle = async (enabled: boolean) => {
    // Use cached IP, no longer block to fetch
    const currentIP = getLocalIP();

    // Save original value for rollback
    const previousEnabled = webuiEnabled;

    // Immediately show loading
    setStartLoading(true);
    setWebuiEnabled(enabled);

    try {
      if (enabled) {
        const localUrl = `http://localhost:${port}`;

        // Await the real result — Promise.race with a 3s fallback used to hide
        // backend failures behind a fake "started" toast while the server was
        // still RESOLVING or had crashed, leaving webui.desktop.enabled unset.
        const startResult = await webui.start.invoke({ port, allowRemote: allowRemotePreference });

        const responseIP = startResult.lanIP || currentIP;
        const responsePassword = startResult.initialPassword;

        if (responseIP) setCachedIP(responseIP);
        if (responsePassword) {
          setCachedPassword(responsePassword);
          setCanShowPlainPassword(true);
        }

        setStatus((prev) => ({
          ...(prev || { adminUsername: 'admin' }),
          running: true,
          port,
          allowRemote: allowRemotePreference,
          localUrl,
          networkUrl: allowRemotePreference && responseIP ? `http://${responseIP}:${port}` : undefined,
          lanIP: responseIP,
          initialPassword: responsePassword || cachedPassword || prev?.initialPassword,
        }));

        await configService.set(DESKTOP_WEBUI_ENABLED_KEY, true);
        Message.success(t('settings.webui.startSuccess'));
      } else {
        // Update UI immediately, stop server async
        setStatus((prev) => (prev ? { ...prev, running: false } : null));
        await configService.set(DESKTOP_WEBUI_ENABLED_KEY, false);
        Message.success(t('settings.webui.stopSuccess'));
        webui.stop.invoke().catch((err) => console.error('WebUI stop error:', err));
      }
    } catch (error) {
      // Rollback UI state
      setWebuiEnabled(previousEnabled);
      console.error('Toggle WebUI error:', error);
      Message.error(t('settings.webui.operationFailed'));
    } finally {
      setStartLoading(false);
    }
  };

  // Handle allow remote toggle
  // Need to restart server to change binding address
  const handleAllowRemoteChange = async (checked: boolean) => {
    // Save original value for rollback
    const previousAllowRemote = allowRemotePreference;
    setAllowRemotePreference(checked);

    const wasRunning = status?.running;

    // 如果服务器正在运行，需要重启以应用新的绑定设置
    // If server is running, need to restart to apply new binding settings
    if (wasRunning) {
      setStartLoading(true);
      try {
        // First stop the server
        try {
          await Promise.race([webui.stop.invoke(), new Promise((resolve) => setTimeout(resolve, 1500))]);
        } catch (err) {
          console.error('WebUI stop error:', err);
        }

        // Await the real result — a 3s race fallback used to mask backend
        // failures as success (see handleToggle).
        const startResult = await webui.start.invoke({ port, allowRemote: checked });

        const responseIP = startResult.lanIP;
        const responsePassword = startResult.initialPassword;

        if (responseIP) setCachedIP(responseIP);
        if (responsePassword) setCachedPassword(responsePassword);

        setStatus((prev) => ({
          ...(prev || { adminUsername: 'admin' }),
          running: true,
          port,
          allowRemote: checked,
          localUrl: `http://localhost:${port}`,
          networkUrl: checked && responseIP ? `http://${responseIP}:${port}` : undefined,
          lanIP: responseIP,
          initialPassword: responsePassword || cachedPassword || prev?.initialPassword,
        }));

        await configService.set(DESKTOP_WEBUI_ALLOW_REMOTE_KEY, checked);
        Message.success(t('settings.webui.restartSuccess'));
      } catch (error) {
        // Rollback UI state
        setAllowRemotePreference(previousAllowRemote);
        console.error('[WebuiModal] Restart error:', error);
        Message.error(t('settings.webui.operationFailed'));
      } finally {
        setStartLoading(false);
      }
    } else {
      // Server not running, persist directly
      try {
        await configService.set(DESKTOP_WEBUI_ALLOW_REMOTE_KEY, checked);

        // Get IP for display
        let newIP: string | undefined;
        try {
          const snapshot = await webui.getStatus.invoke();
          if (snapshot?.lanIP) {
            newIP = snapshot.lanIP;
            setCachedIP(newIP);
          }
        } catch {
          // ignore
        }

        const existingIP = newIP || cachedIP || status?.lanIP;
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                allowRemote: checked,
                lanIP: existingIP || prev.lanIP,
                networkUrl: checked && existingIP ? `http://${existingIP}:${port}` : undefined,
              }
            : null
        );
      } catch (error) {
        // Rollback UI state
        setAllowRemotePreference(previousAllowRemote);
        console.error('[WebuiModal] Failed to persist allowRemote:', error);
        Message.error(t('settings.webui.operationFailed'));
      }
    }
  };

  // Copy content
  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    Message.success(t('common.copySuccess'));
  };

  // Open set new password modal
  const handleResetPassword = () => {
    form.resetFields();
    setSetPasswordModalVisible(true);
  };

  const handleResetUsername = () => {
    usernameForm.setFieldsValue({
      newUsername: status?.adminUsername || 'admin',
    });
    setSetUsernameModalVisible(true);
  };

  // Submit new password
  const handleSetNewPassword = async () => {
    try {
      const values = await form.validate();
      setPasswordLoading(true);

      // changePassword goes through httpBridge; on 4xx/5xx it throws
      // BackendHttpError, caught below and translated via errorCodeMap.
      await webui.changePassword.invoke({
        newPassword: values.newPassword,
      });
      Message.success(t('settings.webui.passwordChanged'));
      setSetPasswordModalVisible(false);
      form.resetFields();
      // Update cached password, no longer show plaintext
      setCachedPassword(values.newPassword);
      setCanShowPlainPassword(false);
      setStatus((prev) => (prev ? { ...prev, initialPassword: undefined } : null));
    } catch (error) {
      console.error('Set new password error:', error);
      const errorCodeMap: Record<string, string> = {
        PASSWORD_TOO_SHORT: t('settings.webui.passwordTooShort'),
        PASSWORD_TOO_LONG: t('settings.webui.passwordTooLong'),
        PASSWORD_TOO_COMMON: t('settings.webui.passwordTooCommon'),
      };
      const rawMsg =
        isBackendHttpError(error) && error.backendMessage
          ? error.backendMessage
          : error instanceof Error
            ? error.message
            : '';
      const codes = rawMsg.split('; ');
      const translated = codes.map((code) => errorCodeMap[code]).filter(Boolean);
      Message.error(translated.length > 0 ? translated.join('; ') : rawMsg || t('settings.webui.passwordChangeFailed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSetNewUsername = async () => {
    try {
      const values = await usernameForm.validate();
      setUsernameLoading(true);

      // HTTP bridge: changeUsername returns { username: string } directly;
      // httpBridge throws BackendHttpError on 4xx/5xx — caught below.
      const result = await webui.changeUsername.invoke({
        newUsername: values.newUsername,
      });
      const nextUsername = result?.username ?? values.newUsername.trim();
      Message.success(t('settings.webui.usernameChanged'));
      setSetUsernameModalVisible(false);
      usernameForm.resetFields();
      setStatus((prev) => (prev ? { ...prev, adminUsername: nextUsername } : null));
    } catch (error) {
      console.error('Set new username error:', error);
      const fallback = t('settings.webui.usernameChangeFailed');
      const msg = isBackendHttpError(error) && error.backendMessage ? error.backendMessage : fallback;
      Message.error(msg);
    } finally {
      setUsernameLoading(false);
    }
  };

  // Generate QR code
  const generateQRCode = useCallback(async () => {
    if (!status?.running) return;

    setQrLoading(true);
    try {
      // Backend returns only { token, expires_at_ms }; the scannable URL is
      // composed here from the current status so it points at the right host
      // (networkUrl for remote-enabled servers, localUrl otherwise).
      const qrData = await webui.generateQRToken.invoke();

      if (qrData) {
        // The public tunnel URL wins: it works from any network (the LAN URL
        // fails under router AP isolation, which is common).
        const baseUrl =
          tunnelState?.running && tunnelState.url
            ? tunnelState.url
            : status.allowRemote && status.networkUrl
              ? status.networkUrl
              : (status.localUrl ?? `http://localhost:${status.port ?? port}`);
        setQrUrl(`${baseUrl}/qr-login?token=${qrData.token}`);
        setQrExpiresAt(qrData.expires_at_ms);

        // 设置自动刷新定时器（4分钟后自动刷新，因为 token 5分钟过期）
        // Set auto-refresh timer (refresh after 4 minutes, as token expires in 5 minutes)
        if (qrRefreshTimerRef.current) {
          clearTimeout(qrRefreshTimerRef.current);
        }
        qrRefreshTimerRef.current = setTimeout(
          () => {
            void generateQRCode();
          },
          4 * 60 * 1000
        );
      } else {
        console.error('Generate QR code failed: no data returned');
        Message.error(t('settings.webui.qrGenerateFailed'));
      }
    } catch (error) {
      console.error('Generate QR code error:', error);
      Message.error(t('settings.webui.qrGenerateFailed'));
    } finally {
      setQrLoading(false);
    }
  }, [
    status?.running,
    status?.allowRemote,
    status?.networkUrl,
    status?.localUrl,
    status?.port,
    port,
    t,
    tunnelState?.running,
    tunnelState?.url,
  ]);

  // Regenerate the QR when the tunnel flips: its URL should always win.
  useEffect(() => {
    setQrUrl(null);
  }, [tunnelState?.running, tunnelState?.url]);

  // QR codes only make sense with a link phones can actually reach: generate
  // them only while the public tunnel is live.
  useEffect(() => {
    if (status?.running && tunnelState?.running && tunnelState.url && !qrUrl) {
      void generateQRCode();
    }
    // Cleanup timer
    return () => {
      if (qrRefreshTimerRef.current) {
        clearTimeout(qrRefreshTimerRef.current);
      }
    };
  }, [status?.running, tunnelState?.running, tunnelState?.url, generateQRCode, qrUrl]);

  // Clear QR code when server or tunnel stops
  useEffect(() => {
    if (!status?.running || !tunnelState?.running) {
      setQrUrl(null);
      setQrExpiresAt(null);
      if (qrRefreshTimerRef.current) {
        clearTimeout(qrRefreshTimerRef.current);
        qrRefreshTimerRef.current = null;
      }
    }
  }, [tunnelState?.running, status?.running]);

  // Format expiration time
  const formatExpiresAt = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  // Get actual password
  const actualPassword = status?.initialPassword || cachedPassword;
  // Get display password
  // Password shows *** by default, only show plaintext on first startup
  // Show loading state when resetting
  const getDisplayPassword = () => {
    // Show plaintext when allowed and has password
    if (canShowPlainPassword && actualPassword) return actualPassword;
    // Otherwise show ******
    return t('settings.webui.passwordHidden');
  };
  const displayPassword = getDisplayPassword();
  const displayUsername = status?.adminUsername || 'admin';

  // In browser mode, only show Channels config, not WebUI service config
  if (!isDesktop) {
    return (
      <div className='flex flex-col h-full w-full'>
        <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
          <div className='space-y-16px'>
            <h2 className='text-20px font-500 text-t-primary m-0'>Channels</h2>
            <Suspense fallback={<div className='text-13px text-t-secondary'>{t('common.loading')}</div>}>
              <ChannelModalContentLazy />
            </Suspense>
          </div>
        </AionScrollArea>
      </div>
    );
  }

  const webuiPanel = (
    <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
      <div className='space-y-12px px-[12px] md:px-[28px]'>
        {/* 标题 / Title */}
        <h2 className='text-20px font-500 text-t-primary m-0'>WebUI</h2>

        {/* 描述说明 / Description */}
        <div className='space-y-6px'>
          <p className='m-0 text-13px text-t-secondary leading-relaxed'>{t('settings.webui.description')}</p>
          <div className='flex flex-wrap gap-x-12px gap-y-6px'>
            {[
              t('settings.webui.enable', { defaultValue: 'Enable WebUI' }),
              t('settings.webui.accessUrl', { defaultValue: 'Access URL' }),
              t('settings.webui.allowRemote', { defaultValue: 'Allow Remote Access' }),
            ].map((stepLabel, idx) => (
              <div key={stepLabel} className='inline-flex items-center gap-6px'>
                <span className='inline-flex items-center justify-center w-16px h-16px rd-50% text-10px font-600 bg-[rgba(var(--primary-6),0.12)] text-[rgb(var(--primary-6))]'>
                  {idx + 1}
                </span>
                <CheckOne theme='outline' size='12' className='text-[rgb(var(--primary-6))]' />
                <span className='text-12px text-t-secondary'>{stepLabel}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Messaging 强引导入口 / Messaging primary entry — disabled, kept for future use
        <div className='rd-12px border border-line bg-2 px-12px py-10px flex items-center justify-between gap-10px'>
            <div className='min-w-0 flex items-center gap-8px'>
              <Communication theme='outline' size='18' className='text-[rgb(var(--primary-6))] shrink-0' />
              <div className='min-w-0'>
                <div className='text-13px text-t-primary font-500'>{t('settings.webui.featureChannelsTitle')}</div>
                <div className='text-12px text-t-secondary truncate'>{t('settings.webui.featureChannelsDesc')}</div>
              </div>
            </div>
            <Button type='primary' size='small' className='rd-100px' onClick={() => setActiveTab('channels')}>
              {t('settings.webui.goToChannels')}
            </Button>
          </div>
        */}

        {/* WebUI 服务卡片 / WebUI Service Card */}
        <div className='px-[12px] md:px-[28px] py-14px bg-2 rd-16px'>
          {/* WebUI 引导提示 / WebUI hint */}
          <div className='mb-8px rd-10px border border-line bg-fill-1 px-10px py-8px flex items-start gap-6px'>
            <Earth theme='outline' size='16' className='mt-1px text-[rgb(var(--primary-6))]' />
            <div className='text-12px text-t-secondary leading-relaxed'>{t('settings.webui.featureRemoteDesc')}</div>
          </div>

          {/* 启用 WebUI / Enable WebUI */}
          <PreferenceRow
            label={t('settings.webui.enable')}
            extra={
              startLoading ? (
                <span className='text-12px text-warning'>{t('settings.webui.starting')}</span>
              ) : status?.running ? (
                <span className='text-12px text-success'>✓ {t('settings.webui.running')}</span>
              ) : null
            }
          >
            <Switch checked={webuiEnabled} loading={startLoading} onChange={handleToggle} />
          </PreferenceRow>

          {/* 访问地址（启用 WebUI 后即显示，不依赖后端 running 状态）/ Access URL (shown whenever WebUI is enabled, not tied to backend running state) */}
          {webuiEnabled && (
            <PreferenceRow label={t('settings.webui.accessUrl')}>
              <div className='flex items-center gap-8px min-w-0'>
                <button
                  className='text-14px text-primary font-mono hover:underline cursor-pointer bg-transparent border-none p-0 truncate'
                  onClick={() => shell.openExternal.invoke(getDisplayUrl()).catch(console.error)}
                >
                  {getDisplayUrl()}
                </button>
                <Tooltip content={t('common.copy')}>
                  <button
                    className='p-4px text-t-tertiary hover:text-t-primary cursor-pointer bg-transparent border-none'
                    onClick={() => handleCopy(getDisplayUrl())}
                  >
                    <Copy size={16} />
                  </button>
                </Tooltip>
              </div>
            </PreferenceRow>
          )}

          {/* 允许局域网访问 / Allow LAN Access */}
          <PreferenceRow
            label={t('settings.webui.allowRemote')}
            description={
              <span className='text-t-secondary'>
                {t('settings.webui.allowRemoteDesc')}
                {'  '}
                <button
                  className='text-primary hover:underline cursor-pointer bg-transparent border-none p-0 text-12px'
                  onClick={() =>
                    void talkToButler({
                      prompt: t('settings.talkToButler.prompt.setupRemote', {
                        defaultValue:
                          'Help me set up remote access so I can open Pavii.Ai from my phone or over the internet.',
                      }),
                    })
                  }
                >
                  {t('settings.webui.letButlerSetup', { defaultValue: 'Let the butler set it up' })}
                </button>
              </span>
            }
          >
            <Switch checked={allowRemotePreference} onChange={handleAllowRemoteChange} />
          </PreferenceRow>

          {/* Public access via Cloudflare quick tunnel */}
          <PreferenceRow
            label={t('settings.webui.tunnel', { defaultValue: 'Public access (Cloudflare Tunnel)' })}
            description={t('settings.webui.tunnelDesc', {
              defaultValue:
                'Get a temporary public HTTPS link that works from any network. The link changes each time it starts; first start may download the tunnel helper.',
            })}
            extra={
              tunnelState?.error && !tunnelState.running ? (
                <span className='text-12px text-danger'>{tunnelState.error}</span>
              ) : null
            }
          >
            <Switch
              checked={tunnelState?.running || false}
              loading={tunnelLoading}
              disabled={!status?.running}
              onChange={handleTunnelToggle}
            />
          </PreferenceRow>
        </div>

        {/* 登录信息卡片 / Login Info Card */}
        <div className='px-[12px] md:px-[28px] py-14px bg-2 rd-16px'>
          <div className='text-14px font-500 mb-8px text-t-primary'>{t('settings.webui.loginInfo')}</div>

          {/* 账号 / Account */}
          <div className='flex items-center justify-between gap-12px py-12px'>
            <span className='text-14px text-t-secondary shrink-0'>{t('settings.webui.username')}:</span>
            <div className='inline-flex items-center gap-8px rd-100px border border-line bg-fill-1 px-10px py-4px min-w-0'>
              <span className='text-14px text-t-primary truncate'>{displayUsername}</span>
              <Tooltip content={t('common.copy')}>
                <Button
                  type='text'
                  size='mini'
                  className='rd-100px !px-6px inline-flex items-center !h-24px'
                  onClick={() => handleCopy(displayUsername)}
                >
                  <Copy size={14} />
                </Button>
              </Tooltip>
              <Tooltip content={t('settings.webui.editUsernameTooltip')}>
                <Button
                  type='text'
                  size='mini'
                  className='rd-100px !px-6px inline-flex items-center !h-24px'
                  onClick={handleResetUsername}
                >
                  <EditTwo size={14} />
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* 密码 / Password */}
          <div className='flex items-center justify-between gap-12px py-12px'>
            <span className='text-14px text-t-secondary shrink-0'>{t('settings.webui.initialPassword')}:</span>
            <div className='inline-flex items-center gap-8px rd-100px border border-line bg-fill-1 px-10px py-4px min-w-0'>
              <span className='text-14px text-t-primary truncate'>{displayPassword}</span>
              <Tooltip content={t('settings.webui.resetPasswordTooltip')}>
                <Button
                  type='text'
                  size='mini'
                  className='rd-100px !px-6px inline-flex items-center !h-24px'
                  onClick={handleResetPassword}
                >
                  <EditTwo size={14} />
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* 二维码登录（仅服务器运行且允许远程访问时显示）/ QR Code Login (only when server running and remote access allowed) */}
          {status?.running && tunnelState?.running && (
            <>
              <div className='border-t border-line my-12px' />
              <div className='text-14px font-500 mb-4px text-t-primary'>{t('settings.webui.qrLogin')}</div>
              <div className='text-12px text-t-tertiary mb-12px'>{t('settings.webui.qrLoginHint')}</div>

              <div className='flex flex-col items-center gap-12px'>
                {/* 二维码显示区域 / QR Code display area */}
                <div className='p-12px bg-fill-1 border border-line rd-10px'>
                  {qrLoading ? (
                    <div className='w-140px h-140px flex items-center justify-center'>
                      <span className='text-14px text-t-tertiary'>{t('common.loading')}</span>
                    </div>
                  ) : qrUrl ? (
                    <div className='p-8px bg-white rd-8px'>
                      <Suspense
                        fallback={
                          <div className='w-140px h-140px flex items-center justify-center'>
                            <span className='text-14px text-t-tertiary'>{t('common.loading')}</span>
                          </div>
                        }
                      >
                        <QRCodeSVGLazy value={qrUrl} size={140} level='M' />
                      </Suspense>
                    </div>
                  ) : (
                    <div className='w-140px h-140px flex items-center justify-center'>
                      <span className='text-14px text-t-tertiary'>{t('settings.webui.qrGenerateFailed')}</span>
                    </div>
                  )}
                </div>

                {/* 过期时间、复制链接和刷新按钮 / Expiration time, copy link and refresh button */}
                <div className='flex items-center gap-8px'>
                  {qrExpiresAt && (
                    <span className='text-12px text-t-tertiary'>
                      {t('settings.webui.qrExpires', { time: formatExpiresAt(qrExpiresAt) })}
                    </span>
                  )}
                  {qrUrl && (
                    <Tooltip content={t('settings.webui.copyQrLink')}>
                      <button
                        className='p-4px bg-transparent border-none text-t-tertiary hover:text-t-primary cursor-pointer'
                        onClick={() => handleCopy(qrUrl)}
                      >
                        <Copy size={16} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content={t('settings.webui.refreshQr')}>
                    <button
                      className='p-4px bg-transparent border-none text-t-tertiary hover:text-t-primary cursor-pointer'
                      onClick={() => void generateQRCode()}
                      disabled={qrLoading}
                    >
                      <Refresh size={16} className={qrLoading ? 'animate-spin' : ''} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AionScrollArea>
  );

  return (
    <div className='flex flex-col h-full w-full'>
      <Tabs
        activeTab={activeTab}
        onChange={(key) => setActiveTab((key as 'webui' | 'channels') || 'webui')}
        type='line'
        className='mb-12px settings-remote-tabs'
      >
        <Tabs.TabPane
          key='webui'
          title={
            <span
              data-webui-tab='webui'
              className={`inline-flex items-center gap-6px transition-colors ${activeTab === 'webui' ? 'text-t-primary font-600' : 'text-t-secondary'}`}
            >
              <Earth theme='outline' size='15' />
              <span>WebUI</span>
            </span>
          }
        />
        <Tabs.TabPane
          key='channels'
          title={
            <span
              data-webui-tab='channels'
              className={`inline-flex items-center gap-6px transition-colors ${activeTab === 'channels' ? 'text-t-primary font-600' : 'text-t-secondary'}`}
            >
              <Communication theme='outline' size='15' />
              <span>Channels</span>
              <span className='inline-flex items-center gap-4px ml-2px'>
                {CHANNEL_LOGOS.map((item) => (
                  <span
                    key={item.alt}
                    className='inline-flex items-center justify-center w-16px h-16px rd-50% border border-line bg-fill-1'
                    title={item.alt}
                    aria-label={item.alt}
                  >
                    <img src={item.src} alt={item.alt} className='w-14px h-14px object-contain' />
                  </span>
                ))}
              </span>
            </span>
          }
        />
      </Tabs>

      {activeTab === 'webui' ? (
        webuiPanel
      ) : (
        <div className='flex-1 min-h-0'>
          <Suspense
            fallback={<div className='px-[12px] md:px-[28px] text-13px text-t-secondary'>{t('common.loading')}</div>}
          >
            <ChannelModalContentLazy />
          </Suspense>
        </div>
      )}

      <AionModal
        visible={setUsernameModalVisible}
        onCancel={() => setSetUsernameModalVisible(false)}
        onOk={handleSetNewUsername}
        confirmLoading={usernameLoading}
        title={t('settings.webui.setNewUsername')}
        size='small'
      >
        <Form form={usernameForm} layout='vertical' className='pt-16px'>
          <Form.Item
            label={t('settings.webui.newUsername')}
            field='newUsername'
            rules={[
              { required: true, message: t('settings.webui.newUsernameRequired') },
              {
                validator: (value, callback) => {
                  if (typeof value !== 'string') {
                    callback();
                    return;
                  }

                  const trimmed = value.trim();
                  if (trimmed.length < 3) {
                    callback(t('settings.webui.usernameMinLength'));
                    return;
                  }

                  if (trimmed.length > 32) {
                    callback(t('settings.webui.usernameMaxLength'));
                    return;
                  }

                  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
                    callback(t('settings.webui.usernameFormatError'));
                    return;
                  }

                  if (/^[_-]|[_-]$/.test(trimmed)) {
                    callback(t('settings.webui.usernameEdgeError'));
                    return;
                  }

                  callback();
                },
              },
            ]}
          >
            <Input placeholder={t('settings.webui.newUsernamePlaceholder')} />
          </Form.Item>
        </Form>
      </AionModal>

      {/* 设置新密码弹窗 / Set New Password Modal */}
      <AionModal
        visible={setPasswordModalVisible}
        onCancel={() => setSetPasswordModalVisible(false)}
        onOk={handleSetNewPassword}
        confirmLoading={passwordLoading}
        title={t('settings.webui.setNewPassword')}
        size='small'
      >
        <Form form={form} layout='vertical' className='pt-16px'>
          <Form.Item
            label={t('settings.webui.newPassword')}
            field='newPassword'
            rules={[
              { required: true, message: t('settings.webui.newPasswordRequired') },
              { minLength: 8, message: t('settings.webui.passwordMinLength') },
            ]}
          >
            <Input.Password placeholder={t('settings.webui.newPasswordPlaceholder')} />
          </Form.Item>
          <Form.Item
            label={t('settings.webui.confirmPassword')}
            field='confirmPassword'
            rules={[
              { required: true, message: t('settings.webui.confirmPasswordRequired') },
              {
                validator: (value, callback) => {
                  if (value !== form.getFieldValue('newPassword')) {
                    callback(t('settings.webui.passwordMismatch'));
                  } else {
                    callback();
                  }
                },
              },
            ]}
          >
            <Input.Password placeholder={t('settings.webui.confirmPasswordPlaceholder')} />
          </Form.Item>
        </Form>
      </AionModal>
    </div>
  );
};

export default WebuiModalContent;
