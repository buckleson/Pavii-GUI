/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * The local ledger was retired: the engine records token usage now, at the one
 * point every surface passes through. All that remains here is removing the old
 * file, which cannot be migrated — its buckets mix inflated and under-counted
 * figures with no per-turn record to recompute from.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearLegacyUsageLedger } from '@/process/services/usageLedger';

describe('clearLegacyUsageLedger', () => {
  let configDir: string;
  const ledgerFile = () => join(configDir, 'usage-ledger.json');

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'pavii-usage-ledger-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('removes a ledger left behind by an earlier build', () => {
    writeFileSync(ledgerFile(), JSON.stringify({ version: 1, days: { '2026-08-01': { tokens: 33_500_000 } } }));

    expect(clearLegacyUsageLedger(configDir)).toBe(true);
    expect(existsSync(ledgerFile())).toBe(false);
  });

  it('reports nothing to do when the file is already gone', () => {
    // Runs on every start, so the second start must be a quiet no-op.
    expect(clearLegacyUsageLedger(configDir)).toBe(false);
  });

  it('is a no-op rather than a throw when the config dir does not exist', () => {
    expect(clearLegacyUsageLedger(join(configDir, 'missing'))).toBe(false);
  });

  it('never fails startup when the path cannot be unlinked', () => {
    // A directory at the ledger's path cannot be unlinked; startup must survive
    // it rather than take the whole process down over an orphaned file.
    mkdirSync(ledgerFile());

    expect(clearLegacyUsageLedger(configDir)).toBe(false);
  });

  it('leaves everything else in the config directory alone', () => {
    const neighbour = join(configDir, 'settings.json');
    writeFileSync(neighbour, '{"keep":true}');
    writeFileSync(ledgerFile(), '{}');

    clearLegacyUsageLedger(configDir);

    expect(existsSync(neighbour)).toBe(true);
  });
});
