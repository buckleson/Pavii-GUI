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

const bridge = vi.hoisted(() => ({ getStatus: vi.fn(), install: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    recommendedTools: {
      getStatus: { invoke: bridge.getStatus },
      install: { invoke: bridge.install },
    },
  },
}));

import RecommendedToolsSection from '@/renderer/pages/settings/ToolsSettings/RecommendedToolsSection';

const NONE: RecommendedToolStatus[] = [
  { id: 'trail', installed: false },
  { id: 'headroom', installed: false },
  { id: 'graphify', installed: false },
];

const rowOf = (id: string) => screen.getByTestId(`recommended-tool-status-${id}`);

const renderLoaded = async () => {
  render(<RecommendedToolsSection />);
  await waitFor(() => expect(bridge.getStatus).toHaveBeenCalled());
  await screen.findByTestId('recommended-tool-install-trail');
};

beforeEach(() => {
  vi.clearAllMocks();
  bridge.getStatus.mockResolvedValue(NONE);
  bridge.install.mockResolvedValue({ outcomes: [{ id: 'trail', success: true }] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecommendedToolsSection: status', () => {
  it('shows an Install button for every tool that is not installed', async () => {
    await renderLoaded();
    expect(screen.getAllByText('settings.recommendedTools.install')).toHaveLength(3);
  });

  it('shows the installed version tag instead of Install for an installed tool', async () => {
    bridge.getStatus.mockResolvedValue([{ id: 'headroom', installed: true, version: '0.41.0' }, NONE[0], NONE[2]]);
    await renderLoaded();
    expect(within(rowOf('headroom')).getByText(/installedVersion.*0\.41\.0/)).toBeInTheDocument();
    expect(screen.queryByTestId('recommended-tool-install-headroom')).not.toBeInTheDocument();
  });

  it('shows the plain installed tag when no version is known', async () => {
    bridge.getStatus.mockResolvedValue([{ id: 'graphify', installed: true }, NONE[0], NONE[1]]);
    await renderLoaded();
    expect(within(rowOf('graphify')).getByText('settings.recommendedTools.installed')).toBeInTheDocument();
  });

  it('shows statusLoadFailed when the status cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.getStatus.mockRejectedValue(new Error('ipc down'));
    render(<RecommendedToolsSection />);
    await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.recommendedTools.statusLoadFailed'));
  });
});

describe('RecommendedToolsSection: installing one tool', () => {
  it('installs only the clicked tool', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('recommended-tool-install-trail'));
    await waitFor(() => expect(bridge.install).toHaveBeenCalledWith({ tools: ['trail'] }));
  });

  it('confirms success and shows the refreshed status', async () => {
    await renderLoaded();
    bridge.getStatus.mockResolvedValue([{ id: 'trail', installed: true, version: '0.25.0' }, NONE[1], NONE[2]]);
    fireEvent.click(screen.getByTestId('recommended-tool-install-trail'));
    expect(await within(rowOf('trail')).findByText(/installedVersion.*0\.25\.0/)).toBeInTheDocument();
    expect(messageSuccess).toHaveBeenCalledTimes(1);
  });

  it('disables the other Install buttons while one tool installs', async () => {
    bridge.install.mockReturnValue(new Promise(() => {}));
    await renderLoaded();
    fireEvent.click(screen.getByTestId('recommended-tool-install-trail'));
    await waitFor(() => expect(screen.getByTestId('recommended-tool-install-headroom')).toBeDisabled());
  });

  it('shows the mapped error with a docs link when the install fails', async () => {
    bridge.install.mockResolvedValue({ outcomes: [{ id: 'trail', success: false, error: 'download-failed' }] });
    await renderLoaded();
    fireEvent.click(screen.getByTestId('recommended-tool-install-trail'));
    await waitFor(() => expect(messageError).toHaveBeenCalledWith(expect.objectContaining({ duration: 8000 })));
    render(messageError.mock.calls[0][0].content);
    expect(screen.getByText(/errors\.downloadFailed/)).toBeInTheDocument();
  });

  it('opens the tool docs from the failure message', async () => {
    bridge.install.mockResolvedValue({ outcomes: [{ id: 'trail', success: false, error: 'timeout' }] });
    await renderLoaded();
    fireEvent.click(screen.getByTestId('recommended-tool-install-trail'));
    await waitFor(() => expect(messageError).toHaveBeenCalled());
    render(messageError.mock.calls[0][0].content);
    fireEvent.click(screen.getByText('settings.recommendedTools.docs'));
    expect(platform.openExternalUrl).toHaveBeenCalledWith('https://github.com/trailhq/Trail-Code#readme');
  });

  it('shows the unknown error and still refreshes when install throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.install.mockRejectedValue(new Error('ipc down'));
    await renderLoaded();
    fireEvent.click(screen.getByTestId('recommended-tool-install-trail'));
    await waitFor(() => expect(bridge.getStatus).toHaveBeenCalledTimes(2));
    render(messageError.mock.calls[0][0].content);
    expect(screen.getByText(/errors\.unknown/)).toBeInTheDocument();
  });
});
