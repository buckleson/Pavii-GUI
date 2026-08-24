/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The OpenCode bundle is what makes a fresh install have a working default
 * agent. These tests pin the parts that are cheap to get wrong and expensive to
 * notice: the runtime-key → npm-package mapping (npm spells Windows
 * `windows`, Node spells it `win32`) and the version pin staying in step with
 * every platform we ship an installer for.
 *
 * The download/extract path itself is network work and is exercised by actually
 * running the script during a build, not here.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prepareOpencode = require('../../../packages/shared-scripts/src/prepare-opencode.js') as {
  OPENCODE_VERSION: string;
  PACKAGE_BY_RUNTIME_KEY: Record<string, string>;
  binaryNameFor: (platform: string) => string;
  bundleDirFor: (projectRoot: string, runtimeKey: string) => string;
  runtimeKeyFor: (platform: string, arch: string) => string;
};

const { OPENCODE_VERSION, PACKAGE_BY_RUNTIME_KEY, binaryNameFor, bundleDirFor, runtimeKeyFor } = prepareOpencode;

/** Every platform/arch the release workflow builds an installer for. */
const SHIPPED_TARGETS: Array<[string, string]> = [
  ['win32', 'x64'],
  ['win32', 'arm64'],
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['linux', 'x64'],
  ['linux', 'arm64'],
];

describe('prepare-opencode', () => {
  it('pins a concrete semver version', () => {
    expect(OPENCODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('maps every shipped installer target to a published npm package', () => {
    const unmapped = SHIPPED_TARGETS.map(([platform, arch]) => runtimeKeyFor(platform, arch)).filter(
      (key) => !PACKAGE_BY_RUNTIME_KEY[key]
    );
    expect(unmapped, `no OpenCode package mapped for: ${unmapped.join(', ')}`).toEqual([]);
  });

  it("translates Node's win32 to npm's windows", () => {
    // The single most likely mapping mistake: these two ecosystems disagree on
    // the platform name, and a wrong package name only fails at build time.
    expect(PACKAGE_BY_RUNTIME_KEY['win32-x64']).toBe('opencode-windows-x64');
    expect(PACKAGE_BY_RUNTIME_KEY['win32-arm64']).toBe('opencode-windows-arm64');
    expect(PACKAGE_BY_RUNTIME_KEY['darwin-arm64']).toBe('opencode-darwin-arm64');
    expect(PACKAGE_BY_RUNTIME_KEY['linux-x64']).toBe('opencode-linux-x64');
  });

  it('names the binary with a .exe suffix only on Windows', () => {
    expect(binaryNameFor('win32')).toBe('opencode.exe');
    expect(binaryNameFor('darwin')).toBe('opencode');
    expect(binaryNameFor('linux')).toBe('opencode');
  });

  it('stages under resources/bundled-opencode/<runtimeKey>', () => {
    // ensureOpencode.ts resolves this exact layout at runtime; if the two drift
    // the binary ships but is never found.
    expect(bundleDirFor(join('/repo'), 'win32-x64')).toBe(join('/repo', 'resources', 'bundled-opencode', 'win32-x64'));
  });

  it('keeps the staged manifest in step with the pinned version', () => {
    // Only meaningful once a bundle has been staged locally; skipped otherwise
    // so the suite stays green on a clean checkout.
    const manifestPath = join(process.cwd(), 'resources', 'bundled-opencode', 'win32-x64', 'manifest.json');
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { version: string; runtimeKey: string };
    expect(manifest.version).toBe(OPENCODE_VERSION);
    expect(manifest.runtimeKey).toBe('win32-x64');
  });
});
