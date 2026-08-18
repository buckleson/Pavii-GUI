/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DayActivity } from './profileStats';
import { formatCompactNumber } from './profileStats';

/**
 * Canvas rendering for the shareable activity card, plus the social intent
 * URLs. The image itself cannot be attached to web intents; like other
 * activity cards, the user saves the PNG and attaches it manually, while the
 * intent carries a text summary.
 */

export type ShareCardData = {
  name: string;
  handle: string;
  totalTokens: number;
  peakDayTokens: number;
  currentStreak: number;
  longestStreak: number;
  daily: DayActivity[];
};

export type ShareCardTheme = {
  bg: string;
  card: string;
  text: string;
  muted: string;
  accent: string;
  cellEmpty: string;
};

export const SHARE_CARD_LIGHT: ShareCardTheme = {
  bg: '#fdfdfd',
  card: '#ffffff',
  text: '#16161a',
  muted: '#6b6b76',
  accent: '#7033ff',
  cellEmpty: '#ececf1',
};

export const SHARE_CARD_DARK: ShareCardTheme = {
  bg: '#000000',
  card: '#111111',
  text: '#f2f2f2',
  muted: '#a4a4a4',
  accent: '#5895ff',
  cellEmpty: '#1d1d1d',
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

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // Card surface
  const pad = 60;
  ctx.fillStyle = theme.card;
  ctx.beginPath();
  ctx.roundRect(pad, pad, SHARE_CARD_WIDTH - pad * 2, SHARE_CARD_HEIGHT - pad * 2, 24);
  ctx.fill();

  // Identity row
  const left = pad + 48;
  let y = pad + 84;
  if (logo) ctx.drawImage(logo, left, y - 44, 56, 56);
  ctx.fillStyle = theme.text;
  ctx.font = font(34, 700);
  ctx.fillText(data.name, left + (logo ? 76 : 0), y);
  ctx.fillStyle = theme.muted;
  ctx.font = font(20);
  ctx.fillText(data.handle, left + (logo ? 76 : 0), y + 30);
  ctx.textAlign = 'right';
  ctx.fillStyle = theme.muted;
  ctx.font = font(24, 600);
  ctx.fillText('Pavii.Ai', SHARE_CARD_WIDTH - pad - 48, y);
  ctx.textAlign = 'left';

  // Heatmap
  const gridTop = y + 70;
  const cell = 16;
  const gap = 5;
  const gridWidth = WEEKS * (cell + gap);
  const gridLeft = (SHARE_CARD_WIDTH - gridWidth) / 2;
  const byDay = new Map(data.daily.map((d) => [d.day, d]));
  const max = Math.max(...data.daily.map((d) => (d.tokens > 0 ? d.tokens : d.activity)), 1);
  const today = new Date();
  for (let w = 0; w < WEEKS; w++) {
    for (let r = 0; r < ROWS; r++) {
      const daysAgo = (WEEKS - 1 - w) * 7 + (ROWS - 1 - r);
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
      const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      const row = byDay.get(key);
      const value = row ? (row.tokens > 0 ? row.tokens : row.activity) : 0;
      ctx.fillStyle = mixWithEmpty(theme, intensityOf(value, max));
      ctx.beginPath();
      ctx.roundRect(gridLeft + w * (cell + gap), gridTop + r * (cell + gap), cell, cell, 4);
      ctx.fill();
    }
  }

  // Stat row
  const statsY = gridTop + ROWS * (cell + gap) + 80;
  const stats: Array<[string, string]> = [
    [formatCompactNumber(data.totalTokens), 'lifetime tokens'],
    [formatCompactNumber(data.peakDayTokens), 'peak day'],
    [`${data.currentStreak} days`, 'current streak'],
    [`${data.longestStreak} days`, 'longest streak'],
  ];
  const slot = (SHARE_CARD_WIDTH - pad * 2) / stats.length;
  stats.forEach(([value, label], i) => {
    const cx = pad + slot * i + slot / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    ctx.font = font(40, 700);
    ctx.fillText(value, cx, statsY);
    ctx.fillStyle = theme.muted;
    ctx.font = font(19);
    ctx.fillText(label, cx, statsY + 32);
  });
  ctx.textAlign = 'left';
}

export type ShareNetwork = 'x' | 'linkedin' | 'reddit';

/** Web intent URL carrying the text summary for a network. */
export function buildShareIntentUrl(network: ShareNetwork, text: string): string {
  const encoded = encodeURIComponent(text);
  switch (network) {
    case 'x':
      return `https://twitter.com/intent/tweet?text=${encoded}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encoded}`;
    case 'reddit':
      return `https://www.reddit.com/submit?title=${encoded}`;
  }
}

/** Text summary used by the share intents. */
export function buildShareText(data: ShareCardData): string {
  return `${formatCompactNumber(data.totalTokens)} lifetime tokens, ${data.currentStreak}-day streak on Pavii.Ai — my personal AI workspace. pavii.tech`;
}
