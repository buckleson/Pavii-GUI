#!/usr/bin/env node
/**
 * Encoding gate.
 *
 * Two shipped regressions in this repository came from the same mechanism:
 * a text file was rewritten through Windows PowerShell, which prepends a
 * UTF-8 BOM and re-decodes UTF-8 bytes as cp1252. Both times a downstream
 * parser failed and degraded to a plausible-looking wrong state (an empty
 * assistant catalog; an upstream engine download) instead of stopping.
 *
 * This script makes that class of damage visible before it can ship.
 *
 * Rules:
 *   bom           file starts with a UTF-8 byte-order mark
 *   invalid-utf8  bytes that are not valid UTF-8 at all
 *   mojibake      UTF-8 text that was round-tripped through cp1252
 *   replacement   U+FFFD, i.e. characters already lost to a bad decode
 *
 * Line endings are deliberately NOT checked: .gitattributes sets
 * `* text=auto eol=lf`, so git normalises them on commit.
 *
 * This file contains no non-ASCII characters. Every character it looks for is
 * written as a numeric code point, so the checker cannot be corrupted by the
 * very thing it detects.
 *
 * Usage:
 *   node scripts/check-encoding.js                 # all git-tracked text files
 *   node scripts/check-encoding.js <path>...       # explicit files/dirs, tracked or not
 *   node scripts/check-encoding.js --fix           # strip BOMs (mojibake is never auto-fixed)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

/**
 * Paths permitted to contain byte sequences the rules otherwise reject.
 * Every entry must carry a reason.
 */
const ALLOWLIST = [
  {
    prefix: 'sentry-feedback-resolutions/',
    reason: 'Bug notes quote GBK-mangled UI strings as the evidence for the bug they describe.',
  },
  {
    prefix: 'tests/unit/scripts/checkEncoding.test.ts',
    reason: 'Fixtures for this checker must contain the byte sequences it rejects.',
  },
];

const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|eot|otf|pdf|zip|tar|gz|bz2|xz|7z|exe|dll|so|dylib|node|bin|icns|mp[34]|mov|webm|wasm|jar|jnilib|snap|db|sqlite3?)$/i;

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const NUL = String.fromCharCode(0);
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/**
 * When UTF-8 bytes are decoded as cp1252, the UTF-8 lead byte becomes a
 * Latin-1 letter. Only leads that do not occur as ordinary lowercase prose are
 * listed: Latin-1 supplement (0xC2-0xC5), Greek (0xCE-0xCF), Cyrillic
 * (0xD0-0xD1), general punctuation (0xE2), emoji and other astral planes
 * (0xF0).
 *
 * Lowercase accented leads (0xE0-0xE9, which cover CJK) are deliberately
 * excluded: they are ordinary French, Spanish and Turkish text. CJK mojibake
 * is caught instead by the continuation-pair rule below, which does not depend
 * on the lead character at all.
 */
const MOJIBAKE_LEADS = new Set([0xc2, 0xc3, 0xc4, 0xc5, 0xce, 0xcf, 0xd0, 0xd1, 0xe2, 0xf0]);

/**
 * cp1252 maps bytes 0x80-0x9F to these code points; UTF-8 continuation bytes
 * in that range surface as these glyphs. Continuation bytes 0xA0-0xBF map to
 * themselves and are handled by the range test below.
 */
const CP1252_HIGH_PUNCTUATION = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isMojibakeContinuation(code) {
  return (code >= 0x80 && code <= 0xbf) || CP1252_HIGH_PUNCTUATION.has(code);
}

/**
 * Symbols in 0xA1-0xBF. Two of these in a row is the tail of a mangled
 * multi-byte character; prose does not stack symbols like that. 0xA0 is
 * excluded because French legitimately writes a non-breaking space after a
 * word, next to an accented letter.
 */
function isSymbolRun(code) {
  return code >= 0xa1 && code <= 0xbf;
}

/**
 * Mojibake is either a distinctive lead character followed by a continuation,
 * or two stacked symbols. Requiring a pair in both cases is what keeps
 * ordinary accented prose clean: after an accented letter, real text has an
 * ASCII character.
 *
 * @returns {number} index of the first match, or -1
 */
function findMojibake(text) {
  for (let i = 0; i < text.length - 1; i += 1) {
    const code = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (MOJIBAKE_LEADS.has(code) && isMojibakeContinuation(next)) return i;
    if (isSymbolRun(code) && isSymbolRun(next)) return i;
  }
  return -1;
}

function isAllowlisted(relPath) {
  return ALLOWLIST.some((entry) => relPath === entry.prefix || relPath.startsWith(entry.prefix));
}

function toRepoRelative(absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

function listTrackedFiles() {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    cwd: projectRoot,
    maxBuffer: 128 * 1024 * 1024,
  });
  return stdout
    .toString('utf8')
    .split(NUL)
    .filter(Boolean)
    .map((p) => path.join(projectRoot, p));
}

function walkDirectory(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDirectory(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function expandInputs(inputs) {
  const files = [];
  for (const input of inputs) {
    const abs = path.resolve(projectRoot, input);
    if (!fs.existsSync(abs)) {
      throw new Error(`No such file or directory: ${input}`);
    }
    if (fs.statSync(abs).isDirectory()) walkDirectory(abs, files);
    else files.push(abs);
  }
  return files;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function excerptAround(text, index) {
  const start = Math.max(0, index - 30);
  return text
    .slice(start, index + 30)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} absPath
 * @returns {Array<{ file: string; line: number; rule: string; detail: string }>}
 */
function checkFile(absPath) {
  const relPath = toRepoRelative(absPath);
  if (BINARY_EXTENSIONS.test(relPath)) return [];
  if (isAllowlisted(relPath)) return [];

  let bytes;
  try {
    bytes = fs.readFileSync(absPath);
  } catch {
    return [];
  }
  // Binary content that does not announce itself through its extension.
  if (bytes.subarray(0, 4096).includes(0)) return [];

  const findings = [];

  if (bytes.subarray(0, 3).equals(UTF8_BOM)) {
    findings.push({
      file: relPath,
      line: 1,
      rule: 'bom',
      detail: 'file begins with a UTF-8 BOM (PowerShell Set-Content/Out-File writes one)',
    });
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    findings.push({ file: relPath, line: 1, rule: 'invalid-utf8', detail: 'file is not valid UTF-8' });
    return findings;
  }

  const mojibakeIndex = findMojibake(text);
  if (mojibakeIndex !== -1) {
    findings.push({
      file: relPath,
      line: lineOf(text, mojibakeIndex),
      rule: 'mojibake',
      detail: `UTF-8 round-tripped through cp1252: ${excerptAround(text, mojibakeIndex)}`,
    });
  }

  const replacementIndex = text.indexOf(REPLACEMENT_CHAR);
  if (replacementIndex !== -1) {
    findings.push({
      file: relPath,
      line: lineOf(text, replacementIndex),
      rule: 'replacement',
      detail: `contains U+FFFD, characters already lost: ${excerptAround(text, replacementIndex)}`,
    });
  }

  return findings;
}

function stripBom(absPath) {
  const bytes = fs.readFileSync(absPath);
  if (!bytes.subarray(0, 3).equals(UTF8_BOM)) return false;
  fs.writeFileSync(absPath, bytes.subarray(3));
  return true;
}

function main(argv) {
  const fix = argv.includes('--fix');
  const inputs = argv.filter((arg) => !arg.startsWith('--'));
  const files = inputs.length > 0 ? expandInputs(inputs) : listTrackedFiles();

  let findings = files.flatMap(checkFile);

  if (fix) {
    const bomFiles = [...new Set(findings.filter((f) => f.rule === 'bom').map((f) => f.file))];
    for (const relPath of bomFiles) {
      if (stripBom(path.join(projectRoot, relPath))) {
        console.log(`fixed  ${relPath}: stripped UTF-8 BOM`);
      }
    }
    // Re-check so the exit code reflects what is left, not what was found.
    findings = files.flatMap(checkFile);
  }

  if (findings.length === 0) {
    console.log(`check-encoding: ${files.length} files scanned, no problems found`);
    return 0;
  }

  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.rule}: ${finding.detail}`);
  }
  console.error('');
  console.error(`check-encoding: ${findings.length} problem(s) found.`);
  console.error('Do not repair these with PowerShell text cmdlets - that is what causes them.');
  console.error('Rewrite the file as BOM-free UTF-8 (Node fs.writeFileSync, or an editor set to UTF-8 without BOM).');
  console.error('BOMs alone can be removed with: node scripts/check-encoding.js --fix');
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-encoding: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkFile, findMojibake, main, ALLOWLIST };
