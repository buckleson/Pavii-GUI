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
import {
  SHARE_DOWNLOAD_URL,
  buildShareIntentUrl,
  buildShareSummary,
  buildShareText,
  type ShareCardData,
} from '@renderer/pages/profile/shareCard';

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
    it('builds an x intent URL with the encoded summary', () => {
      expect(buildShareIntentUrl('x', data)).toBe(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(data))}`
      );
    });

    it('builds a linkedin intent URL with the encoded summary', () => {
      expect(buildShareIntentUrl('linkedin', data)).toBe(
        `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(buildShareText(data))}`
      );
    });

    it('builds a reddit LINK post, headline and destination apart', () => {
      // Reddit prefills only `title` and `url`; a URL inside the title does
      // not render as a link, which is where the whole summary used to go.
      expect(buildShareIntentUrl('reddit', data)).toBe(
        `https://www.reddit.com/submit?title=${encodeURIComponent(buildShareSummary(data))}&url=${encodeURIComponent(SHARE_DOWNLOAD_URL)}`
      );
    });

    it('does not leak raw unsafe characters into the URL', () => {
      expect(buildShareIntentUrl('x', data)).not.toContain(' ');
      expect(buildShareIntentUrl('reddit', data)).not.toContain(' ');
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

describe('rebranded skill names', () => {
  const TODAY = '2026-08-18';

  it('reports the most attached skill under its Pavii name', () => {
    const stats = computeProfileStats({}, [conversation({ skills: ['aionui-config'] })], TODAY);
    expect(stats.mostAttachedSkill).toEqual({ name: 'pavii-config', value: 1 });
  });

  it('folds pre-rebrand and post-rebrand names into one skill', () => {
    // The same skill recorded under both names across the rename. Counting
    // them apart splits the tally and reports two skills used instead of one.
    const stats = computeProfileStats(
      {},
      [
        conversation({ skills: ['aionui-config'] }),
        conversation({ skills: ['pavii-config'] }),
        conversation({ skills: ['officecli-docx'] }),
      ],
      TODAY
    );
    expect(stats.mostAttachedSkill).toEqual({ name: 'pavii-config', value: 2 });
    expect(stats.skillsUsedCount).toBe(2);
  });
});

describe('computeStreaks calendar boundaries', () => {
  it('counts a run that crosses a month boundary as consecutive', () => {
    // Day keys are strings, so a naive "increment the last field" comparison
    // would break the streak on the 1st and reset every user to 1 monthly.
    const days = ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
    expect(computeStreaks(days, '2026-08-02')).toEqual({ current: 4, longest: 4 });
  });

  it('counts a run that crosses a year boundary as consecutive', () => {
    const days = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'];
    expect(computeStreaks(days, '2026-01-02')).toEqual({ current: 4, longest: 4 });
  });

  it('does not join two days that merely share a day-of-month', () => {
    // The failure path for the two above: a comparison loose enough to bridge
    // months would report a 2-day streak a month wide.
    expect(computeStreaks(['2026-07-01', '2026-08-01'], '2026-08-01')).toEqual({ current: 1, longest: 1 });
  });
});

describe('computeProfileStats edge cases', () => {
  const TODAY = '2026-08-18';

  it('picks the peak day by tokens, not by position in the ledger', () => {
    // Insertion order deliberately puts the busiest day in the middle so that
    // "first key wins" and "last key wins" both fail here.
    const ledger: LedgerDays = {
      '2026-08-01': ledgerDay(0, 1),
      '2026-08-02': ledgerDay(900, 4),
      '2026-08-03': ledgerDay(120, 2),
    };
    expect(computeProfileStats(ledger, [], TODAY).peakDay).toEqual({ day: '2026-08-02', tokens: 900 });
  });

  it('reports no peak day when chats exist but the ledger is empty', () => {
    // A new install has conversations before the engine has written any usage
    // day. Deriving the peak from merged daily activity instead of the ledger
    // would surface a "peak day" of 0 tokens on the profile tile.
    const stats = computeProfileStats({}, [conversation(), conversation()], TODAY);
    expect(stats.peakDay).toBeNull();
    expect(stats.totalTokens).toBe(0);
    expect(stats.daily).not.toEqual([]);
  });

  it('keeps a zero-token day in the streak when it recorded turns', () => {
    // Turns served entirely from cache can total zero tokens. Dropping those
    // days from activity would silently break the streak of a real active day.
    const ledger: LedgerDays = { '2026-08-17': ledgerDay(0, 3), '2026-08-18': ledgerDay(0, 1) };
    const stats = computeProfileStats(ledger, [], TODAY);
    expect(stats.currentStreak).toBe(2);
    expect(stats.daily).toEqual([
      { day: '2026-08-17', tokens: 0, activity: 3 },
      { day: '2026-08-18', tokens: 0, activity: 1 },
    ]);
  });

  it('sums multi-billion token days without losing precision', () => {
    // Lifetime totals pass 2^31 for heavy users; any 32-bit coercion in the
    // accumulator (`| 0`, `>>> 0`) would wrap the headline number negative.
    const ledger: LedgerDays = {
      '2026-08-01': ledgerDay(4_000_000_000, 10),
      '2026-08-02': ledgerDay(4_000_000_000, 10),
      '2026-08-03': ledgerDay(4_000_000_000, 10),
    };
    const stats = computeProfileStats(ledger, [], TODAY);
    expect(stats.totalTokens).toBe(12_000_000_000);
    expect(stats.peakDay).toEqual({ day: '2026-08-01', tokens: 4_000_000_000 });
  });

  it('terminates and ignores future ledger days when the clock has slipped back', () => {
    // A machine whose clock jumped backwards (or a timezone move) leaves ledger
    // days ahead of "today". The backward walk must still stop, and days the
    // user has not reached yet must not pad the current streak.
    const ledger: LedgerDays = {
      '2026-08-17': ledgerDay(10, 1),
      '2026-08-18': ledgerDay(10, 1),
      '2026-08-19': ledgerDay(10, 1),
      '2026-08-20': ledgerDay(10, 1),
    };
    const stats = computeProfileStats(ledger, [], TODAY);
    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(4);
  });

  it('never reports a negative longest chat for a row modified before it was created', () => {
    // Clock skew between two machines syncing the same conversation can leave
    // modified_at behind created_at; formatDuration would render "-1h 6m".
    const stats = computeProfileStats({}, [conversation({ created_at: 5_000, modified_at: 1_000 })], TODAY);
    expect(stats.longestChatMs).toBe(0);
  });

  it('does not tally conversations without a model under an "undefined" name', () => {
    // Backends that report no model id leave `model` unset. Counting those
    // would put a literal "undefined" on the most-used-model tile.
    const conversations = [conversation(), conversation(), conversation(), conversation({ model: 'claude-sonnet-5' })];
    const stats = computeProfileStats({}, conversations, TODAY);
    expect(stats.mostUsedModel).toEqual({ name: 'claude-sonnet-5', value: 1 });
  });

  it('does not tally conversations without attachments under an empty name', () => {
    // Same class of bug on the MCP/skill tiles: an empty attachment list must
    // leave the tally empty rather than counting a nameless entry.
    const stats = computeProfileStats({}, [conversation({ mcpServers: [], skills: [] }), conversation()], TODAY);
    expect(stats.mostAttachedMcp).toBeNull();
    expect(stats.mostAttachedSkill).toBeNull();
    expect(stats.skillsUsedCount).toBe(0);
  });
});

describe('ledger data the engine may not fully populate', () => {
  const TODAY = '2026-08-18';

  it('survives a day with no breakdown maps at all', () => {
    // computeProfileStats runs inside a render-time useMemo, so
    // Object.entries(undefined) here would throw during render and white-screen
    // the Profile page — losing every statistic to protect none. A version-skewed
    // engine omitting these fields must cost the breakdown, not the page.
    const ledger = {
      '2026-08-17': { tokens: 500, turns: 2 },
    } as unknown as LedgerDays;

    expect(() => computeProfileStats(ledger, [], TODAY)).not.toThrow();
    const stats = computeProfileStats(ledger, [], TODAY);
    expect(stats.totalTokens).toBe(500);
    expect(stats.mostUsedModel).toBeNull();
  });

  it('does not crown a backend that spent nothing over the conversation counts', () => {
    // The ledger counts a turn even when the agent reported no token figures
    // (plain-ACP agents report none), so a backend can sit in byBackend at zero.
    // topOf returns that as a truthy entry, so a bare `??` fallback would pin
    // "Most used CLI" to the backend that did no measurable work.
    const ledger: LedgerDays = {
      '2026-08-17': { tokens: 0, turns: 1, byModel: {}, byBackend: { opencode: 0 } },
    };
    const conversations = [
      conversation({ backend: 'claude' }),
      conversation({ backend: 'claude' }),
      conversation({ backend: 'opencode' }),
    ];

    const stats = computeProfileStats(ledger, conversations, TODAY);

    expect(stats.mostUsedBackend).toEqual({ name: 'claude', value: 2 });
  });

  it('still prefers the token tally once a backend has real spend', () => {
    // The guard above must not disable token weighting outright: a backend with
    // fewer conversations but far more tokens is still the most used one.
    const ledger: LedgerDays = {
      '2026-08-17': { tokens: 90_000, turns: 3, byModel: {}, byBackend: { codex: 90_000 } },
    };
    const conversations = [
      conversation({ backend: 'claude' }),
      conversation({ backend: 'claude' }),
      conversation({ backend: 'codex' }),
    ];

    expect(computeProfileStats(ledger, conversations, TODAY).mostUsedBackend).toEqual({
      name: 'codex',
      value: 90_000,
    });
  });
});
