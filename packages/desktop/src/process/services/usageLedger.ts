/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Local usage ledger backing the Profile page.
 *
 * The backend keeps only a last-snapshot of token usage per conversation, so
 * lifetime/daily token statistics cannot be reconstructed from stored data.
 * This ledger accumulates the per-turn usage frames the renderer already
 * receives (and previously discarded) into per-day aggregates. Token stats
 * therefore count from the first launch of the build that introduced it.
 */

export type UsageRecordEntry = {
  /** Tokens consumed by the turn (delta, not a context snapshot). */
  tokens: number;
  /** Model identifier, e.g. 'claude-sonnet-5'. */
  model?: string;
  /** Agent backend key, e.g. 'opencode' | 'aionrs' | 'claude-code'. */
  backend?: string;
  /** Epoch ms of the turn; defaults to now. */
  at?: number;
};

export type UsageDay = {
  tokens: number;
  turns: number;
  byModel: Record<string, number>;
  byBackend: Record<string, number>;
};

export type UsageLedger = {
  version: 1;
  days: Record<string, UsageDay>;
};

const LEDGER_FILE_NAME = 'usage-ledger.json';
const WRITE_DEBOUNCE_MS = 2000;

const emptyLedger = (): UsageLedger => ({ version: 1, days: {} });

/** Local-time day bucket, matching how users think about "today". */
export const dayKeyOf = (epochMs: number): string => {
  const d = new Date(epochMs);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

let cache: UsageLedger | null = null;
let cachedDir: string | null = null;
let writeTimer: NodeJS.Timeout | null = null;

const ledgerPath = (configDir: string): string => join(configDir, LEDGER_FILE_NAME);

const isValidLedger = (value: unknown): value is UsageLedger =>
  !!value &&
  typeof value === 'object' &&
  (value as UsageLedger).version === 1 &&
  typeof (value as UsageLedger).days === 'object';

async function loadLedger(configDir: string): Promise<UsageLedger> {
  if (cache && cachedDir === configDir) return cache;
  let ledger = emptyLedger();
  try {
    const parsed: unknown = JSON.parse(await readFile(ledgerPath(configDir), 'utf-8'));
    if (isValidLedger(parsed)) ledger = parsed;
  } catch {
    // Missing or corrupt file: start fresh.
  }
  cache = ledger;
  cachedDir = configDir;
  return ledger;
}

function scheduleWrite(configDir: string): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!cache) return;
    void writeFile(ledgerPath(configDir), JSON.stringify(cache), 'utf-8').catch((error) => {
      console.warn('[UsageLedger] write failed:', error);
    });
  }, WRITE_DEBOUNCE_MS);
  writeTimer.unref?.();
}

/** Record one turn's usage into the day aggregates. Invalid entries are ignored. */
export async function recordUsage(configDir: string, entry: UsageRecordEntry): Promise<void> {
  const tokens = Number(entry.tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const ledger = await loadLedger(configDir);
  const key = dayKeyOf(typeof entry.at === 'number' ? entry.at : Date.now());
  const day = (ledger.days[key] ??= { tokens: 0, turns: 0, byModel: {}, byBackend: {} });
  day.tokens += tokens;
  day.turns += 1;
  if (entry.model) day.byModel[entry.model] = (day.byModel[entry.model] ?? 0) + tokens;
  if (entry.backend) day.byBackend[entry.backend] = (day.byBackend[entry.backend] ?? 0) + tokens;
  scheduleWrite(configDir);
}

/** Read the full ledger (cached). */
export async function readUsageLedger(configDir: string): Promise<UsageLedger> {
  return loadLedger(configDir);
}

/** Flush any pending write immediately (quit path, tests). */
export async function flushUsageLedger(configDir: string): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (cache) {
    await writeFile(ledgerPath(configDir), JSON.stringify(cache), 'utf-8').catch(() => {});
  }
}

/** Reset in-memory state (tests). */
export function __resetUsageLedgerForTests(): void {
  cache = null;
  cachedDir = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}
