/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DayActivity } from './profileStats';
import { formatCompactNumber } from './profileStats';

/**
 * Canvas rendering for the shareable activity card, plus the social intent
 * URLs. No web intent can attach a file, so the intent carries only the text
 * summary and the card goes to the clipboard for the user to paste into the
 * composer (see ShareModal); saving the PNG stays available as the fallback.
 */

export type ShareCardData = {
  name: string;
  handle: string;
  initials: string;
  totalTokens: number;
  peakDayTokens: number;
  currentStreak: number;
  longestStreak: number;
  daily: DayActivity[];
};

export type ShareCardTheme = {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  avatar: string;
  cellEmpty: string;
};

export const SHARE_CARD_LIGHT: ShareCardTheme = {
  // The card has to read as a distinct surface against the backdrop, so the
  // backdrop is tinted rather than the near-white it used to be.
  bg: '#eceef3',
  card: '#ffffff',
  border: '#dfe2ea',
  text: '#16161a',
  muted: '#6b6b76',
  accent: '#7033ff',
  avatar: '#12a67c',
  cellEmpty: '#e2e5ec',
};

export const SHARE_CARD_DARK: ShareCardTheme = {
  bg: '#0b0b0d',
  card: '#161619',
  border: '#232327',
  text: '#f4f4f6',
  muted: '#8b8b95',
  accent: '#3f8cff',
  avatar: '#17a97f',
  cellEmpty: '#26262b',
};

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

const WEEKS = 26;
const ROWS = 7;

/** Intensity 0..4 relative to the maximum value in view. */
const intensityOf = (value: number, max: number): number => {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
};

const mixWithEmpty = (theme: ShareCardTheme, level: number): string => {
  if (level === 0) return theme.cellEmpty;
  const alpha = [0, 0.35, 0.55, 0.78, 1][level];
  const hex = theme.accent.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;

/** Draw the share card onto a canvas (sized SHARE_CARD_WIDTH x HEIGHT). */
export function renderShareCard(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
  theme: ShareCardTheme,
  logo?: HTMLImageElement
): void {
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const font = (size: number, weight = 400) =>
    `${weight} ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // Card surface
  const pad = 64;
  const cardW = SHARE_CARD_WIDTH - pad * 2;
  const cardH = SHARE_CARD_HEIGHT - pad * 2;
  ctx.fillStyle = theme.card;
  ctx.beginPath();
  ctx.roundRect(pad, pad, cardW, cardH, 28);
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Identity row: avatar disc with initials, name and handle beside it.
  const left = pad + 56;
  const identityY = pad + 88;
  const avatarR = 34;

  ctx.fillStyle = theme.avatar;
  ctx.beginPath();
  ctx.arc(left + avatarR, identityY, avatarR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = font(26, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.initials.slice(0, 2).toUpperCase(), left + avatarR, identityY + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const textLeft = left + avatarR * 2 + 24;
  ctx.fillStyle = theme.text;
  ctx.font = font(34, 700);
  ctx.fillText(data.name, textLeft, identityY - 2);
  if (data.handle) {
    ctx.fillStyle = theme.muted;
    ctx.font = font(20);
    ctx.fillText(data.handle, textLeft, identityY + 28);
  }

  // Brand mark, right aligned on the identity row.
  const brandRight = pad + cardW - 56;
  ctx.fillStyle = theme.text;
  ctx.font = font(24, 600);
  ctx.textAlign = 'right';
  ctx.fillText('Pavii.Ai', brandRight, identityY + 8);
  if (logo) {
    const brandTextWidth = ctx.measureText('Pavii.Ai').width;
    ctx.drawImage(logo, brandRight - brandTextWidth - 46, identityY - 16, 34, 34);
  }
  ctx.textAlign = 'left';

  // Heatmap
  const cell = 20;
  const gap = 6;
  const gridWidth = WEEKS * cell + (WEEKS - 1) * gap;
  const gridLeft = (SHARE_CARD_WIDTH - gridWidth) / 2;
  const gridTop = identityY + 92;
  const byDay = new Map(data.daily.map((d) => [d.day, d]));
  const max = Math.max(...data.daily.map((d) => (d.tokens > 0 ? d.tokens : d.activity)), 1);
  const today = new Date();

  for (let w = 0; w < WEEKS; w++) {
    for (let r = 0; r < ROWS; r++) {
      const daysAgo = (WEEKS - 1 - w) * 7 + (ROWS - 1 - r);
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
      const row = byDay.get(dayKey(date));
      const value = row ? (row.tokens > 0 ? row.tokens : row.activity) : 0;
      ctx.fillStyle = mixWithEmpty(theme, intensityOf(value, max));
      ctx.beginPath();
      ctx.roundRect(gridLeft + w * (cell + gap), gridTop + r * (cell + gap), cell, cell, 5);
      ctx.fill();
    }
  }

  // Stat row
  const statsY = gridTop + ROWS * (cell + gap) + 96;
  const stats: Array<[string, string]> = [
    [formatCompactNumber(data.totalTokens), 'lifetime tokens'],
    [formatCompactNumber(data.peakDayTokens), 'peak day'],
    [`${data.currentStreak} days`, 'current streak'],
    [`${data.longestStreak} days`, 'longest streak'],
  ];
  const slot = cardW / stats.length;
  stats.forEach(([value, label], i) => {
    const cx = pad + slot * i + slot / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    ctx.font = font(42, 700);
    ctx.fillText(value, cx, statsY);
    ctx.fillStyle = theme.muted;
    ctx.font = font(19);
    ctx.fillText(label, cx, statsY + 34);
  });
  ctx.textAlign = 'left';
}

/**
 * Where someone reading the post goes to get the app. The Dev Tools page
 * rather than the site root: it is the product the card is about.
 *
 * A full URL, not a bare domain — X renders a link as its domain plus a
 * truncated path and gives no way to set custom anchor text, so a bare
 * `pavii.tech` token only ever landed on the marketing homepage.
 */
export const SHARE_DOWNLOAD_URL = 'https://www.pavii.tech/products/dev-tools/';

/** The rest of the range, for readers who want the company rather than the app. */
export const SHARE_SITE_URL = 'https://pavii.tech';

export type ShareNetwork = 'x' | 'linkedin' | 'reddit';

/**
 * Web intent URL for a network.
 *
 * Takes the card data rather than a prebuilt string because the networks do
 * not want the same shape: X and LinkedIn post one block of prose with the
 * link inside it, while Reddit needs the headline and the link as separate
 * fields.
 */
export function buildShareIntentUrl(network: ShareNetwork, data: ShareCardData): string {
  switch (network) {
    case 'x':
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(data))}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(buildShareText(data))}`;
    case 'reddit':
      // Reddit prefills ONLY `title` and `url` — it has no body parameter, and
      // `text`/`selftext` are silently ignored. Posting the whole summary as
      // the title therefore buried the link somewhere it does not even render
      // as a link. Splitting it makes this a normal link post: headline in
      // `title`, destination in `url`, which Reddit renders and unfurls.
      return `https://www.reddit.com/submit?title=${encodeURIComponent(buildShareSummary(data))}&url=${encodeURIComponent(SHARE_DOWNLOAD_URL)}`;
  }
}

/** The summary without the link, for networks that carry the link separately. */
export function buildShareSummary(data: ShareCardData): string {
  return `${formatCompactNumber(data.totalTokens)} lifetime tokens, ${data.currentStreak}-day streak on Pavii.Ai — my personal AI workspace.`;
}

/**
 * Text summary for the intents that post one block of prose.
 *
 * Carries both destinations on their own lines: the download link for readers
 * who want the app, and the site for anyone after the wider range. Reddit gets
 * only the first — its submit page takes a single `url` and has no body.
 */
export function buildShareText(data: ShareCardData): string {
  return [buildShareSummary(data), ``, `Download: ${SHARE_DOWNLOAD_URL}`, `More products: ${SHARE_SITE_URL}`].join(
    '\n'
  );
}

/**
 * The card as a PNG blob, for putting on the clipboard.
 *
 * `toBlob` rather than the `toDataURL` the save path uses: a clipboard write
 * needs a real Blob, and going through a base64 data URL would mean decoding it
 * straight back again.
 */
export function shareCardBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
