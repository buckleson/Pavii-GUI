/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quitAndInstallMock: vi.fn(),
  autoUpdateCheckMock: vi.fn(),
  updateCheckMock: vi.fn(),
  messageInfoMock: vi.fn(),
  messageErrorMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === 'update.preparingInstall'
        ? 'Preparing install...'
        : key === 'settings.updateReadyInstall'
          ? `${params?.version} is ready, install now`
          : key === 'settings.builtinToolsCreditsItem'
            ? `${params?.name} | ${params?.upstream} | ${params?.license}`
            : key,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, info: mocks.messageInfoMock, error: mocks.messageErrorMock },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    autoUpdate: {
      quitAndInstall: {
        invoke: mocks.quitAndInstallMock,
      },
      check: { invoke: mocks.autoUpdateCheckMock },
    },
    update: {
      check: { invoke: mocks.updateCheckMock },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  openExternalUrl: mocks.openExternalUrlMock,
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({
  default: () => null,
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';
import { setUpdateReadyState } from '@/renderer/components/settings/updateReadyState';

describe('AboutModalContent update ready state', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.13');
    mocks.quitAndInstallMock.mockResolvedValue(undefined);
    mocks.autoUpdateCheckMock.mockResolvedValue({ success: true });
    mocks.updateCheckMock.mockResolvedValue({
      success: true,
      data: { currentVersion: '2.1.13', updateAvailable: false, latest: null },
    });
  });

  afterEach(() => {
    setUpdateReadyState({ ready: false, version: '' });
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('replaces check update with ready-to-install when an update package is ready', async () => {
    render(<AboutModalContent />);

    expect(screen.getByRole('button', { name: 'settings.checkForUpdates' })).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aionui-update-ready-state-changed', {
          detail: {
            ready: true,
            version: '2.1.14',
          },
        })
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: '2.1.14 is ready, install now' }));

    expect(mocks.quitAndInstallMock).toHaveBeenCalledTimes(1);
  });

  it('shows preparing loading state for ready auto-update install from About', async () => {
    let rejectInstall!: (error: Error) => void;
    mocks.quitAndInstallMock.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInstall = reject;
        })
    );

    render(<AboutModalContent />);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aionui-update-ready-state-changed', {
          detail: {
            ready: true,
            version: '2.1.14',
          },
        })
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: '2.1.14 is ready, install now' }));

    expect(await screen.findByRole('button', { name: 'Preparing install...' })).toBeDisabled();
    expect(mocks.quitAndInstallMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectInstall(new Error('prepare failed'));
    });

    expect(await screen.findByRole('button', { name: '2.1.14 is ready, install now' })).not.toBeDisabled();
  });

  it('reveals the notification card only when an update is available, with no toast', async () => {
    mocks.updateCheckMock.mockResolvedValue({
      success: true,
      data: {
        currentVersion: '2.1.13',
        updateAvailable: true,
        latest: {
          tagName: 'v2.1.14',
          version: '2.1.14',
          name: 'v2.1.14',
          body: 'notes',
          htmlUrl: 'https://example.com/r',
          prerelease: false,
          draft: false,
          assets: [],
        },
      },
    });
    const availableListener = vi.fn();
    window.addEventListener('aionui-update-available', availableListener);

    render(<AboutModalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.checkForUpdates' }));

    await waitFor(() => {
      expect(availableListener).toHaveBeenCalledTimes(1);
    });
    const detail = (availableListener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.kind).toBe('available');
    expect(detail.updateInfo.version).toBe('2.1.14');
    expect(mocks.messageInfoMock).not.toHaveBeenCalled();

    window.removeEventListener('aionui-update-available', availableListener);
  });

  it('shows an up-to-date toast and no card when there is no update', async () => {
    const availableListener = vi.fn();
    window.addEventListener('aionui-update-available', availableListener);

    render(<AboutModalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.checkForUpdates' }));

    await waitFor(() => {
      expect(mocks.messageInfoMock).toHaveBeenCalledWith('update.alreadyLatest');
    });
    expect(availableListener).not.toHaveBeenCalled();

    window.removeEventListener('aionui-update-available', availableListener);
  });
});

/**
 * The About page is the only place inside the app that tells a user analytics
 * exist. `readme.md` previously claimed the opposite ("ships no analytics or
 * telemetry") while PostHog shipped in every build, so this guards both that the
 * notice renders and that it keeps saying the things that make it honest.
 *
 * It is inline text rather than a "learn more" link on purpose: this repository
 * is private, so a GitHub link would 404 for every user, and the marketing site
 * has no privacy page.
 */
describe('AboutModalContent analytics disclosure', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.66');
    mocks.autoUpdateCheckMock.mockResolvedValue({ success: true });
    mocks.updateCheckMock.mockResolvedValue({
      success: true,
      data: { currentVersion: '2.1.66', updateAvailable: false, latest: null },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the notice', () => {
    render(<AboutModalContent />);
    // The i18n mock echoes keys back, so presence of the key is presence of the text.
    expect(screen.getByText('settings.analyticsNoticeTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.analyticsNoticeBody')).toBeInTheDocument();
  });

  it('keeps the shipped English copy truthful about what is and is not sent', async () => {
    const catalogue = (await import('@/renderer/services/i18n/locales/en-US/settings.json')) as unknown as {
      default: Record<string, string>;
    };
    const body = (catalogue.default ?? (catalogue as unknown as Record<string, string>))['analyticsNoticeBody'];

    expect(body, 'analyticsNoticeBody must exist in en-US').toBeTruthy();
    // The three claims that make the notice honest rather than decorative.
    expect(body.toLowerCase()).toContain('conversations');
    expect(body.toLowerCase()).toContain('api key');
    // There is genuinely no runtime opt-out — POSTHOG_DISABLED is a build-time
    // Vite define. The copy must not imply otherwise.
    expect(body.toLowerCase()).toContain('no way to turn this off');
  });
});

describe('AboutModalContent upstream credits for the Pavii agent tools', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.13');
    mocks.openExternalUrlMock.mockResolvedValue(undefined);
    mocks.updateCheckMock.mockResolvedValue({
      success: true,
      data: { currentVersion: '2.1.13', updateAvailable: false, latest: null },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const creditOf = (id: string) => within(screen.getByTestId(`about-builtin-tool-${id}`));

  it('shows the credits title and the note about changes', () => {
    render(<AboutModalContent />);
    const block = within(screen.getByTestId('about-builtin-tools'));
    expect(block.getByText('settings.builtinToolsCreditsTitle')).toBeInTheDocument();
    expect(block.getByText('settings.builtinToolsCreditsNote')).toBeInTheDocument();
  });

  it.each([
    ['trail', 'Pavii Code Map | Trail-Code | MIT', 'Copyright (c) 2026 Context Graph Engine contributors'],
    ['headroom', 'Pavii Compress | Headroom | Apache-2.0', 'Copyright 2025 Headroom Contributors'],
    ['graphify', 'Pavii Graph | graphify | Apache-2.0', 'Copyright 2026 Safi Shamsi and the Graphify contributors'],
    ['reach', 'Pavii Reach | Agent Reach | MIT', 'Copyright (c) 2025 Agent Eyes'],
  ])('credits %s with its upstream name, license and copyright', (id, item, copyright) => {
    render(<AboutModalContent />);
    expect(creditOf(id).getByText(item)).toBeInTheDocument();
    expect(creditOf(id).getByText(copyright)).toBeInTheDocument();
  });

  it('opens the upstream repository from the credit link', async () => {
    render(<AboutModalContent />);
    fireEvent.click(creditOf('reach').getByText('https://github.com/Panniantong/Agent-Reach'));
    await waitFor(() =>
      expect(mocks.openExternalUrlMock).toHaveBeenCalledWith('https://github.com/Panniantong/Agent-Reach')
    );
  });
});
