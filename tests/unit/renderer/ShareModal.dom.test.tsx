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
vi.mock('@/common', () => ({
  ipcBridge: { shell: { openExternal: { invoke: openExternal } } },
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

beforeEach(() => {
  drawnText.length = 0;
  openExternal.mockClear();
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
});
