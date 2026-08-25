/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure statistics for the Profile page.
 *
 * Token figures come from the local usage ledger (per-day aggregates recorded
 * since the build that introduced it). Activity/streaks merge ledger days with
 * conversation timestamps so long-time users still see meaningful history.
 * MCP/skill figures are "most attached" (creation-time snapshots) because
 * invocations are not recorded anywhere.
 */

import { skillDisplayName } from '@/common/utils/skillBranding';

export type LedgerDays = Record<
  string,
  { tokens: number; turns: number; byModel: Record<string, number>; byBackend: Record<string, number> }
>;

export type ConversationStatsInput = {
  created_at: number;
  modified_at: number;
  backend: string;
  model?: string;
  mcpServers?: string[];
  skills?: string[];
};

export type DayActivity = {
  /** YYYY-MM-DD (local time) */
  day: string;
  tokens: number;
  /** conversation touches + ledger turns — drives heatmap intensity fallback */
  activity: number;
};

export const dayKeyOf = (epochMs: number): string => {
  const d = new Date(epochMs);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

/** Merge ledger days and conversation timestamps into per-day activity. */
export function buildDailyActivity(ledgerDays: LedgerDays, conversations: ConversationStatsInput[]): DayActivity[] {
  const map = new Map<string, DayActivity>();
  const bump = (day: string, tokens: number, activity: number) => {
    const row = map.get(day) ?? { day, tokens: 0, activity: 0 };
    row.tokens += tokens;
    row.activity += activity;
    map.set(day, row);
  };
  for (const [day, agg] of Object.entries(ledgerDays)) bump(day, agg.tokens, agg.turns);
  for (const conversation of conversations) {
    bump(dayKeyOf(conversation.created_at), 0, 1);
    if (dayKeyOf(conversation.modified_at) !== dayKeyOf(conversation.created_at)) {
      bump(dayKeyOf(conversation.modified_at), 0, 1);
    }
  }
  return [...map.values()].toSorted((a, b) => a.day.localeCompare(b.day));
}

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKeyToEpoch = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** Current and longest consecutive-day streaks over active days. */
export function computeStreaks(
  activeDays: string[],
  todayKey: string = dayKeyOf(Date.now())
): { current: number; longest: number } {
  if (activeDays.length === 0) return { current: 0, longest: 0 };
  const sorted = [...new Set(activeDays)].toSorted();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round((dayKeyToEpoch(sorted[i]) - dayKeyToEpoch(sorted[i - 1])) / DAY_MS);
    run = gap === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  // Current streak counts back from today (or yesterday, so an unfinished day
  // does not zero an ongoing streak).
  const active = new Set(sorted);
  const todayEpoch = dayKeyToEpoch(todayKey);
  let cursor = active.has(todayKey) ? todayEpoch : todayEpoch - DAY_MS;
  let current = 0;
  while (active.has(dayKeyOf(cursor))) {
    current += 1;
    cursor -= DAY_MS;
  }
  return { current, longest };
}

export type TopEntry = { name: string; value: number };

/** Highest-count entry of a tally; ties break lexicographically for stability. */
export function topOf(tally: Record<string, number>): TopEntry | null {
  const entries = Object.entries(tally);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { name: entries[0][0], value: entries[0][1] };
}

const tallyInto = (tally: Record<string, number>, key: string | undefined, amount = 1): void => {
  if (!key) return;
  tally[key] = (tally[key] ?? 0) + amount;
};

export type ProfileStats = {
  totalTokens: number;
  peakDay: { day: string; tokens: number } | null;
  firstLedgerDay: string | null;
  currentStreak: number;
  longestStreak: number;
  totalChats: number;
  longestChatMs: number;
  mostUsedBackend: TopEntry | null;
  mostUsedModel: TopEntry | null;
  mostAttachedMcp: TopEntry | null;
  mostAttachedSkill: TopEntry | null;
  skillsUsedCount: number;
  daily: DayActivity[];
};

export function computeProfileStats(
  ledgerDays: LedgerDays,
  conversations: ConversationStatsInput[],
  todayKey: string = dayKeyOf(Date.now())
): ProfileStats {
  const daily = buildDailyActivity(ledgerDays, conversations);
  const { current, longest } = computeStreaks(
    daily.map((d) => d.day),
    todayKey
  );

  let totalTokens = 0;
  let peakDay: { day: string; tokens: number } | null = null;
  const modelTally: Record<string, number> = {};
  const backendTokenTally: Record<string, number> = {};
  for (const [day, agg] of Object.entries(ledgerDays)) {
    totalTokens += agg.tokens;
    if (!peakDay || agg.tokens > peakDay.tokens) peakDay = { day, tokens: agg.tokens };
    // Defaulted, not asserted: this runs inside a render-time useMemo, so an
    // engine that omits a breakdown would throw on Object.entries(undefined)
    // and take the whole Profile page down rather than lose one statistic.
    for (const [model, tokens] of Object.entries(agg.byModel ?? {})) tallyInto(modelTally, model, tokens);
    for (const [backend, tokens] of Object.entries(agg.byBackend ?? {})) tallyInto(backendTokenTally, backend, tokens);
  }

  const backendTally: Record<string, number> = {};
  const mcpTally: Record<string, number> = {};
  const skillTally: Record<string, number> = {};
  let longestChatMs = 0;
  for (const conversation of conversations) {
    tallyInto(backendTally, conversation.backend);
    tallyInto(modelTally, conversation.model);
    for (const server of conversation.mcpServers ?? []) tallyInto(mcpTally, server);
    // Conversations store the raw skill name, so pre-rebrand chats carry
    // `aionui-config` while newer ones carry `pavii-config` for the same
    // skill. Fold them onto the display name before tallying: otherwise the
    // count splits across two keys and `skillsUsedCount` double-counts.
    for (const skill of conversation.skills ?? []) tallyInto(skillTally, skillDisplayName(skill));
    const duration = conversation.modified_at - conversation.created_at;
    if (duration > longestChatMs) longestChatMs = duration;
  }
  // Token-weighted backend usage from the ledger beats conversation counts
  // when available (it reflects real work, not chat creation habits).
  //
  // "Available" has to mean a non-zero winner. The ledger records a turn even
  // when the agent reported no figures, so a backend can sit in the tally at
  // zero; `topOf` returns that as a truthy entry, and a bare `??` would then
  // crown a backend that spent nothing over the conversation counts.
  const backendByTokens = topOf(backendTokenTally);
  const mostUsedBackend = backendByTokens && backendByTokens.value > 0 ? backendByTokens : topOf(backendTally);

  const firstLedgerDay = Object.keys(ledgerDays).toSorted()[0] ?? null;

  return {
    totalTokens,
    peakDay,
    firstLedgerDay,
    currentStreak: current,
    longestStreak: longest,
    totalChats: conversations.length,
    longestChatMs,
    mostUsedBackend,
    mostUsedModel: topOf(modelTally),
    mostAttachedMcp: topOf(mcpTally),
    mostAttachedSkill: topOf(skillTally),
    skillsUsedCount: Object.keys(skillTally).length,
    daily,
  };
}

/** Compact number formatting: 4.9B, 561.5M, 12.3K. */
export function formatCompactNumber(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${value}`;
}

/** Format a duration as "7h 46m" / "12m" / "45s". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  return `${hours}h ${minutes % 60}m`;
}
