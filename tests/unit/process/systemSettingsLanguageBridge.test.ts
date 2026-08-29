/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The main process has to be told when the language changes, so it can switch
 * its own i18n and relabel the tray.
 *
 * That notification was registered on `systemSettings.changeLanguage`, which is
 * an HTTP method — and HTTP-backed methods have a no-op `provider`
 * (httpBridge.ts, `provider: () => {}`). The handler was therefore never
 * dispatched: the tray kept its old language and the main-process i18n never
 * switched, while the renderer looked correct because persistence goes over
 * HTTP and worked fine.
 *
 * These tests pin the channel, not just the behaviour — registering on an
 * HTTP-backed method is silent, so only asserting "the handler runs" would go
 * green again the moment someone moved it back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const i18nChangeLanguage = vi.fn(async () => undefined);
const refreshTray = vi.fn();

type Handler = (params: { language: string }) => Promise<void>;
const registered: Record<string, Handler> = {};
const provider = (name: string) => ({
  provider: (handler: Handler) => {
    registered[name] = handler;
  },
});

vi.mock('@/common', () => ({
  ipcBridge: {
    systemSettings: {
      getCloseToTray: provider('getCloseToTray'),
      setCloseToTray: provider('setCloseToTray'),
      notifyLanguageChanged: provider('notifyLanguageChanged'),
      // Present so a handler wrongly registered here is captured and caught,
      // rather than throwing and masking the real assertion.
      changeLanguage: provider('changeLanguage'),
      languageChanged: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: { get: vi.fn(), set: vi.fn() } }));
vi.mock('@process/services/i18n', () => ({ changeLanguage: (...a: unknown[]) => i18nChangeLanguage(...(a as [])) }));
vi.mock('@process/utils/tray', () => ({
  createOrUpdateTray: vi.fn(),
  destroyTray: vi.fn(),
  setCloseToTrayEnabled: vi.fn(),
}));
vi.mock('@process/utils/closeToTraySetting', () => ({
  readCloseToTraySetting: vi.fn(async () => false),
  writeCloseToTraySetting: vi.fn(async () => undefined),
}));

const { initSystemSettingsBridge, onLanguageChanged } = await import('@process/bridge/systemSettingsBridge');

describe('language change reaches the main process', () => {
  beforeEach(() => {
    for (const key of Object.keys(registered)) delete registered[key];
    i18nChangeLanguage.mockClear();
    refreshTray.mockClear();
    initSystemSettingsBridge();
  });

  it('registers on an IPC channel, not on the HTTP-backed changeLanguage', () => {
    expect(registered.notifyLanguageChanged).toBeTypeOf('function');
    // changeLanguage is httpPatch; its provider is a no-op, so a handler here is dead.
    expect(registered.changeLanguage).toBeUndefined();
  });

  it('relabels the tray', async () => {
    onLanguageChanged(refreshTray);

    await registered.notifyLanguageChanged({ language: 'zh-CN' });

    expect(refreshTray).toHaveBeenCalledTimes(1);
  });

  it('switches the main-process i18n to the chosen language', async () => {
    await registered.notifyLanguageChanged({ language: 'ja-JP' });

    expect(i18nChangeLanguage).toHaveBeenCalledWith('ja-JP');
  });

  it('still relabels the tray when the i18n switch fails', async () => {
    onLanguageChanged(refreshTray);
    i18nChangeLanguage.mockRejectedValueOnce(new Error('locale bundle missing'));

    await expect(registered.notifyLanguageChanged({ language: 'de-DE' })).resolves.toBeUndefined();

    expect(refreshTray).toHaveBeenCalledTimes(1);
  });
});
