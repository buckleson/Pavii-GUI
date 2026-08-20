#!/usr/bin/env node
/**
 * Language gate: the desktop app ships English only.
 *
 * An earlier English-only pass removed the non-English locale files, and the
 * app still showed Chinese buttons. The cause was not a missed translation:
 * Arco's own default locale is zh-CN, so any `ConfigProvider` that forgets to
 * pass `locale` fails *toward* Chinese, and imperative dialogs read that
 * default. Nothing checked for the result, so it shipped.
 *
 * This script makes the leak visible before it can ship again.
 *
 * Rule:
 *   cjk  Chinese, Japanese or Korean characters in desktop app source
 *
 * Scope is `packages/desktop/src` only. The vendored Rust engine is upstream
 * code whose Chinese content is test fixtures for multibyte handling; rewriting
 * it would create merge pain for no user-visible gain.
 *
 * Not every non-ASCII character is a defect. Accented Latin, Cyrillic and Greek
 * are left alone: they appear in legitimate identifiers, sample data and
 * language endonyms. Only CJK is checked, because that is the script this
 * codebase actually leaks.
 *
 * Every character this file looks for is written as a numeric code point, so
 * the checker itself stays ASCII and cannot trip its own rule.
 *
 * Usage:
 *   node scripts/check-language.js               # scan packages/desktop/src
 *   node scripts/check-language.js <path>...     # scan explicit files/dirs
 */

'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

/**
 * Default scan roots. `resources/windows` is included because the installer's
 * MessageBoxes and LangStrings are user-facing text too — 35 Chinese strings
 * shipped there unnoticed precisely because this gate only watched the app
 * source.
 */
const DEFAULT_SCAN_ROOTS = [
  path.join(projectRoot, 'packages', 'desktop', 'src'),
  path.join(projectRoot, 'resources', 'windows'),
];

const SCANNED_EXTENSIONS = /\.(tsx?|jsx?|css|json|nsh|ps1)$/i;

/**
 * Paths permitted to contain CJK. Every entry must carry a reason, and the
 * reason must be why the characters are *correct*, not why fixing them is
 * inconvenient.
 */
const ALLOWLIST = [
  {
    prefix:
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/speechSettingsUtils.ts',
    reason:
      'Transcription prompts are spoken-language samples fed to the speech model to steer output script; they are data, not UI text.',
  },
  {
    prefix: 'packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx',
    reason: 'Matches a Chinese auth-failure string emitted by an upstream agent CLI, and renders an English message.',
  },
  {
    prefix: 'packages/desktop/src/renderer/utils/model/agentLogo.ts',
    reason: 'Matches a Chinese "default" label coming from a model provider; removing it would break detection.',
  },
  {
    prefix: 'packages/desktop/src/renderer/hooks/agent/usePresetAssistantInfo.ts',
    reason:
      'Matches the Chinese "你是 **name**" preamble an assistant rule can open with, to recover the name. Pattern only, never displayed.',
  },
  {
    prefix: 'packages/desktop/src/renderer/hooks/system/useSpeechInput.ts',
    reason:
      'A CJK codepoint range used to decide whether joining two speech segments needs a space; CJK needs none. Detection only, never displayed.',
  },
  {
    prefix: 'packages/desktop/src/renderer/pages/conversation/components/ConversationTitleMinimap/minimapUtils.ts',
    reason: 'Builds Chinese search tokens so a user typing Chinese numerals can still find a turn. Never displayed.',
  },
  {
    prefix: 'packages/desktop/src/renderer/pages/TestShowcase.tsx',
    reason: 'Development-only component gallery; its route is compiled out of production builds.',
  },
  {
    prefix: 'tests/unit/scripts/checkLanguage.test.ts',
    reason: 'Fixtures for this checker must contain the characters it rejects.',
  },
];

/**
 * CJK ranges: symbols/punctuation, Hiragana/Katakana, CJK Unified Ideographs,
 * Hangul syllables.
 *
 * U+3000-U+303F must stay first in this list, and is the range most likely to
 * be dropped by someone tidying it: it holds no ideographs, only punctuation --
 * the ideographic comma U+3001, the ideographic full stop U+3002, the corner
 * and angle brackets. Those are the characters that survive a translation pass,
 * because a sentence reads as English right up until its separator. Leaving the
 * list to start at U+3040 let three list-joining calls render U+3001 into
 * English tooltips, and hid several comment fragments that an earlier pass had
 * truncated at a full-width full stop.
 */
const CJK_RANGES = [
  [0x3000, 0x303f],
  [0x3040, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

function isCjk(code) {
  return CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/** @returns {number} index of the first CJK character, or -1 */
function findCjk(text) {
  for (let i = 0; i < text.length; i += 1) {
    if (isCjk(text.charCodeAt(i))) return i;
  }
  return -1;
}

function toRepoRelative(absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

function isAllowlisted(relPath) {
  return ALLOWLIST.some((entry) => relPath === entry.prefix || relPath.startsWith(entry.prefix));
}

function walkDirectory(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDirectory(full, out);
    else if (SCANNED_EXTENSIONS.test(entry.name)) out.push(full);
  }
  return out;
}

function collectTargets(args) {
  if (args.length === 0) {
    const out = [];
    for (const root of DEFAULT_SCAN_ROOTS) walkDirectory(root, out);
    return out;
  }
  const out = [];
  for (const arg of args) {
    const abs = path.resolve(projectRoot, arg);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walkDirectory(abs, out);
    else out.push(abs);
  }
  return out;
}

/** Line and column of a character offset, both 1-based, for a clickable report. */
function locate(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return { line, column };
}

function main(argv) {
  const targets = collectTargets(argv);
  const failures = [];

  for (const absPath of targets) {
    const relPath = toRepoRelative(absPath);
    if (isAllowlisted(relPath)) continue;

    let text;
    try {
      text = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const offset = findCjk(text);
    if (offset === -1) continue;

    const { line, column } = locate(text, offset);
    failures.push({ relPath, line, column, sample: text.slice(offset, offset + 12) });
  }

  if (failures.length > 0) {
    console.error('check-language: the app ships English only, but found CJK text.\n');
    for (const f of failures) {
      console.error(`  ${f.relPath}:${f.line}:${f.column}  ${f.sample}`);
    }
    console.error(
      `\n${failures.length} file(s). Translate the text, or add an ALLOWLIST entry in ` +
        'scripts/check-language.js explaining why the characters are correct.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`check-language: ${targets.length} files scanned, English only`);
}

main(process.argv.slice(2));
