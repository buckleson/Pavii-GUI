/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SHARE_CARD_DARK,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_LIGHT,
  SHARE_CARD_WIDTH,
  buildShareIntentUrl,
  buildShareText,
  renderShareCard,
  type ShareCardData,
} from '@/renderer/pages/profile/shareCard';

type Recorder = {
  ctx: Record<string, unknown>;
  fills: string[];
  texts: Array<{ text: string; x: number; y: number }>;
};

/** Minimal recording 2D context - jsdom has no real canvas backend. */
function makeCanvas(): { canvas: HTMLCanvasElement; rec: Recorder } {
  const rec: Recorder = { ctx: {}, fills: [], texts: [] };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: vi.fn(function (this: { fillStyle: string }) {
      rec.fills.push(this.fillStyle);
    }),
    roundRect: vi.fn(),
    arc: vi.fn(),
    beginPath: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 80 })),
    fill: vi.fn(function (this: { fillStyle: string }) {
      rec.fills.push(this.fillStyle);
    }),
    fillText: vi.fn((text: string, x: number, y: number) => {
      rec.texts.push({ text, x, y });
    }),
  };
  rec.ctx = ctx;

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;

  return { canvas, rec };
}

const data: ShareCardData = {
  name: 'Buckleson',
  handle: 'vijay@example.com',
  initials: 'bu',
  totalTokens: 4_900_000_000,
  peakDayTokens: 561_500_000,
  currentStreak: 13,
  longestStreak: 13,
  daily: [{ day: '2026-08-18', tokens: 1000, activity: 5 }],
};

describe('renderShareCard', () => {
  it('sizes the canvas to the share dimensions', () => {
    const { canvas } = makeCanvas();
    renderShareCard(canvas, data, SHARE_CARD_DARK);
    expect(canvas.width).toBe(SHARE_CARD_WIDTH);
    expect(canvas.height).toBe(SHARE_CARD_HEIGHT);
  });

  it('draws the identity, brand mark and every stat', () => {
    const { canvas, rec } = makeCanvas();
    renderShareCard(canvas, data, SHARE_CARD_DARK);

    const drawn = rec.texts.map((t) => t.text);
    expect(drawn).toContain('Buckleson');
    expect(drawn).toContain('vijay@example.com');
    expect(drawn).toContain('Pavii.Ai');
    expect(drawn).toContain('lifetime tokens');
    expect(drawn).toContain('peak day');
    expect(drawn).toContain('current streak');
    expect(drawn).toContain('longest streak');
    expect(drawn).toContain('13 days');
  });

  it('uppercases the avatar initials and keeps them to two characters', () => {
    const { canvas, rec } = makeCanvas();
    renderShareCard(canvas, { ...data, initials: 'buck' }, SHARE_CARD_DARK);
    expect(rec.texts.map((t) => t.text)).toContain('BU');
  });

  it('omits the handle row when there is no handle', () => {
    const { canvas, rec } = makeCanvas();
    renderShareCard(canvas, { ...data, handle: '' }, SHARE_CARD_DARK);
    expect(rec.texts.map((t) => t.text)).not.toContain('');
    expect(rec.texts.map((t) => t.text)).toContain('Buckleson');
  });

  it('paints the backdrop so the card is never a blank canvas', () => {
    const { canvas, rec } = makeCanvas();
    renderShareCard(canvas, data, SHARE_CARD_DARK);
    expect(rec.fills).toContain(SHARE_CARD_DARK.bg);
    expect(rec.fills).toContain(SHARE_CARD_DARK.card);
  });

  it('keeps the light card distinguishable from its backdrop', () => {
    // The card used to be #ffffff on #fdfdfd, which read as an empty panel.
    expect(SHARE_CARD_LIGHT.card).not.toBe(SHARE_CARD_LIGHT.bg);
  });

  it('draws the logo when one is supplied', () => {
    const { canvas, rec } = makeCanvas();
    const logo = {} as HTMLImageElement;
    renderShareCard(canvas, data, SHARE_CARD_DARK, logo);
    expect((rec.ctx as { drawImage: ReturnType<typeof vi.fn> }).drawImage).toHaveBeenCalled();
  });

  it('survives an empty activity history', () => {
    const { canvas, rec } = makeCanvas();
    expect(() => renderShareCard(canvas, { ...data, daily: [] }, SHARE_CARD_LIGHT)).not.toThrow();
    expect(rec.texts.map((t) => t.text)).toContain('Buckleson');
  });
});

describe('buildShareIntentUrl', () => {
  it('encodes the summary into each network intent', () => {
    const text = 'hello world & more';
    expect(buildShareIntentUrl('x', text)).toContain('twitter.com/intent/tweet?text=');
    expect(buildShareIntentUrl('linkedin', text)).toContain('linkedin.com');
    expect(buildShareIntentUrl('reddit', text)).toContain('reddit.com/submit?title=');
    expect(buildShareIntentUrl('x', text)).toContain(encodeURIComponent(text));
  });
});

describe('buildShareText', () => {
  it('summarises tokens and streak', () => {
    const text = buildShareText(data);
    expect(text).toContain('13-day streak');
    expect(text).toContain('pavii.tech');
  });
});
