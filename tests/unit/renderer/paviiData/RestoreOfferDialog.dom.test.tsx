/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestoreOffer } from '@/common/types/agent/paviiData';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const { messageError } = vi.hoisted(() => ({ messageError: vi.fn() }));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: { error: messageError, success: vi.fn(), warning: vi.fn() } };
});

const platform = vi.hoisted(() => ({ isElectron: true }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => platform.isElectron }));

type DeepLinkHandler = (payload: { action: string }) => void;
const bridge = vi.hoisted(() => ({
  getRestoreOffer: vi.fn(),
  dismissRestoreOffer: vi.fn(),
  importBackup: vi.fn(),
  unsubscribe: vi.fn(),
  deepLinkHandlers: [] as Array<(payload: { action: string }) => void>,
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    paviiData: {
      getRestoreOffer: { invoke: bridge.getRestoreOffer },
      dismissRestoreOffer: { invoke: bridge.dismissRestoreOffer },
      importBackup: { invoke: bridge.importBackup },
    },
    deepLink: {
      received: {
        on: (handler: DeepLinkHandler) => {
          bridge.deepLinkHandlers.push(handler);
          return bridge.unsubscribe;
        },
      },
    },
  },
}));

import RestoreOfferDialog from '@/renderer/components/settings/PaviiBackup/RestoreOfferDialog';

const makeOffer = (overrides: Partial<RestoreOffer> = {}): RestoreOffer => ({
  path: 'C:\\Users\\me\\.pavii\\backup.pavii',
  createdAt: '2026-10-01T10:00:00.000Z',
  reason: 'new-account',
  hasSecrets: false,
  counts: { providers: 2, agents: 0, sessions: 5 },
  ...overrides,
});

const SUMMARY = [{ section: 'providers', restored: 2, skipped: 0, failed: 0 }];

const renderWithOffer = async (offer: RestoreOffer = makeOffer()) => {
  bridge.getRestoreOffer.mockResolvedValue(offer);
  const view = render(<RestoreOfferDialog />);
  await screen.findByTestId('pavii-restore-offer');
  return view;
};

const clickButton = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('RestoreOfferDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.deepLinkHandlers.length = 0;
    platform.isElectron = true;
    bridge.getRestoreOffer.mockResolvedValue(null);
    bridge.dismissRestoreOffer.mockResolvedValue(undefined);
    bridge.importBackup.mockResolvedValue({ success: true, summary: SUMMARY, secretsRestored: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading the offer', () => {
    it('renders nothing when there is no offer', async () => {
      render(<RestoreOfferDialog />);
      await waitFor(() => expect(bridge.getRestoreOffer).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('pavii-restore-offer')).not.toBeInTheDocument();
    });

    it('neither fetches nor renders outside the Electron desktop app', () => {
      platform.isElectron = false;
      render(<RestoreOfferDialog />);
      expect(bridge.getRestoreOffer).not.toHaveBeenCalled();
      expect(screen.queryByTestId('pavii-restore-offer')).not.toBeInTheDocument();
    });

    it('logs and renders nothing when the offer cannot be loaded', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.getRestoreOffer.mockRejectedValue(new Error('ipc down'));
      render(<RestoreOfferDialog />);
      await waitFor(() => expect(consoleError).toHaveBeenCalled());
      expect(screen.queryByTestId('pavii-restore-offer')).not.toBeInTheDocument();
    });

    it('shows the new-account reason and only the non-zero section counts', async () => {
      await renderWithOffer();
      expect(screen.getByText('settings.paviiData.offer.newAccount')).toBeInTheDocument();
      expect(screen.getByText('settings.paviiData.sections.providers').nextSibling).toHaveTextContent('2');
      expect(screen.queryByText('settings.paviiData.sections.agents')).not.toBeInTheDocument();
    });

    it('shows the empty-profile reason without a password field when the backup has no secrets', async () => {
      await renderWithOffer(makeOffer({ reason: 'empty-profile', counts: {} }));
      expect(screen.getByText('settings.paviiData.offer.emptyProfile')).toBeInTheDocument();
      expect(screen.queryByTestId('pavii-restore-password')).not.toBeInTheDocument();
    });

    it('re-fetches the offer after a successful sign-in deep link only', async () => {
      render(<RestoreOfferDialog />);
      await waitFor(() => expect(bridge.getRestoreOffer).toHaveBeenCalledTimes(1));
      bridge.deepLinkHandlers.forEach((handler) => handler({ action: 'open/conversation' }));
      bridge.deepLinkHandlers.forEach((handler) => handler({ action: 'auth/success' }));
      await waitFor(() => expect(bridge.getRestoreOffer).toHaveBeenCalledTimes(2));
    });

    it('unsubscribes from deep links on unmount', async () => {
      const { unmount } = render(<RestoreOfferDialog />);
      await waitFor(() => expect(bridge.getRestoreOffer).toHaveBeenCalled());
      unmount();
      expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('restoring', () => {
    it('imports the offered backup and shows the summary', async () => {
      await renderWithOffer();
      clickButton('settings.paviiData.offer.restore');
      expect(await screen.findByTestId('pavii-backup-summary')).toBeInTheDocument();
      expect(bridge.importBackup).toHaveBeenCalledWith({
        path: 'C:\\Users\\me\\.pavii\\backup.pavii',
        password: undefined,
      });
    });

    it('passes the typed password when the backup holds secrets', async () => {
      await renderWithOffer(makeOffer({ hasSecrets: true }));
      fireEvent.change(screen.getByTestId('pavii-restore-password'), { target: { value: 'secret' } });
      clickButton('settings.paviiData.offer.restore');
      await waitFor(() =>
        expect(bridge.importBackup).toHaveBeenCalledWith({
          path: 'C:\\Users\\me\\.pavii\\backup.pavii',
          password: 'secret',
        })
      );
    });

    it('keeps the offer open after a wrong password', async () => {
      bridge.importBackup.mockResolvedValue({ success: false, error: 'wrong-password' });
      await renderWithOffer(makeOffer({ hasSecrets: true }));
      clickButton('settings.paviiData.offer.restore');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.errors.wrongPassword'));
      expect(screen.getByTestId('pavii-restore-offer')).toBeInTheDocument();
    });

    it('closes the offer and shows the mapped error for an invalid file', async () => {
      bridge.importBackup.mockResolvedValue({ success: false, error: 'invalid-file' });
      await renderWithOffer();
      clickButton('settings.paviiData.offer.restore');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.errors.invalidFile'));
      await waitFor(() => expect(screen.queryByTestId('pavii-restore-offer')).not.toBeInTheDocument());
    });

    it('shows the unknown-error message when the import call throws', async () => {
      bridge.importBackup.mockRejectedValue(new Error('ipc down'));
      await renderWithOffer();
      clickButton('settings.paviiData.offer.restore');
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('settings.paviiData.errors.unknown'));
      expect(screen.queryByTestId('pavii-backup-summary')).not.toBeInTheDocument();
    });
  });

  describe('dismissing', () => {
    it('dismisses the offer on "Not now" without importing', async () => {
      await renderWithOffer();
      clickButton('settings.paviiData.offer.notNow');
      expect(bridge.dismissRestoreOffer).toHaveBeenCalledTimes(1);
      expect(bridge.importBackup).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByTestId('pavii-restore-offer')).not.toBeInTheDocument());
    });

    it('logs instead of throwing when dismissing fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      bridge.dismissRestoreOffer.mockRejectedValue(new Error('ipc down'));
      await renderWithOffer();
      clickButton('settings.paviiData.offer.notNow');
      await waitFor(() => expect(consoleError).toHaveBeenCalled());
    });
  });
});
