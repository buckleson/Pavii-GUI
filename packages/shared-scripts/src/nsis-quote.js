/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Escape a JS value for interpolation into an NSIS double-quoted string.
 *
 * NSIS is not C. A backslash carries no meaning inside an NSIS string — it is
 * an ordinary character, and paths are written raw (`StrCpy $INSTDIR
 * "$TEMP\foo"`). The escape prefix is `$\` instead, and `$` itself is the one
 * character that must be doubled, because NSIS expands `$INSTDIR`, `$TEMP`,
 * `$0`-`$9` and friends inside string literals.
 *
 * Escaping backslashes the C way is what the installer smoke harnesses used to
 * do, and it put `D:\\Temp\\aionui-...\\locked-by-smoke.txt` in front of the
 * user in the failure MessageBox. It survived unnoticed because the same
 * doubling is harmless in the *other* places a quoted path is used — `OutFile`,
 * `!include` and `$INSTDIR` all reach a Win32 call that collapses repeated
 * separators — so only the one path that gets displayed rather than opened
 * showed the damage.
 *
 * Order matters: `$` is doubled first, so the `$` this function then
 * introduces as part of `$\"` is left alone.
 *
 * @param {unknown} value
 * @returns {string} the value, safe to place between double quotes in NSIS source
 */
function nsisQuote(value) {
  // '$$$$' is not a typo: in a String.replace replacement, `$$` denotes one
  // literal `$`, so four are needed to emit two. The previous `'$$'` was a
  // silent no-op that left `$` unescaped entirely.
  return String(value).replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
}

module.exports = { nsisQuote };
