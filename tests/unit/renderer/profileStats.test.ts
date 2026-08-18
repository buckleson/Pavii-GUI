/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  buildDailyActivity,
  computeStreaks,
  computeProfileStats,
  dayKeyOf,
  formatCompactNumber,
  formatDuration,
  topOf,
  type ConversationStatsInput,
  type LedgerDays,
} from '@renderer/pages/profile/profileStats';
import { buildShareIntentUrl, buildShareText, type ShareCardData } from '@renderer/pages/profile/shareCard';

// Local-noon epochs avoid timezone edge cases around midnight.
const epochOf = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12, 0, 0).getTime();

const ledgerDay = (tokens: number, turns: number, byModel = {}, byBackend = {}) => ({
  tokens,
  turns,
  byModel,
  byBackend,
});

const conversation = (overrides: Partial<ConversationStatsInput> = {}): ConversationStatsInput => ({
  created_at: epochOf(2026, 8, 10),
  modified_at: epochOf(2026, 8, 10),
  backend: 'claude-code',
  ...overrides,
});

describe('buildDailyActivity', () => {
  it('returns an empty array for no data', () => {
    expect(buildDailyActivity({}, [])).toEqual([]);
  });

  it('maps ledger days into token/turn activity', () => {
    const ledger: LedgerDays = { '2026-08-10': ledgerDay(100, 3) };
    expect(buildDailyActivity(ledger, [])).toEqual([{ day: '2026-08-10', tokens: 100, activity: 3 }]);
  });

  it('dedupes a conversation created and modified on the same day into one touch', () => {
    const rows = buildDailyActivity({}, [conversation()]);
    expect(rows).toEqual([{ day: dayKeyOf(epochOf(2026, 8, 10)), tokens: 0, activity: 1 }]);
  });

  it('counts created and modified days separately when they differ', () => {
    const rows = buildDailyActivity({}, [
      conversation({ created_at: epochOf(2026, 8, 10), modified_at: epochOf(2026, 8, 12) }),
    ]);
    expect(rows).toEqual([
      { day: dayKeyOf(epochOf(2026, 8, 10)), tokens: 0, activity: 1 },
      { day: dayKeyOf(epochOf(2026, 8, 12)), tokens: 0, activity: 1 },
    ]);
  });

  it('merges ledger and conversation activity on the same day and sorts ascending', () => {
    const dayKey = dayKeyOf(epochOf(2026, 8, 10));
    const ledger: LedgerDays = { [dayKey]: ledgerDay(50, 2), '2026-08-01': ledgerDay(10, 1) };
    const rows = buildDailyActivity(ledger, [conversation()]);
    expect(rows).toEqual([
      { day: '2026-08-01', tokens: 10, activity: 1 },
      { day: dayKey, tokens: 50, activity: 3 },
    ]);
  });
});

describe('computeStreaks', () => {
  const TODAY = '2026-08-18';

  it('returns 0/0 for no active days', () => {
    expect(computeStreaks([], TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it('handles a single active day equal to today', () => {
    expect(computeStreaks([TODAY], TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it('a single active day far in the past yields no current streak', () => {
    expect(computeStreaks(['2026-01-01'], TODAY)).toEqual({ current: 0, longest: 1 });
  });

  it('counts consecutive runs and resets on gaps', () => {
    const days = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-10', '2026-08-11'];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 0, longest: 3 });
  });

  it('current streak counts back from today when today is active', () => {
    const days = ['2026-08-16', '2026-08-17', '2026-08-18'];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 3, longest: 3 });
  });

  it('current streak counts back from yesterday when today is inactive', () => {
    const days = ['2026-08-15', '2026-08-16', '2026-08-17'];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 3, longest: 3 });
  });

  it('a streak ending before yesterday does not count as current', () => {
    const days = ['2026-08-14', '2026-08-15', '2026-08-16'];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 0, longest: 3 });
  });

  it('dedupes duplicate days', () => {
    const days = ['2026-08-17', '2026-08-17', '2026-08-18', '2026-08-18'];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 2, longest: 2 });
  });
});

describe('topOf', () => {
  it('returns null for an empty tally', () => {
    expect(topOf({})).toBeNull();
  });

  it('returns the highest-count entry', () => {
    expect(topOf({ a: 1, b: 5, c: 3 })).toEqual({ name: 'b', value: 5 });
  });

  it('breaks ties lexicographically', () => {
    expect(topOf({ zeta: 5, alpha: 5, mid: 5 })).toEqual({ name: 'alpha', value: 5 });
  });
});

describe('computeProfileStats', () => {
  const TODAY = '2026-08-18';

  it('returns empty stats for no data', () => {
    const stats = computeProfileStats({}, [], TODAY);
    expect(stats).toEqual({
      totalTokens: 0,
      peakDay: null,
      firstLedgerDay: null,
      currentStreak: 0,
      longestStreak: 0,
      totalChats: 0,
      longestChatMs: 0,
      mostUsedBackend: null,
      mostUsedModel: null,
      mostAttachedMcp: null,
      mostAttachedSkill: null,
      skillsUsedCount: 0,
      daily: [],
    });
  });

  it('computes totals, peak day and first ledger day from ledger days', () => {
    const ledger: LedgerDays = {
      '2026-08-02': ledgerDay(300, 2),
      '2026-08-01': ledgerDay(100, 1),
      '2026-08-03': ledgerDay(200, 1),
    };
    const stats = computeProfileStats(ledger, [], TODAY);
    expect(stats.totalTokens).toBe(600);
    expect(stats.peakDay).toEqual({ day: '2026-08-02', tokens: 300 });
    expect(stats.firstLedgerDay).toBe('2026-08-01');
  });

  it('prefers token-weighted ledger backend usage over conversation counts', () => {
    const ledger: LedgerDays = { '2026-08-01': ledgerDay(100, 1, {}, { aionrs: 100, opencode: 20 }) };
    const conversations = [
      conversation({ backend: 'claude-code' }),
      conversation({ backend: 'claude-code' }),
      conversation({ backend: 'claude-code' }),
    ];
    const stats = computeProfileStats(ledger, conversations, TODAY);
    expect(stats.mostUsedBackend).toEqual({ name: 'aionrs', value: 100 });
  });

  it('falls back to conversation backend counts when the ledger has no backend data', () => {
    const conversations = [
      conversation({ backend: 'opencode' }),
      conversation({ backend: 'opencode' }),
      conversation({ backend: 'claude-code' }),
    ];
    const stats = computeProfileStats({}, conversations, TODAY);
    expect(stats.mostUsedBackend).toEqual({ name: 'opencode', value: 2 });
  });

  it('merges ledger byModel tokens with conversation model counts', () => {
    const ledger: LedgerDays = { '2026-08-01': ledgerDay(100, 1, { 'claude-sonnet-5': 100 }, {}) };
    const conversations = [conversation({ model: 'claude-sonnet-5' }), conversation({ model: 'gpt-x' })];
    const stats = computeProfileStats(ledger, conversations, TODAY);
    expect(stats.mostUsedModel).toEqual({ name: 'claude-sonnet-5', value: 101 });
  });

  it('tallies most attached MCP server and skill, and counts distinct skills', () => {
    const conversations = [
      conversation({ mcpServers: ['github', 'linear'], skills: ['i18n', 'testing'] }),
      conversation({ mcpServers: ['github'], skills: ['testing'] }),
      conversation({ mcpServers: [], skills: [] }),
      conversation({}),
    ];
    const stats = computeProfileStats({}, conversations, TODAY);
    expect(stats.mostAttachedMcp).toEqual({ name: 'github', value: 2 });
    expect(stats.mostAttachedSkill).toEqual({ name: 'testing', value: 2 });
    expect(stats.skillsUsedCount).toBe(2);
  });

  it('tracks the longest chat duration and total chat count', () => {
    const conversations = [
      conversation({ created_at: 1000, modified_at: 5000 }),
      conversation({ created_at: 2000, modified_at: 2500 }),
    ];
    const stats = computeProfileStats({}, conversations, TODAY);
    expect(stats.totalChats).toBe(2);
    expect(stats.longestChatMs).toBe(4000);
  });

  it('derives streaks from merged daily activity', () => {
    const ledger: LedgerDays = { '2026-08-18': ledgerDay(10, 1) };
    const conversations = [conversation({ created_at: epochOf(2026, 8, 17), modified_at: epochOf(2026, 8, 17) })];
    const stats = computeProfileStats(ledger, conversations, TODAY);
    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(2);
  });
});

describe('formatCompactNumber', () => {
  it('leaves values under 1000 untouched', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(999)).toBe('999');
  });

  it('formats thousands without a trailing .0', () => {
    expect(formatCompactNumber(1000)).toBe('1K');
    expect(formatCompactNumber(12300)).toBe('12.3K');
  });

  it('formats millions', () => {
    expect(formatCompactNumber(1_500_000)).toBe('1.5M');
    expect(formatCompactNumber(1_000_000)).toBe('1M');
  });

  it('formats billions', () => {
    expect(formatCompactNumber(4_900_000_000)).toBe('4.9B');
    expect(formatCompactNumber(1_000_000_000)).toBe('1B');
  });
});

describe('formatDuration', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats sub-hour durations as minutes', () => {
    expect(formatDuration(12 * 60_000)).toBe('12m');
  });

  it('formats hours with remaining minutes', () => {
    expect(formatDuration((7 * 60 + 46) * 60_000)).toBe('7h 46m');
    expect(formatDuration(60 * 60_000)).toBe('1h 0m');
  });
});

describe('shareCard', () => {
  const data: ShareCardData = {
    name: 'Tester',
    handle: '@tester',
    totalTokens: 1_500_000,
    peakDayTokens: 12_300,
    currentStreak: 4,
    longestStreak: 9,
    daily: [],
  };

  describe('buildShareIntentUrl', () => {
    const text = 'hello world & 100% pavii';
    const encoded = encodeURIComponent(text);

    it('builds an x intent URL with encoded text', () => {
      expect(buildShareIntentUrl('x', text)).toBe(`https://twitter.com/intent/tweet?text=${encoded}`);
    });

    it('builds a linkedin intent URL with encoded text', () => {
      expect(buildShareIntentUrl('linkedin', text)).toBe(
        `https://www.linkedin.com/feed/?shareActive=true&text=${encoded}`
      );
    });

    it('builds a reddit intent URL with encoded text as the title', () => {
      expect(buildShareIntentUrl('reddit', text)).toBe(`https://www.reddit.com/submit?title=${encoded}`);
    });

    it('does not leak raw unsafe characters into the URL', () => {
      expect(buildShareIntentUrl('x', text)).not.toContain(' ');
      expect(buildShareIntentUrl('x', text)).not.toContain('&text=hello');
    });
  });

  describe('buildShareText', () => {
    it('contains the compact token count and current streak', () => {
      const shareText = buildShareText(data);
      expect(shareText).toContain('1.5M');
      expect(shareText).toContain('4-day streak');
    });

    it('mentions Pavii', () => {
      expect(buildShareText(data)).toContain('Pavii.Ai');
    });
  });
});
