/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordUsage,
  readUsageLedger,
  flushUsageLedger,
  dayKeyOf,
  __resetUsageLedgerForTests,
} from '@/process/services/usageLedger';

// Local-noon epochs avoid timezone edge cases around midnight.
const epochOf = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12, 0, 0).getTime();

const DAY_A = epochOf(2026, 8, 17);
const DAY_B = epochOf(2026, 8, 18);
const KEY_A = dayKeyOf(DAY_A);
const KEY_B = dayKeyOf(DAY_B);

describe('usageLedger', () => {
  let configDir: string;

  const ledgerFile = () => join(configDir, 'usage-ledger.json');

  beforeEach(() => {
    __resetUsageLedgerForTests();
    configDir = mkdtempSync(join(tmpdir(), 'pavii-usage-ledger-test-'));
  });

  afterEach(() => {
    __resetUsageLedgerForTests();
    rmSync(configDir, { recursive: true, force: true });
  });

  describe('dayKeyOf', () => {
    it('formats a local-time YYYY-MM-DD key with zero padding', () => {
      expect(dayKeyOf(epochOf(2026, 1, 5))).toBe('2026-01-05');
      expect(dayKeyOf(epochOf(2026, 12, 31))).toBe('2026-12-31');
    });
  });

  describe('recordUsage aggregation', () => {
    it('aggregates tokens, turns, byModel and byBackend into the day bucket of the entry epoch', async () => {
      await recordUsage(configDir, { tokens: 100, model: 'claude-sonnet-5', backend: 'claude-code', at: DAY_A });
      const ledger = await readUsageLedger(configDir);
      expect(ledger.version).toBe(1);
      expect(Object.keys(ledger.days)).toEqual([KEY_A]);
      expect(ledger.days[KEY_A]).toEqual({
        tokens: 100,
        turns: 1,
        byModel: { 'claude-sonnet-5': 100 },
        byBackend: { 'claude-code': 100 },
      });
    });

    it('accumulates multiple entries within the same day', async () => {
      await recordUsage(configDir, { tokens: 100, model: 'claude-sonnet-5', backend: 'claude-code', at: DAY_A });
      await recordUsage(configDir, { tokens: 50, model: 'claude-sonnet-5', backend: 'opencode', at: DAY_A });
      await recordUsage(configDir, { tokens: 25, model: 'claude-opus-5', backend: 'claude-code', at: DAY_A });
      const ledger = await readUsageLedger(configDir);
      expect(ledger.days[KEY_A]).toEqual({
        tokens: 175,
        turns: 3,
        byModel: { 'claude-sonnet-5': 150, 'claude-opus-5': 25 },
        byBackend: { 'claude-code': 125, opencode: 50 },
      });
    });

    it('keeps entries on different days in separate buckets', async () => {
      await recordUsage(configDir, { tokens: 10, at: DAY_A });
      await recordUsage(configDir, { tokens: 20, at: DAY_B });
      const ledger = await readUsageLedger(configDir);
      expect(ledger.days[KEY_A]).toMatchObject({ tokens: 10, turns: 1 });
      expect(ledger.days[KEY_B]).toMatchObject({ tokens: 20, turns: 1 });
    });

    it('defaults the day bucket to now when at is missing', async () => {
      await recordUsage(configDir, { tokens: 5 });
      const ledger = await readUsageLedger(configDir);
      expect(Object.keys(ledger.days)).toEqual([dayKeyOf(Date.now())]);
    });

    it.each([
      ['zero tokens', 0],
      ['negative tokens', -5],
      ['NaN tokens', Number.NaN],
      ['Infinity tokens', Number.POSITIVE_INFINITY],
      ['non-number tokens', 'lots' as unknown as number],
    ])('ignores invalid entries: %s', async (_label, tokens) => {
      await recordUsage(configDir, { tokens, model: 'm', backend: 'b', at: DAY_A });
      const ledger = await readUsageLedger(configDir);
      expect(ledger.days).toEqual({});
    });

    it('skips model/backend tallies when the entry omits them', async () => {
      await recordUsage(configDir, { tokens: 42, at: DAY_A });
      const ledger = await readUsageLedger(configDir);
      expect(ledger.days[KEY_A]).toEqual({ tokens: 42, turns: 1, byModel: {}, byBackend: {} });
    });

    it('tallies only the dimension that is present', async () => {
      await recordUsage(configDir, { tokens: 10, model: 'only-model', at: DAY_A });
      await recordUsage(configDir, { tokens: 20, backend: 'only-backend', at: DAY_A });
      const ledger = await readUsageLedger(configDir);
      expect(ledger.days[KEY_A].byModel).toEqual({ 'only-model': 10 });
      expect(ledger.days[KEY_A].byBackend).toEqual({ 'only-backend': 20 });
    });
  });

  describe('persistence', () => {
    it('debounces the write: file does not exist immediately, flush forces it', async () => {
      await recordUsage(configDir, { tokens: 100, at: DAY_A });
      expect(existsSync(ledgerFile())).toBe(false);
      await flushUsageLedger(configDir);
      expect(existsSync(ledgerFile())).toBe(true);
    });

    it('round-trips through a fresh load after flush', async () => {
      await recordUsage(configDir, { tokens: 100, model: 'claude-sonnet-5', backend: 'claude-code', at: DAY_A });
      await recordUsage(configDir, { tokens: 7, at: DAY_B });
      await flushUsageLedger(configDir);

      const onDisk = JSON.parse(readFileSync(ledgerFile(), 'utf-8'));
      expect(onDisk.version).toBe(1);

      __resetUsageLedgerForTests();
      const reloaded = await readUsageLedger(configDir);
      expect(reloaded).toEqual({
        version: 1,
        days: {
          [KEY_A]: { tokens: 100, turns: 1, byModel: { 'claude-sonnet-5': 100 }, byBackend: { 'claude-code': 100 } },
          [KEY_B]: { tokens: 7, turns: 1, byModel: {}, byBackend: {} },
        },
      });
    });

    it('returns a fresh empty ledger without throwing when the file is corrupt', async () => {
      writeFileSync(ledgerFile(), '{not json!!', 'utf-8');
      const ledger = await readUsageLedger(configDir);
      expect(ledger).toEqual({ version: 1, days: {} });
    });

    it('ignores a file with the wrong shape and starts fresh', async () => {
      writeFileSync(ledgerFile(), JSON.stringify({ version: 2, days: {} }), 'utf-8');
      const ledger = await readUsageLedger(configDir);
      expect(ledger).toEqual({ version: 1, days: {} });
    });

    it('readUsageLedger returns the cached in-memory state after recording', async () => {
      await recordUsage(configDir, { tokens: 9, at: DAY_A });
      const first = await readUsageLedger(configDir);
      const second = await readUsageLedger(configDir);
      expect(second).toBe(first);
      expect(first.days[KEY_A].tokens).toBe(9);
    });

    it('flushUsageLedger is a no-op without cached state', async () => {
      await expect(flushUsageLedger(configDir)).resolves.toBeUndefined();
      expect(existsSync(ledgerFile())).toBe(false);
    });
  });
});
