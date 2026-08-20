/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The gate runs as a script (it calls main() on import and exports nothing), so
// it is exercised the way CI does: as a subprocess, asserting the exit code.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const script = path.join(repoRoot, 'scripts', 'check-language.js');

// Scratch lives inside the repository, per the project's storage rule.
const scratchRoot = path.join(repoRoot, 'node_modules', '.tmp-check-language');
let scratch: string;

function run(target: string): { status: number; output: string } {
  const result = spawnSync(process.execPath, [script, target], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return { status: result.status ?? -1, output: (result.stdout ?? '') + (result.stderr ?? '') };
}

function fixture(name: string, contents: string): string {
  const file = path.join(scratch, name);
  writeFileSync(file, contents, 'utf-8');
  return file;
}

beforeAll(() => {
  mkdirSync(scratchRoot, { recursive: true });
  scratch = mkdtempSync(path.join(scratchRoot, 'case-'));
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe('check-language', () => {
  it('passes a file that is entirely English', () => {
    const file = fixture('clean.ts', 'export const label = "Confirm Create";\n');

    const { status, output } = run(file);

    expect(status).toBe(0);
    expect(output).toContain('English only');
  });

  // The regression this file was added for. U+3001 sits in CJK Symbols and
  // Punctuation (U+3000-U+303F), which the range table originally skipped by
  // starting at U+3040 -- so three `join()` calls shipped an ideographic comma
  // into English tooltips and nothing complained.
  it('rejects the ideographic comma U+3001', () => {
    const file = fixture('ideographic-comma.ts', `const names = list.join('、');\n`);

    const { status, output } = run(file);

    expect(status).toBe(1);
    expect(output).toContain('found CJK text');
  });

  it('rejects the ideographic full stop U+3002', () => {
    // Truncated comment fragments left by an earlier translation pass ended on
    // exactly this character and went unreported.
    const file = fixture('ideographic-stop.ts', '// historyKeymap。\n');

    const { status, output } = run(file);

    expect(status).toBe(1);
  });

  it.each([
    ['ideograph', '你好'],
    ['hiragana', 'こん'],
    ['katakana', 'カタ'],
    ['hangul', '한글'],
    ['full-width form', 'ＡＢ'],
    ['corner bracket', '「」'],
  ])('rejects %s', (label, text) => {
    const file = fixture(`${label.replace(/\s+/g, '-')}.ts`, `const s = '${text}';\n`);

    expect(run(file).status).toBe(1);
  });

  it('accepts characters just outside the punctuation block', () => {
    // U+2FFF is the last codepoint before the block opens. Guards against a
    // future edit widening the range too far and failing ordinary text.
    const file = fixture('boundary.ts', "const s = '⿿';\n");

    expect(run(file).status).toBe(0);
  });

  it('reports the offending path with a line and column', () => {
    const file = fixture('located.ts', ['const a = 1;', 'const b = 2;', "const c = '你';"].join('\n'));

    const { output } = run(file);

    expect(output).toContain('located.ts:3:');
  });
});
