/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readJsonFile, writeJsonFile } = require('../../../packages/shared-scripts/src/read-json-file.js') as {
  readJsonFile: (filePath: string) => Record<string, unknown>;
  writeJsonFile: (filePath: string, value: unknown) => void;
};

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

let tmpDir: string;
let manifestPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-json-'));
  manifestPath = path.join(tmpDir, 'manifest.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readJsonFile', () => {
  it('parses ordinary JSON', () => {
    fs.writeFileSync(manifestPath, '{"sourceType":"local-source-build"}');
    expect(readJsonFile(manifestPath)).toEqual({ sourceType: 'local-source-build' });
  });

  it('parses JSON prefixed with a UTF-8 BOM', () => {
    // This is exactly what defeated the engine pin guard: PowerShell wrote the
    // BOM, JSON.parse threw, and the upstream engine overwrote the local build.
    fs.writeFileSync(manifestPath, Buffer.concat([BOM, Buffer.from('{"sourceType":"local-source-build"}')]));
    expect(readJsonFile(manifestPath)).toEqual({ sourceType: 'local-source-build' });
  });

  it('throws an error naming the file when the JSON is malformed', () => {
    fs.writeFileSync(manifestPath, '{ not json');
    expect(() => readJsonFile(manifestPath)).toThrow(/manifest\.json/);
  });

  it('says a BOM was stripped when a BOM-prefixed file still fails to parse', () => {
    fs.writeFileSync(manifestPath, Buffer.concat([BOM, Buffer.from('{ not json')]));
    expect(() => readJsonFile(manifestPath)).toThrow(/BOM was stripped/);
  });

  it('throws an error naming the file when it does not exist', () => {
    expect(() => readJsonFile(path.join(tmpDir, 'absent.json'))).toThrow(/absent\.json/);
  });
});

describe('writeJsonFile', () => {
  it('writes BOM-free UTF-8 that reads back through readJsonFile', () => {
    writeJsonFile(manifestPath, { version: 'v0.1.69-pavii', files: ['paviicore.exe'] });
    const bytes = fs.readFileSync(manifestPath);
    expect(bytes.subarray(0, 3).equals(BOM)).toBe(false);
    expect(bytes.at(-1)).toBe(0x0a);
    expect(readJsonFile(manifestPath)).toEqual({ version: 'v0.1.69-pavii', files: ['paviicore.exe'] });
  });
});
