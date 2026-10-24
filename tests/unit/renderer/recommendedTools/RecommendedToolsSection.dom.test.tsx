/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendedToolStatus } from '@/common/types/agent/recommendedTools';

// A stable t, as react-i18next gives: the section's refresh callback depends on it.
const i18n = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: i18n.t, i18n: { language: 'en' } }) }));

const { messageError, messageSuccess } = vi.hoisted(() => ({ messageError: vi.fn(), messageSuccess: vi.fn() }));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: { error: messageError, success: messageSuccess, warning: vi.fn() } };
});

const platform = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  openExternalUrl: platform.openExternalUrl,
}));

const bridge = vi.hoisted(() => ({
  getStatus: vi.fn(),
  install: vi.fn(),
  setEnabled: vi.fn(),
  autoInstallListeners: [] as Array<() => void>,
  unsubscribe: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    recommendedTools: {
      getStatus: { invoke: bridge.getStatus },
      install: { invoke: bridge.install },
      setEnabled: { invoke: bridge.setEnabled },
      autoInstallFinished: {
        on: (listener: () => void) => {
          bridge.autoInstallListeners.push(listener);
          return bridge.unsubscribe;
        },
      },
    },
  },
}));

import RecommendedToolsSection from '@/renderer/pages/settings/ToolsSettings/RecommendedToolsSection';

const NONE: RecommendedToolStatus[] = [
  { id: 'trail', installed: false },
  { id: 'headroom', installed: false },
  { id: 'graphify', installed: false },
  { id: 'reach', installed: false },
];

/** NONE with some entries replaced by id. */
const statusesWith = (...changed: RecommendedToolStatus[]): RecommendedToolStatus[] =>
  NONE.map((status) => changed.find((item) => item.id === status.id) ?? status);

const rowOf = (id: string) => screen.getByTestId(`recommended-tool-status-${id}`);
const switchButton = (id: string) => screen.getByTestId(`recommended-tool-switch-${id}`);

const renderLoaded = async () => {
  render(<RecommendedToolsSection />);
  await waitFor(() => expect(bridge.getStatus).toHaveBeenCalled());
  await screen.findByTestId('recommended-tool-status-reach');
};

beforeEach(() => {
  vi.clearAllMocks();
  bridge.autoInstallListeners = [];
  bridge.getStatus.mockResolvedValue(NONE);
  bridge.install.mockResolvedValue({ outcomes: [{ id: 'headroom', success: true }] });
  bridge.setEnabled.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecommendedToolsSection: status', () => {
  it('shows a row for each of the four Pavii tools', async () => {
    await renderLoaded();
    expect(['trail', 'headroom', 'graphify', 'reach'].map((id) => within(rowOf(id)).getByText(/Pavii/))).toHaveLength(
      4
    );
  });

  it('shows pending for a tool that is not installed and has no failure', async () => {
    await renderLoaded();
    expect(within(rowOf('trail')).getByText('settings.recommendedTools.pending')).toBeInTheDocument();
  });

  it('shows installing for a tool the automatic install is working on', async () => {
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'graphify', installed: false, installing: true }));
    await renderLoaded();
    expect(await within(rowOf('graphify')).findByText('settings.recommendedTools.installing')).toBeInTheDocument();
  });

  it('shows the installed version tag for an installed tool', async () => {
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'headroom', installed: true, version: '0.41.0' }));
    await renderLoaded();
    expect(await within(rowOf('headroom')).findByText(/installedVersion.*0\.41\.0/)).toBeInTheDocument();
  });

  it('shows the plain installed tag when no version is known', async () => {
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'graphify', installed: true }));
    await renderLoaded();
    expect(await within(rowOf('graphify')).findByText('settings.recommendedTools.installed')).toBeInTheDocument();
  });

  it('shows the mapped last error and a Retry button for a failed tool', async () => {
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'reach', installed: false, lastError: 'timeout' }));
    await renderLoaded();
    expect(await within(rowOf('reach')).findByText(/installFailed.*errors\.timeout/)).toBeInTheDocument();
    expect(screen.getByTestId('recommended-tool-retry-reach')).toBeInTheDocument();
  });

  it('shows no Retry button for a tool without a failure', async () => {
    await renderLoaded();
    expect(screen.queryByTestId('recommended-tool-retry-trail')).not.toBeInTheDocument();
  });

  it('shows statusLoadFailed when the status cannot be loaded', async () => {
    bridge.getStatus.mockRejectedValue(new Error('ipc down'));
    render(<RecommendedToolsSection />);
    await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.recommendedTools.statusLoadFailed'));
  });

  it('reloads the status when the automatic install finishes', async () => {
    await renderLoaded();
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'trail', installed: true, version: '0.25.0' }));
    bridge.autoInstallListeners.forEach((listener) => listener());
    expect(await within(rowOf('trail')).findByText(/installedVersion.*0\.25\.0/)).toBeInTheDocument();
  });

  it('stops listening for the automatic install on unmount', async () => {
    render(<RecommendedToolsSection />).unmount();
    expect(bridge.unsubscribe).toHaveBeenCalled();
  });
});

describe('RecommendedToolsSection: on/off switch', () => {
  it('shows an installed, enabled tool as on', async () => {
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'trail', installed: true, enabled: true }));
    await renderLoaded();
    await waitFor(() => expect(switchButton('trail')).toHaveAttribute('aria-checked', 'true'));
  });

  it('disables the switch of a tool that is not installed', async () => {
    await renderLoaded();
    expect(switchButton('headroom')).toBeDisabled();
  });

  it('turns an installed tool off and reloads the status', async () => {
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'trail', installed: true, enabled: true }));
    await renderLoaded();
    await waitFor(() => expect(switchButton('trail')).not.toBeDisabled());
    fireEvent.click(switchButton('trail'));
    await waitFor(() => expect(bridge.setEnabled).toHaveBeenCalledWith({ id: 'trail', enabled: false }));
    await waitFor(() => expect(bridge.getStatus).toHaveBeenCalledTimes(2));
  });

  it('shows toggleFailed when switching fails', async () => {
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'reach', installed: true, enabled: false }));
    bridge.setEnabled.mockRejectedValue(new Error('toggle failed'));
    await renderLoaded();
    await waitFor(() => expect(switchButton('reach')).not.toBeDisabled());
    fireEvent.click(switchButton('reach'));
    await waitFor(() =>
      expect(messageError).toHaveBeenCalledWith(expect.stringContaining('settings.recommendedTools.toggleFailed'))
    );
  });
});

describe('RecommendedToolsSection: Retry', () => {
  const failed = () => statusesWith({ id: 'headroom', installed: false, lastError: 'download-failed' });

  it('installs only the retried tool', async () => {
    bridge.getStatus.mockResolvedValue(failed());
    await renderLoaded();
    fireEvent.click(await screen.findByTestId('recommended-tool-retry-headroom'));
    await waitFor(() => expect(bridge.install).toHaveBeenCalledWith({ tools: ['headroom'] }));
  });

  it('confirms success and shows the refreshed status', async () => {
    bridge.getStatus.mockResolvedValue(failed());
    await renderLoaded();
    bridge.getStatus.mockResolvedValue(statusesWith({ id: 'headroom', installed: true, version: '0.41.0' }));
    fireEvent.click(await screen.findByTestId('recommended-tool-retry-headroom'));
    expect(await within(rowOf('headroom')).findByText(/installedVersion.*0\.41\.0/)).toBeInTheDocument();
    expect(messageSuccess).toHaveBeenCalledWith(expect.stringContaining('Pavii Compress'));
  });

  it('shows installing and disables the switches while the retry runs', async () => {
    bridge.getStatus.mockResolvedValue(
      statusesWith({ id: 'headroom', installed: false, lastError: 'timeout' }, { id: 'trail', installed: true })
    );
    bridge.install.mockReturnValue(new Promise(() => {}));
    await renderLoaded();
    fireEvent.click(await screen.findByTestId('recommended-tool-retry-headroom'));
    expect(await within(rowOf('headroom')).findByText('settings.recommendedTools.installing')).toBeInTheDocument();
    expect(switchButton('trail')).toBeDisabled();
  });

  it('shows the mapped error when the retry fails', async () => {
    bridge.getStatus.mockResolvedValue(failed());
    bridge.install.mockResolvedValue({ outcomes: [{ id: 'headroom', success: false, error: 'checksum-mismatch' }] });
    await renderLoaded();
    fireEvent.click(await screen.findByTestId('recommended-tool-retry-headroom'));
    await waitFor(() =>
      expect(messageError).toHaveBeenCalledWith(expect.stringMatching(/installFailedToast.*errors\.checksumMismatch/))
    );
  });

  it('shows the unknown error and still refreshes when install throws', async () => {
    bridge.getStatus.mockResolvedValue(failed());
    bridge.install.mockRejectedValue(new Error('ipc down'));
    await renderLoaded();
    fireEvent.click(await screen.findByTestId('recommended-tool-retry-headroom'));
    await waitFor(() =>
      expect(messageError).toHaveBeenCalledWith(expect.stringMatching(/installFailedToast.*errors\.unknown/))
    );
    await waitFor(() => expect(bridge.getStatus).toHaveBeenCalledTimes(2));
  });
});
