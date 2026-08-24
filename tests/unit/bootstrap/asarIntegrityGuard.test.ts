/**
 * @license
 * Copyright 2025 Pavii.Ai (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const requireFromRepo = createRequire(join(repoRoot, 'package.json'));
const { verifyAsarIntegrity } = requireFromRepo('./scripts/afterPack.js') as {
  verifyAsarIntegrity: (resourcesDir: string) => void;
};

type AsarFileEntry = {
  size: number;
  offset?: string;
  unpacked?: boolean;
  integrity: { algorithm: 'SHA256'; hash: string };
};

type AsarDirEntry = { files: Record<string, AsarFileEntry | AsarDirEntry> };

/**
 * One archive member. `headerContent` is what the header claims about the file
 * (its size and hash); `content` is what actually lands in the archive body.
 * Letting the two differ is the whole point — that divergence is the production
 * bug this guard exists to catch, and every failure fixture below is expressed
 * as some flavour of it.
 */
type FileSpec = {
  path: string;
  content?: string | Buffer;
  headerContent?: string | Buffer;
  unpacked?: boolean;
};

const toBuffer = (value: string | Buffer): Buffer => (Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

/**
 * Build a byte-correct asar archive by hand.
 *
 * Layout: a 16-byte four-field pickle header (`uint32LE @4` sizes the pickle so
 * the body starts at `8 + it`, `uint32LE @12` is the header JSON length),
 * the UTF-8 header JSON padded to a 4-byte boundary, then the concatenated file
 * bodies. Entry offsets are accumulated from the *declared* sizes, exactly as
 * electron-builder does from its first stat pass, so a spec whose real content
 * is longer than its declared content displaces every later entry for free.
 */
function buildAsar(specs: FileSpec[]): Buffer {
  const root: AsarDirEntry = { files: {} };
  const bodyChunks: Buffer[] = [];
  let nextOffset = 0;

  const insert = (path: string, entry: AsarFileEntry): void => {
    const parts = path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.files[part]) {
        node.files[part] = { files: {} };
      }
      node = node.files[part] as AsarDirEntry;
    }
    node.files[parts[parts.length - 1]] = entry;
  };

  for (const spec of specs) {
    const declared = toBuffer(spec.headerContent ?? spec.content ?? '');
    const integrity = { algorithm: 'SHA256' as const, hash: sha256(declared) };

    if (spec.unpacked) {
      insert(spec.path, { size: declared.length, unpacked: true, integrity });
      continue;
    }

    insert(spec.path, { size: declared.length, offset: String(nextOffset), integrity });
    nextOffset += declared.length;
    bodyChunks.push(toBuffer(spec.content ?? ''));
  }

  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const paddedJsonSize = json.length + ((4 - (json.length % 4)) % 4);
  const head = Buffer.alloc(16 + paddedJsonSize);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + paddedJsonSize, 4);
  head.writeUInt32LE(4 + paddedJsonSize, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);

  return Buffer.concat([head, ...bodyChunks]);
}

const tempDirs: string[] = [];

function makeResourcesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aionui-asar-guard-'));
  tempDirs.push(dir);
  return dir;
}

function writeAsar(specs: FileSpec[]): string {
  const dir = makeResourcesDir();
  writeFileSync(join(dir, 'app.asar'), buildAsar(specs));
  return dir;
}

const MAIN_PATH = 'out/main/index.js';
const MAIN_SOURCE = 'require("./boot");\n';
const RENDERER_HTML = '<!doctype html><html><body id="root"></body></html>\n';
const LICENSE_TEXT = 'A'.repeat(64);

const packageJson = (main?: string): string =>
  JSON.stringify(main === undefined ? { name: 'pavii-ai' } : { name: 'pavii-ai', main });

/**
 * The canonical healthy archive: a leading file, package.json pointing at a
 * real packed main script, and a trailing renderer asset that doubles as the
 * "last entry" the guard tail-checks.
 */
const wellFormed = (): FileSpec[] => [
  { path: 'LICENSE', content: LICENSE_TEXT },
  { path: 'package.json', content: packageJson(MAIN_PATH) },
  { path: MAIN_PATH, content: MAIN_SOURCE },
  { path: 'out/renderer/index.html', content: RENDERER_HTML },
];

describe('verifyAsarIntegrity', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop() as string, { recursive: true, force: true });
    }
  });

  // Proves the hand-rolled buildAsar helper emits a real asar before any
  // failure case leans on it. Without this, a helper bug would make every
  // "throws" assertion below pass for the wrong reason and the guard would be
  // untested while looking fully covered.
  it('passes a well-formed archive whose main field resolves to a packed entry', () => {
    const resourcesDir = writeAsar(wellFormed());

    expect(() => verifyAsarIntegrity(resourcesDir)).not.toThrow();
  });

  // afterPack runs before signing; if app.asar were absent the packer would
  // otherwise sail on and ship an installer with no application in it.
  it('throws when app.asar is missing entirely', () => {
    const resourcesDir = makeResourcesDir();

    expect(() => verifyAsarIntegrity(resourcesDir)).toThrow(/app\.asar/);
  });

  // The exact shipped incident: a source file grew between electron-builder's
  // stat pass and its stream pass, so the header recorded 3641 bytes while the
  // archive held 5884 and every later entry slid by +2243. The build signed
  // cleanly and the app exited 1 instantly with no output anywhere. The
  // asar-integrity fuse is off, so nothing else in the pipeline notices.
  it('throws when archive contents are displaced relative to the header', () => {
    const resourcesDir = writeAsar([
      { path: 'LICENSE', headerContent: LICENSE_TEXT, content: LICENSE_TEXT + 'B'.repeat(2243) },
      { path: 'package.json', content: packageJson(MAIN_PATH) },
      { path: MAIN_PATH, content: MAIN_SOURCE },
      { path: 'out/renderer/index.html', content: RENDERER_HTML },
    ]);

    expect(() => verifyAsarIntegrity(resourcesDir)).toThrow(/displaced from its header/i);
  });

  // package.json at its recorded offset is the first thing Electron reads and
  // the cheapest proof that offsets still line up. If garbage there did not
  // fail the build, the app would die before executing a line of its own code.
  it('throws when package.json is not valid JSON at its recorded offset', () => {
    const resourcesDir = writeAsar([
      { path: 'LICENSE', content: LICENSE_TEXT },
      { path: 'package.json', content: 'not json at all, just prose' },
      { path: MAIN_PATH, content: MAIN_SOURCE },
      { path: 'out/renderer/index.html', content: RENDERER_HTML },
    ]);

    expect(() => verifyAsarIntegrity(resourcesDir)).toThrow(/not valid JSON at its recorded offset/);
  });

  // Same-length corruption keeps every offset intact, so package.json still
  // parses and only the hash betrays it. The app would boot into a main script
  // that is not the one that was built, reviewed, or tested.
  it('throws and names the main script when its bytes do not match the header hash', () => {
    const resourcesDir = writeAsar([
      { path: 'LICENSE', content: LICENSE_TEXT },
      { path: 'package.json', content: packageJson(MAIN_PATH) },
      { path: MAIN_PATH, headerContent: MAIN_SOURCE, content: 'require("./evil");\n' },
      { path: 'out/renderer/index.html', content: RENDERER_HTML },
    ]);

    expect(() => verifyAsarIntegrity(resourcesDir)).toThrow(new RegExp(`${MAIN_PATH}.*header hash`));
  });

  // The boot path being intact proves nothing about the other ~40k entries.
  // Drift introduced after package.json and main still displaces the tail, and
  // this tail check is the only sampling that catches it — a renderer bundle
  // silently replaced by neighbouring bytes ships as a blank window.
  it('throws when only the final packed entry mismatches its hash', () => {
    const resourcesDir = writeAsar([
      { path: 'LICENSE', content: LICENSE_TEXT },
      { path: 'package.json', content: packageJson(MAIN_PATH) },
      { path: MAIN_PATH, content: MAIN_SOURCE },
      { path: 'out/renderer/index.html', headerContent: RENDERER_HTML, content: 'X'.repeat(RENDERER_HTML.length) },
    ]);

    expect(() => verifyAsarIntegrity(resourcesDir)).toThrow(/final archive entry \(out\/renderer\/index\.html\)/);
  });

  // A header with nothing packed in it means the archive is empty or the
  // header failed to parse into anything usable. Treating that as "no
  // mismatches found" would turn the guard into a no-op that always passes.
  it('throws when the header lists no packed files', () => {
    const resourcesDir = writeAsar([]);

    expect(() => verifyAsarIntegrity(resourcesDir)).toThrow(/no packed files/);
  });

  // Real builds unpack native modules into app.asar.unpacked, so their bytes
  // are deliberately absent from the archive body. Reading them would either
  // hash zero-fill or pick up an unrelated neighbour, failing every genuine
  // release build — a guard that cries wolf gets deleted, and then the real
  // displacement bug ships again.
  it('does not read entries marked unpacked and does not fail because of them', () => {
    const resourcesDir = writeAsar([
      { path: 'LICENSE', content: LICENSE_TEXT },
      { path: 'package.json', content: packageJson(MAIN_PATH) },
      { path: MAIN_PATH, content: MAIN_SOURCE },
      { path: 'out/renderer/index.html', content: RENDERER_HTML },
      { path: 'node_modules/node-pty/build/pty.node', unpacked: true, headerContent: 'N'.repeat(9999) },
    ]);

    expect(() => verifyAsarIntegrity(resourcesDir)).not.toThrow();
  });

  // The guard must degrade rather than crash on a package.json shape it did
  // not anticipate. A TypeError thrown out of the hook would abort a healthy
  // build with a stack trace pointing at afterPack instead of at the archive,
  // which is a worse failure than not checking the main script at all.
  it.each([
    { label: 'absent main field', main: undefined },
    { label: 'main pointing at a path not in the header', main: 'out/main/does-not-exist.js' },
  ])('does not throw for a package.json with an $label', ({ main }) => {
    const resourcesDir = writeAsar([
      { path: 'LICENSE', content: LICENSE_TEXT },
      { path: 'package.json', content: packageJson(main) },
      { path: MAIN_PATH, content: MAIN_SOURCE },
      { path: 'out/renderer/index.html', content: RENDERER_HTML },
    ]);

    expect(() => verifyAsarIntegrity(resourcesDir)).not.toThrow();
  });

  // `./`-prefixed main fields are ordinary in package.json and electron-builder
  // preserves them verbatim. If the guard did not strip the prefix it would
  // silently skip the main-script check on a large share of real builds while
  // still printing its success line.
  it('still validates the main script when the main field is written with a ./ prefix', () => {
    const resourcesDir = writeAsar([
      { path: 'LICENSE', content: LICENSE_TEXT },
      { path: 'package.json', content: packageJson(`./${MAIN_PATH}`) },
      { path: MAIN_PATH, headerContent: MAIN_SOURCE, content: 'require("./evil");\n' },
      { path: 'out/renderer/index.html', content: RENDERER_HTML },
    ]);

    expect(() => verifyAsarIntegrity(resourcesDir)).toThrow(new RegExp(`${MAIN_PATH}.*header hash`));
  });
});
