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
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it('deletes on the upgrade start and stays quiet on every start after it', () => {
    // The upgrade path in miniature: a user who launches the new build three
    // times must not see the removal reported (or retried) again. A cached
    // "already handled" flag or a re-created file would both show up here.
    writeFileSync(ledgerFile(), '{}');

    expect(clearLegacyUsageLedger(configDir)).toBe(true);
    expect(clearLegacyUsageLedger(configDir)).toBe(false);
    expect(clearLegacyUsageLedger(configDir)).toBe(false);
  });

  it('removes a ledger whose contents are corrupt rather than leaving it forever', () => {
    // The file is never read, so a half-written JSON from a crash mid-write is
    // still garbage to delete. Re-introducing a parse step to "check" it first
    // would strand exactly the files most worth removing.
    writeFileSync(ledgerFile(), '{"version":1,"days":{"2026-08-0');

    expect(clearLegacyUsageLedger(configDir)).toBe(true);
    expect(existsSync(ledgerFile())).toBe(false);
  });

  it('does not throw when the config path is a file instead of a directory', () => {
    // A corrupted install can leave a file where the config directory belongs.
    // Statting a path under it raises ENOTDIR, which must not reach startup.
    const notADirectory = join(configDir, 'config-is-a-file');
    writeFileSync(notADirectory, 'oops');

    expect(() => clearLegacyUsageLedger(notADirectory)).not.toThrow();
    expect(clearLegacyUsageLedger(notADirectory)).toBe(false);
  });

  it('does not throw on a config path longer than the platform allows', () => {
    // Deeply nested profile/roaming paths overflow Windows' 260-character
    // limit. The syscall fails with ENAMETOOLONG/ENOENT; startup must not.
    const tooLong = join(configDir, ...Array.from({ length: 30 }, (_, i) => `segment-${i}`.repeat(4)));

    expect(() => clearLegacyUsageLedger(tooLong)).not.toThrow();
    expect(clearLegacyUsageLedger(tooLong)).toBe(false);
  });

  it('reports honestly whether a read-only ledger actually went away', () => {
    // Read-only permissions block the unlink on Windows but not on POSIX, so
    // the platform-independent contract is the one that matters: never throw,
    // and never claim a removal that did not happen (or deny one that did) —
    // a `return true` in the catch arm would be a lie on Windows.
    writeFileSync(ledgerFile(), '{}');
    chmodSync(ledgerFile(), 0o444);

    let removed: boolean | undefined;
    expect(() => {
      removed = clearLegacyUsageLedger(configDir);
    }).not.toThrow();
    expect(removed).toBe(!existsSync(ledgerFile()));

    if (existsSync(ledgerFile())) chmodSync(ledgerFile(), 0o666);
  });

  it('removes a symlinked ledger without following it to the target', ({ skip }) => {
    // Some users point config entries at another drive. Unlink must drop the
    // link itself; resolving and deleting the target would destroy a file
    // outside the config directory entirely.
    const target = join(configDir, 'real-ledger.json');
    writeFileSync(target, '{"keep":true}');
    try {
      symlinkSync(target, ledgerFile(), 'file');
    } catch {
      // Windows without Developer Mode / SeCreateSymbolicLink cannot make one.
      skip();
      return;
    }

    expect(clearLegacyUsageLedger(configDir)).toBe(true);
    expect(existsSync(target)).toBe(true);
  });
});
