/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DeepLinkPayload = { action: string };

const SIGN_IN_URL = 'https://www.pavii.tech/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fauth';

const mocks = vi.hoisted(() => ({
  isElectronDesktop: vi.fn<() => boolean>(() => true),
  getSession: vi.fn<() => Promise<unknown>>(),
  signIn: vi.fn(() =>
    Promise.resolve('https://www.pavii.tech/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fauth')
  ),
  openExternal: vi.fn(() => Promise.resolve()),
  deepLinkHandlers: [] as Array<(payload: DeepLinkPayload) => void>,
  unsubscribe: vi.fn(),
}));

vi.mock('@renderer/utils/platform', () => ({
  isElectronDesktop: mocks.isElectronDesktop,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    paviiAuth: {
      getSession: { invoke: mocks.getSession },
      signIn: { invoke: mocks.signIn },
    },
    shell: {
      openExternal: { invoke: mocks.openExternal },
    },
    deepLink: {
      received: {
        on: vi.fn((handler: (payload: DeepLinkPayload) => void) => {
          mocks.deepLinkHandlers.push(handler);
          return mocks.unsubscribe;
        }),
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import PaviiSignInGate from '@renderer/components/base/PaviiSignInGate';

const emitDeepLink = async (payload: DeepLinkPayload) => {
  await act(async () => {
    for (const handler of mocks.deepLinkHandlers) handler(payload);
  });
};

describe('PaviiSignInGate', () => {
  const clipboardWriteText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

  beforeEach(() => {
    mocks.isElectronDesktop.mockReturnValue(true);
    mocks.getSession.mockReset();
    mocks.deepLinkHandlers.length = 0;
    clipboardWriteText.mockClear();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    mocks.signIn.mockClear();
    mocks.openExternal.mockClear();
    mocks.unsubscribe.mockClear();
  });

  /** Render the signed-out gate and click the primary sign-up CTA so the fallback row appears. */
  const renderAndStartSignUp = async () => {
    mocks.getSession.mockResolvedValue(null);
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.signUp')).toBeTruthy());
    fireEvent.click(screen.getByText('paviiGate.signUp'));
    await waitFor(() => expect(screen.getByText('paviiGate.reopen')).toBeTruthy());
  };

  it('renders nothing and never queries the session outside Electron desktop', () => {
    mocks.isElectronDesktop.mockReturnValue(false);
    const { container } = render(<PaviiSignInGate />);
    expect(container.firstChild).toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('renders nothing when a session already exists', async () => {
    mocks.getSession.mockResolvedValue({ uid: 'uid-1', signedInAt: 1 });
    const { container } = render(<PaviiSignInGate />);
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByText('paviiGate.titleLead')).toBeNull();
  });

  it('shows the welcome gate headline with the Pavii.Ai brand span when there is no session', async () => {
    mocks.getSession.mockResolvedValue(null);
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.titleLead')).toBeTruthy());
    const brand = screen.getByText('Pavii.Ai', { selector: 'span' });
    expect(brand.tagName).toBe('SPAN');
  });

  it('renders the three value-row texts', async () => {
    mocks.getSession.mockResolvedValue(null);
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.value1')).toBeTruthy());
    expect(screen.getByText('paviiGate.value2')).toBeTruthy();
    expect(screen.getByText('paviiGate.value3')).toBeTruthy();
  });

  it('starts the signup flow from the primary button', async () => {
    mocks.getSession.mockResolvedValue(null);
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.signUp')).toBeTruthy());
    fireEvent.click(screen.getByText('paviiGate.signUp'));
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenCalledWith({ mode: 'signup' });
  });

  it('starts the signin flow from the secondary button and disables it while waiting', async () => {
    mocks.getSession.mockResolvedValue(null);
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.signIn')).toBeTruthy());
    const secondary = screen.getByText('paviiGate.signIn').closest('button') as HTMLButtonElement;
    fireEvent.click(secondary);
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenCalledWith({ mode: 'signin' });
    await waitFor(() => expect(secondary.disabled).toBe(true));
  });

  it('hides the fallback buttons before any CTA click', async () => {
    mocks.getSession.mockResolvedValue(null);
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.titleLead')).toBeTruthy());
    expect(screen.queryByText('paviiGate.reopen')).toBeNull();
    expect(screen.queryByText('paviiGate.copy')).toBeNull();
  });

  it('shows both fallback buttons after the sign-up CTA resolves a sign-in URL', async () => {
    await renderAndStartSignUp();
    expect(screen.getByText('paviiGate.reopen')).toBeTruthy();
    expect(screen.getByText('paviiGate.copy')).toBeTruthy();
  });

  it('reopens the exact resolved sign-in URL via shell.openExternal', async () => {
    await renderAndStartSignUp();
    fireEvent.click(screen.getByText('paviiGate.reopen'));
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    expect(mocks.openExternal).toHaveBeenCalledWith(SIGN_IN_URL);
  });

  it('copies the sign-in URL to the clipboard and flips the label to the copied text', async () => {
    await renderAndStartSignUp();
    fireEvent.click(screen.getByText('paviiGate.copy'));
    expect(clipboardWriteText).toHaveBeenCalledTimes(1);
    expect(clipboardWriteText).toHaveBeenCalledWith(SIGN_IN_URL);
    await waitFor(() => expect(screen.getByText('paviiGate.copied')).toBeTruthy());
    expect(screen.queryByText('paviiGate.copy')).toBeNull();
  });

  it('hides the fallback buttons after an auth/error deep link', async () => {
    await renderAndStartSignUp();

    await emitDeepLink({ action: 'auth/error' });

    await waitFor(() => expect(screen.queryByText('paviiGate.reopen')).toBeNull());
    expect(screen.queryByText('paviiGate.copy')).toBeNull();
    expect(screen.queryByText('paviiGate.copied')).toBeNull();
  });

  it('shows the error line on the auth/error deep link', async () => {
    mocks.getSession.mockResolvedValue(null);
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.titleLead')).toBeTruthy());
    expect(screen.queryByText('paviiGate.error')).toBeNull();

    await emitDeepLink({ action: 'auth/error' });

    await waitFor(() => expect(screen.getByText('paviiGate.error')).toBeTruthy());
  });

  it('re-queries the session on the auth/success deep link and hides the overlay', async () => {
    mocks.getSession.mockResolvedValueOnce(null).mockResolvedValueOnce({ uid: 'uid-1', signedInAt: 1 });
    render(<PaviiSignInGate />);
    await waitFor(() => expect(screen.getByText('paviiGate.titleLead')).toBeTruthy());
    expect(mocks.deepLinkHandlers.length).toBeGreaterThan(0);

    await emitDeepLink({ action: 'auth/success' });

    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('paviiGate.titleLead')).toBeNull());
  });

  it('fails open (renders nothing) when the session query rejects', async () => {
    mocks.getSession.mockRejectedValue(new Error('bridge unavailable'));
    const { container } = render(<PaviiSignInGate />);
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByText('paviiGate.titleLead')).toBeNull();
  });
});
