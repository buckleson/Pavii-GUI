/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

const openExternal = vi.hoisted(() => vi.fn());
const copyImageIpc = vi.hoisted(() => vi.fn());
// The DOM setup defines window.electronAPI globally, so the real
// isElectronDesktop() is always true here; this switch lets the browser
// path be tested too.
const electronMode = vi.hoisted(() => ({ value: true }));

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { openExternal: { invoke: openExternal } },
    paviiClipboard: { copyImage: { invoke: copyImageIpc } },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => electronMode.value,
}));

vi.mock('@renderer/assets/logos/brand/app.png', () => ({ default: 'brand.png' }));

import ShareModal from '@/renderer/pages/profile/ShareModal';
import type { ShareCardData } from '@/renderer/pages/profile/shareCard';

const data: ShareCardData = {
  name: 'Buckleson',
  handle: 'vijay@example.com',
  initials: 'BU',
  totalTokens: 4_900_000_000,
  peakDayTokens: 561_500_000,
  currentStreak: 13,
  longestStreak: 13,
  daily: [{ day: '2026-08-18', tokens: 1000, activity: 5 }],
};

const drawnText: string[] = [];

const clipboardWrite = vi.hoisted(() => vi.fn());
const toBlob = vi.hoisted(() => vi.fn());

beforeEach(() => {
  drawnText.length = 0;
  openExternal.mockClear();
  clipboardWrite.mockReset();
  clipboardWrite.mockResolvedValue(undefined);
  copyImageIpc.mockReset();
  copyImageIpc.mockResolvedValue(true);
  electronMode.value = true;
  // jsdom has no canvas backend; toDataURL only logs 'Not implemented'.
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,QUFB');
  toBlob.mockReset();
  // jsdom implements neither, and the component feature-detects both.
  toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })));
  HTMLCanvasElement.prototype.toBlob = toBlob as unknown as HTMLCanvasElement['toBlob'];
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { write: clipboardWrite }, configurable: true });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(public items: Record<string, Blob>) {}
    }
  );
  // jsdom has no canvas backend; record what the card draws instead.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: vi.fn(),
    roundRect: vi.fn(),
    arc: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 80 })),
    fillText: vi.fn((text: string) => {
      drawnText.push(text);
    }),
  })) as unknown as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  cleanup();
});

const renderModal = (visible: boolean) =>
  render(
    <ConfigProvider>
      <ShareModal visible={visible} onClose={vi.fn()} data={data} isDark={true} />
    </ConfigProvider>
  );

describe('ShareModal', () => {
  it('draws the card once the modal body mounts', async () => {
    // Regression: the draw used to run against a ref that was still null,
    // because Arco mounts the modal body on a later render. The card stayed
    // blank and nothing retried.
    renderModal(true);

    await waitFor(() => {
      expect(screen.getByTestId('share-card-canvas')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(drawnText).toContain('Buckleson');
    });
    expect(drawnText).toContain('Pavii.Ai');
  });

  it('draws even when the logo image never resolves', async () => {
    // jsdom never fires load/error for images, which is exactly the hung-asset
    // case: the card must not depend on the logo to appear at all.
    renderModal(true);

    await waitFor(() => {
      expect(drawnText).toContain('Buckleson');
    });
  });

  it('does not draw while hidden', () => {
    renderModal(false);
    expect(drawnText).toHaveLength(0);
  });

  it('offers a share action per network plus save', async () => {
    renderModal(true);

    await waitFor(() => {
      expect(screen.getByTestId('share-action-x')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-action-linkedin')).toBeInTheDocument();
    expect(screen.getByTestId('share-action-reddit')).toBeInTheDocument();
    expect(screen.getByTestId('share-action-save')).toBeInTheDocument();
  });

  it('opens the network intent externally rather than in-app', async () => {
    renderModal(true);

    await waitFor(() => {
      expect(screen.getByTestId('share-action-x')).toBeInTheDocument();
    });
    screen.getByTestId('share-action-x').click();

    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledTimes(1);
    });
    expect(String(openExternal.mock.calls[0][0])).toContain('twitter.com/intent/tweet');
  });

  it('copies the card so it can be pasted into the post', async () => {
    // No web intent can attach a file, so without this the post carries only
    // prose and X shows the unfurled link's artwork instead of the card.
    electronMode.value = false;
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-x')).toBeInTheDocument());

    screen.getByTestId('share-action-x').click();

    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    const written = clipboardWrite.mock.calls[0][0] as Array<{ items: Record<string, Blob> }>;
    expect(Object.keys(written[0].items)).toEqual(['image/png']);
  });

  it.each([
    ['linkedin', 'linkedin.com'],
    ['reddit', 'reddit.com/submit'],
  ])('copies the card for %s too, since no intent can attach a file', async (network, host) => {
    // The card matters as much on LinkedIn and Reddit as on X — none of the
    // three accept a file — so all three must go through the same copy step.
    electronMode.value = false;
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId(`share-action-${network}`)).toBeInTheDocument());

    screen.getByTestId(`share-action-${network}`).click();

    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(String(openExternal.mock.calls[0][0])).toContain(host);
  });

  it.each(['x', 'linkedin', 'reddit'])('sends %s to the Dev Tools page', async (network) => {
    // Every network carries the same summary, so the link fix must reach all
    // three — not just the one it was reported against.
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId(`share-action-${network}`)).toBeInTheDocument());

    screen.getByTestId(`share-action-${network}`).click();

    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    const intent = String(openExternal.mock.calls[0][0]);
    expect(decodeURIComponent(intent)).toContain('https://www.pavii.tech/products/dev-tools/');
  });

  it('writes through the main process in Electron, not the navigator API', async () => {
    // The renderer navigator path rejected image writes with no visible
    // cause; the deterministic path is main-process writeImage over IPC.
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-x')).toBeInTheDocument());

    screen.getByTestId('share-action-x').click();

    await waitFor(() => expect(copyImageIpc).toHaveBeenCalledTimes(1));
    expect(copyImageIpc.mock.calls[0][0].dataUrl).toMatch(/^data:image\/png/);
    expect(clipboardWrite).not.toHaveBeenCalled();
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
  });

  it('still opens the composer when the main-process write reports failure', async () => {
    copyImageIpc.mockResolvedValue(false);
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-x')).toBeInTheDocument());

    screen.getByTestId('share-action-x').click();

    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
  });
  it('tells the user the card is ready to paste', async () => {
    // Arco's static Message.* helpers mount via the legacy ReactDOM.render,
    // which React 19 removed: they reject instead of rendering, so the toast
    // silently never appeared. Assert the text actually reaches the DOM.
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-x')).toBeInTheDocument());

    screen.getByTestId('share-action-x').click();

    await waitFor(() => {
      expect(screen.getByText(/paste it into the post/i)).toBeInTheDocument();
    });
  });

  it('finishes the copy before handing focus to the browser', async () => {
    // Chromium refuses a clipboard write from an unfocused document, and
    // opening the intent raises the browser over this window. Firing both at
    // once lost that race, so the composer opened with nothing to paste and X
    // fell back to unfurling the link instead of showing the card.
    electronMode.value = false;
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-x')).toBeInTheDocument());

    screen.getByTestId('share-action-x').click();

    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(clipboardWrite.mock.invocationCallOrder[0]).toBeLessThan(openExternal.mock.invocationCallOrder[0]);
  });

  it('still opens the composer when the clipboard write is refused', async () => {
    // A rejected clipboard promise must cost the image, not the post — letting
    // it swallow the share would make the button look dead.
    electronMode.value = false;
    clipboardWrite.mockRejectedValue(new Error('denied'));
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-x')).toBeInTheDocument());

    screen.getByTestId('share-action-x').click();

    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
  });

  it('still opens the composer where the clipboard API is unavailable', async () => {
    // The packaged app runs the renderer from file://; if that ever stops
    // counting as a secure context, sharing must degrade, not break.
    electronMode.value = false;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-x')).toBeInTheDocument());

    screen.getByTestId('share-action-x').click();

    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it('saves the card under a stable filename', async () => {
    // The hint tells users to fall back to Save image, so the download path is
    // load-bearing; it had no coverage at all.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('share-action-save')).toBeInTheDocument());

    screen.getByTestId('share-action-save').click();

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('pavii-activity.png');
    click.mockRestore();
  });
});
