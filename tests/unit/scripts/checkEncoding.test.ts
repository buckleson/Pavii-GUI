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
const { checkFile } = require('../../../scripts/check-encoding.js') as {
  checkFile: (absPath: string) => Array<{ file: string; line: number; rule: string; detail: string }>;
};

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

let tmpDir: string;

const write = (name: string, contents: Buffer | string): string => {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
};

const rulesFor = (filePath: string): string[] => checkFile(filePath).map((finding) => finding.rule);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-encoding-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkFile', () => {
  it('accepts clean UTF-8, including non-ASCII text', () => {
    const filePath = write('clean.json', '{"name":"Pavii","zh":"系统设置"}\n');
    expect(checkFile(filePath)).toEqual([]);
  });

  it('flags a UTF-8 BOM, the byte PowerShell prepends', () => {
    const filePath = write('bom.json', Buffer.concat([BOM, Buffer.from('{"a":1}\n')]));
    const findings = checkFile(filePath);
    expect(findings.map((f) => f.rule)).toContain('bom');
    expect(findings[0]?.detail).toMatch(/BOM/);
  });

  it('flags bytes that are not valid UTF-8 at all', () => {
    // 0xE9 is "e-acute" in cp1252 and an invalid lone lead byte in UTF-8.
    const filePath = write('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    expect(rulesFor(filePath)).toEqual(['invalid-utf8']);
  });

  it('flags UTF-8 that was round-tripped through cp1252', () => {
    // "café" encoded UTF-8, misread as cp1252, re-encoded UTF-8.
    const filePath = write('mojibake.txt', 'cafÃ© latte\n');
    const findings = checkFile(filePath);
    expect(findings.map((f) => f.rule)).toEqual(['mojibake']);
    expect(findings[0]?.detail).toMatch(/cp1252/);
  });

  it('flags characters already lost to a bad decode', () => {
    const filePath = write('lost.txt', 'line one\n负责�理\n');
    const findings = checkFile(filePath);
    expect(findings.map((f) => f.rule)).toEqual(['replacement']);
    expect(findings[0]?.line).toBe(2);
  });

  it('reports both rules when a file is BOM-prefixed and mojibaked', () => {
    const filePath = write('both.json', Buffer.concat([BOM, Buffer.from('{"t":"cafÃ©"}\n')]));
    expect(rulesFor(filePath).sort()).toEqual(['bom', 'mojibake']);
  });

  it('skips binary files by extension', () => {
    const filePath = write('icon.png', Buffer.concat([BOM, Buffer.from([0x89, 0x50, 0x4e, 0x47])]));
    expect(checkFile(filePath)).toEqual([]);
  });

  it('skips binary content that does not announce itself by extension', () => {
    const filePath = write('blob.txt', Buffer.from([0x01, 0x00, 0x02, 0x00]));
    expect(checkFile(filePath)).toEqual([]);
  });

  it('does not flag ordinary Latin text containing an uppercase A-tilde', () => {
    // Portuguese "NAO" with a tilde is not mojibake: the next char is ASCII.
    const filePath = write('pt.md', 'NÃO use PowerShell\n');
    expect(checkFile(filePath)).toEqual([]);
  });
});
