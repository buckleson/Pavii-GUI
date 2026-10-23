/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: i18n.t, i18n: { language: 'en' } }) }));

const platform = vi.hoisted(() => ({ isElectron: true, openExternalUrl: vi.fn() }));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => platform.isElectron,
  openExternalUrl: platform.openExternalUrl,
}));

const bridge = vi.hoisted(() => ({ getOffer: vi.fn(), dismiss: vi.fn(), install: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    recommendedTools: {
      getFirstRunOffer: { invoke: bridge.getOffer },
      dismissFirstRunOffer: { invoke: bridge.dismiss },
      install: { invoke: bridge.install },
    },
  },
}));

import RecommendedToolsDialog from '@/renderer/components/settings/RecommendedTools/RecommendedToolsDialog';

const IDS = ['trail', 'headroom', 'graphify'] as const;
const ALL_OK = { outcomes: IDS.map((id) => ({ id, success: true })) };

const checkboxOf = (id: string): HTMLInputElement => {
  const element = screen.getByTestId(`recommended-tool-checkbox-${id}`);
  return (element instanceof HTMLInputElement ? element : element.querySelector('input')) as HTMLInputElement;
};

const renderOffer = async () => {
  bridge.getOffer.mockResolvedValue(true);
  const view = render(<RecommendedToolsDialog />);
  await screen.findByTestId('recommended-tools-offer');
  return view;
};

const clickInstall = () => fireEvent.click(screen.getByTestId('recommended-tools-install'));

beforeEach(() => {
  vi.clearAllMocks();
  platform.isElectron = true;
  bridge.getOffer.mockResolvedValue(false);
  bridge.dismiss.mockResolvedValue(undefined);
  bridge.install.mockResolvedValue(ALL_OK);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RecommendedToolsDialog: showing the offer', () => {
  it('neither asks nor renders outside the Electron desktop app', () => {
    platform.isElectron = false;
    render(<RecommendedToolsDialog />);
    expect(bridge.getOffer).not.toHaveBeenCalled();
    expect(screen.queryByTestId('recommended-tools-offer')).not.toBeInTheDocument();
  });

  it('renders nothing when the main process does not offer', async () => {
    render(<RecommendedToolsDialog />);
    await waitFor(() => expect(bridge.getOffer).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('recommended-tools-offer')).not.toBeInTheDocument();
  });

  it('logs and renders nothing when the offer check rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.getOffer.mockRejectedValue(new Error('ipc down'));
    render(<RecommendedToolsDialog />);
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.queryByTestId('recommended-tools-offer')).not.toBeInTheDocument();
  });

  it('lists the three tools', async () => {
    await renderOffer();
    expect(IDS.map((id) => screen.queryByTestId(`recommended-tool-${id}`) !== null)).toEqual([true, true, true]);
  });

  it('starts with every tool checked', async () => {
    await renderOffer();
    expect(IDS.map((id) => checkboxOf(id).checked)).toEqual([true, true, true]);
  });

  it('opens the source repository from the tool row', async () => {
    await renderOffer();
    fireEvent.click(screen.getByTestId('recommended-tool-repo-headroom'));
    expect(platform.openExternalUrl).toHaveBeenCalledWith('https://github.com/headroomlabs-ai/headroom');
  });
});

describe('RecommendedToolsDialog: selecting and installing', () => {
  it('disables Install when no tool is checked', async () => {
    await renderOffer();
    IDS.forEach((id) => fireEvent.click(checkboxOf(id)));
    expect(screen.getByTestId('recommended-tools-install')).toBeDisabled();
  });

  it('installs only the checked tools', async () => {
    await renderOffer();
    fireEvent.click(checkboxOf('trail'));
    clickInstall();
    await waitFor(() => expect(bridge.install).toHaveBeenCalledWith({ tools: ['headroom', 'graphify'] }));
  });

  it('shows a success result per installed tool', async () => {
    await renderOffer();
    clickInstall();
    const result = await screen.findByTestId('recommended-tool-result-graphify');
    expect(result).toHaveTextContent('settings.recommendedTools.installSucceeded');
  });

  it('shows the mapped error for a failed tool', async () => {
    bridge.install.mockResolvedValue({
      outcomes: [
        { id: 'trail', success: false, error: 'npm-missing' },
        { id: 'headroom', success: true },
        { id: 'graphify', success: true },
      ],
    });
    await renderOffer();
    clickInstall();
    const result = await screen.findByTestId('recommended-tool-result-trail');
    expect(result).toHaveTextContent('settings.recommendedTools.errors.npmMissing');
  });

  it('opens the tool docs from a failed result', async () => {
    bridge.install.mockResolvedValue({ outcomes: [{ id: 'graphify', success: false, error: 'timeout' }] });
    await renderOffer();
    clickInstall();
    const result = await screen.findByTestId('recommended-tool-result-graphify');
    fireEvent.click(within(result).getByText('settings.recommendedTools.docs'));
    expect(platform.openExternalUrl).toHaveBeenCalledWith('https://github.com/Graphify-Labs/graphify#readme');
  });

  it('keeps the dialog open past the close delay when a tool failed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    bridge.install.mockResolvedValue({ outcomes: [{ id: 'trail', success: false, error: 'command-failed' }] });
    await renderOffer();
    clickInstall();
    await screen.findByTestId('recommended-tool-result-trail');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('recommended-tools-offer')).toBeInTheDocument();
  });

  it('marks every selected tool failed with the unknown error when install throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.install.mockRejectedValue(new Error('ipc down'));
    await renderOffer();
    fireEvent.click(checkboxOf('headroom'));
    clickInstall();
    await screen.findByTestId('recommended-tool-result-trail');
    expect(screen.getAllByText(/settings\.recommendedTools\.errors\.unknown/)).toHaveLength(2);
    expect(screen.queryByTestId('recommended-tool-result-headroom')).not.toBeInTheDocument();
  });

  it('closes by itself after every tool installed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderOffer();
    clickInstall();
    await screen.findByTestId('recommended-tool-result-trail');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(screen.queryByTestId('recommended-tools-offer')).not.toBeInTheDocument());
  });
});

describe('RecommendedToolsDialog: dismissing', () => {
  it('dismisses the offer on Not now without installing', async () => {
    await renderOffer();
    fireEvent.click(screen.getByTestId('recommended-tools-not-now'));
    expect(bridge.dismiss).toHaveBeenCalledTimes(1);
    expect(bridge.install).not.toHaveBeenCalled();
  });

  it('dismisses the offer on Close after the results', async () => {
    bridge.install.mockResolvedValue({ outcomes: [{ id: 'trail', success: false, error: 'timeout' }] });
    await renderOffer();
    clickInstall();
    fireEvent.click(await screen.findByTestId('recommended-tools-close'));
    expect(bridge.dismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('recommended-tools-offer')).not.toBeInTheDocument());
  });

  it('logs instead of throwing when dismissing fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.dismiss.mockRejectedValue(new Error('ipc down'));
    await renderOffer();
    fireEvent.click(screen.getByTestId('recommended-tools-not-now'));
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
  });
});
