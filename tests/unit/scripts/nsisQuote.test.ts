/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { nsisQuote } = require('../../../packages/shared-scripts/src/nsis-quote') as {
  nsisQuote: (value: unknown) => string;
};

describe('nsisQuote', () => {
  // The regression this file exists for: the installer smoke harnesses escaped
  // backslashes the C way, and the failure MessageBox showed the user
  // `D:\\Temp\\aionui-...\\locked-by-smoke.txt`. NSIS gives a backslash no
  // meaning inside a string, so nothing ever collapsed the pair.
  it('leaves Windows path separators exactly as given', () => {
    const raw = 'D:\\Temp\\aionui-rm-ui-PKkoNk\\install-dir\\locked-by-smoke.txt';

    expect(nsisQuote(raw)).toBe(raw);
    expect(nsisQuote(raw)).not.toContain('\\\\');
  });

  it('leaves a UNC path intact, leading double separator included', () => {
    // `\\server\share` is two real separators, not an escape. Collapsing or
    // doubling either half produces a path that does not resolve.
    expect(nsisQuote('\\\\build-host\\artifacts\\Pavii.Ai.exe')).toBe('\\\\build-host\\artifacts\\Pavii.Ai.exe');
  });

  it('doubles $ so NSIS does not expand it as a variable', () => {
    // The old implementation used `.replace(/\$/g, '$$')`, where `$$` in a
    // replacement string means one literal `$` — a no-op that left every `$`
    // unescaped.
    expect(nsisQuote('a$INSTDIR')).toBe('a$$INSTDIR');
    expect(nsisQuote('C:\\$RECYCLE.BIN\\x')).toBe('C:\\$$RECYCLE.BIN\\x');
    expect(nsisQuote('$$')).toBe('$$$$');
  });

  it('escapes a double quote with the NSIS $\\" prefix', () => {
    expect(nsisQuote('say "hi"')).toBe('say $\\"hi$\\"');
  });

  it('does not double the $ it introduces while escaping a quote', () => {
    // Ordering guard: escaping `"` emits `$\"`. Were `$` escaped afterwards,
    // that `$` would become `$$` and NSIS would render a stray dollar sign.
    expect(nsisQuote('"')).toBe('$\\"');
  });

  it('handles a path carrying both hazards at once', () => {
    expect(nsisQuote('C:\\Users\\a$b\\"q".log')).toBe('C:\\Users\\a$$b\\$\\"q$\\".log');
  });

  it('coerces non-string input rather than throwing', () => {
    expect(nsisQuote(1003)).toBe('1003');
    expect(nsisQuote(undefined)).toBe('undefined');
    expect(nsisQuote(null)).toBe('null');
  });

  it('returns an empty string unchanged', () => {
    expect(nsisQuote('')).toBe('');
  });
});
