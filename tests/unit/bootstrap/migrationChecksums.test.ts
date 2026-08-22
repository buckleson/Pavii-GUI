/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Migration bytes are a shipped contract.
 *
 * `sqlx::migrate!()` embeds each `.sql` file at compile time and checksums its
 * **raw bytes**, then refuses to open a database whose recorded checksum does
 * not match — `migration N was previously applied but has been modified`. So a
 * change to a migration file, including one that only touches whitespace or a
 * line ending, locks out every user who already ran the previous build.
 *
 * This shipped once: a Windows working tree held CRLF copies of files git
 * stores as LF, so a locally built engine and a CI-built engine disagreed about
 * identical SQL. `.gitattributes` now pins `*.sql -text`; these tests fail the
 * build if the bytes drift again.
 *
 * If a failure here is intentional — a genuinely new migration — add the file
 * to `tests/fixtures/migration-checksums.json`. Never edit an existing entry:
 * that is the case this test exists to stop.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'the-remaa', 'AionCore', 'crates', 'aionui-db', 'migrations');
const REPO_RELATIVE = 'the-remaa/AionCore/crates/aionui-db/migrations';
const PINNED: Record<string, string> = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'migration-checksums.json'), 'utf-8')
) as Record<string, string>;

const sha384 = (bytes: Buffer): string => createHash('sha384').update(bytes).digest('hex');

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

describe('migration checksums', () => {
  it('matches the pinned manifest byte for byte', () => {
    const drifted: string[] = [];
    for (const name of migrationFiles()) {
      const actual = sha384(readFileSync(join(MIGRATIONS_DIR, name)));
      if (PINNED[name] && PINNED[name] !== actual) drifted.push(name);
    }
    expect(
      drifted,
      `migration bytes changed: ${drifted.join(', ')} — every existing database would be locked out`
    ).toEqual([]);
  });

  it('has a pinned entry for every migration on disk, and vice versa', () => {
    const onDisk = migrationFiles();
    const pinnedNames = Object.keys(PINNED).sort();
    expect(
      onDisk.filter((n) => !PINNED[n]),
      'new migration not added to the manifest'
    ).toEqual([]);
    expect(
      pinnedNames.filter((n) => !onDisk.includes(n)),
      'manifest lists a migration that no longer exists'
    ).toEqual([]);
  });

  it('contains no CRLF — line endings are part of the checksum', () => {
    const withCrlf = migrationFiles().filter((name) => readFileSync(join(MIGRATIONS_DIR, name)).includes('\r\n'));
    expect(
      withCrlf,
      `CRLF found in: ${withCrlf.join(', ')} — .gitattributes pins *.sql -text, so the working tree has diverged`
    ).toEqual([]);
  });

  it('is byte-identical to what git stores, so CI compiles the same bytes', () => {
    // The failure this catches: git normalises on `add` but never rewrites the
    // working file, so a checked-out tree can silently differ from the blob CI
    // clones. Skipped when git is unavailable rather than failing the suite.
    let gitAvailable = true;
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
    } catch {
      gitAvailable = false;
    }
    if (!gitAvailable) return;

    const diverged: string[] = [];
    for (const name of migrationFiles()) {
      const blob = execFileSync('git', ['show', `HEAD:${REPO_RELATIVE}/${name}`], {
        maxBuffer: 32 * 1024 * 1024,
      });
      if (sha384(blob) !== sha384(readFileSync(join(MIGRATIONS_DIR, name)))) diverged.push(name);
    }
    expect(
      diverged,
      `working tree differs from git blob: ${diverged.join(', ')} — a local build would ship different checksums than CI`
    ).toEqual([]);
  });
});
