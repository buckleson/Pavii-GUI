/**
 * BOM-tolerant JSON file reader for build-critical manifests.
 *
 * Windows PowerShell's `Set-Content -Encoding utf8` and `Out-File` prepend a
 * UTF-8 BOM. `JSON.parse` throws on it. When a build guard swallowed that
 * throw, the pinned locally-built engine was silently replaced by an upstream
 * download - so this reader strips the BOM, and when parsing still fails it
 * throws an error that names the file and shows the offending bytes instead of
 * leaving the caller to guess.
 */

'use strict';

const fs = require('fs');

// U+FEFF, written by code point so this source file stays pure ASCII.
const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * Read and parse a JSON file, tolerating a leading UTF-8 BOM.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @returns {unknown} The parsed value.
 * @throws {Error} If the file cannot be read or does not contain valid JSON.
 *   The message always names the file.
 */
function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read JSON file ${filePath}: ${error.message}`, { cause: error });
  }

  const hadBom = raw.startsWith(UTF8_BOM);
  const text = hadBom ? raw.slice(UTF8_BOM.length) : raw;

  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = JSON.stringify(text.slice(0, 80));
    const bomNote = hadBom ? ' (a UTF-8 BOM was stripped before parsing)' : '';
    throw new Error(`Failed to parse JSON file ${filePath}${bomNote}: ${error.message}. First bytes: ${preview}`, { cause: error });
  }
}

/**
 * Serialize a value as BOM-free UTF-8 JSON with a trailing newline.
 *
 * Build steps must write manifests through this rather than a shell
 * redirect - `>` and `Out-File` in Windows PowerShell add the BOM that
 * [readJsonFile] exists to survive.
 *
 * @param {string} filePath Absolute destination path.
 * @param {unknown} value Value to serialize.
 */
function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8' });
}

module.exports = { readJsonFile, writeJsonFile };
