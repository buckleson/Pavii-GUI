/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * prebuild-install retry, and which package the source-build fallback uses.
 *
 * The 2.2.8 windows-arm64 release failed because prebuild-install reported "No
 * prebuilt binaries found" for an asset that was published the whole time — the
 * same run fetched the same Electron ABI for x64 three minutes later. One
 * attempt turned a transient fetch failure into a failed release.
 *
 * It was only fatal because the fallback was broken too, and always had been:
 * `bun x --yes electron-rebuild` fetched the deprecated 3.2.9, whose
 * `lzma-native` dependency builds with node-gyp 9 and imports `distutils`,
 * removed in Python 3.12. The runners have 3.13, so that path could never have
 * succeeded there.
 *
 * These assertions are structural, matching installerDiskGate and
 * installerShortcut: the script shells out to a real toolchain, so exercising it
 * in a unit test would mean running network builds. Executing it is what
 * scripts/smoke-* and CI are for.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const script = readFileSync(resolve(ROOT, 'scripts', 'rebuildNativeModules.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

describe('prebuild-install retry', () => {
  it('retries rather than falling back on the first failure', () => {
    expect(script).toContain('const PREBUILD_MAX_ATTEMPTS = 3');
    expect(script).toContain('attempt <= PREBUILD_MAX_ATTEMPTS');
    // Backoff, so three attempts are not fired into the same outage.
    expect(script).toContain('attempt * PREBUILD_RETRY_BASE_MS');
    expect(script).toContain('sleepSync(delayMs)');
  });

  it('falls back only once the attempts are exhausted', () => {
    expect(script).toContain('prebuild-install failed after ${PREBUILD_MAX_ATTEMPTS} attempts');
  });

  it('still refuses to source-build a Linux cross-compile', () => {
    // Retrying must not have loosened the rule that this arch has no path but prebuilds.
    expect(script).toContain('const mustUsePrebuild =');
    expect(script).toMatch(/if \(mustUsePrebuild\) \{[\s\S]{0,400}return false;/);
  });
});

describe('source-build fallback', () => {
  it('uses the maintained @electron/rebuild, not the deprecated package', () => {
    expect(script).toContain("path.join(projectRoot, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')");
    // The deprecated package must not be invoked anywhere.
    expect(script).not.toMatch(/['"]electron-rebuild['"],/);
    expect(script).not.toMatch(/bun x[^`\n]*electron-rebuild/);
  });

  it('passes the electron version under the flag v4 actually defines', () => {
    // v4 spells it `--version`; the v3 package this replaced used `--electron-version`.
    expect(script).toMatch(/--version \$\{electronVersion\}/);
    expect(script).not.toMatch(/--electron-version \$\{/);
  });

  it('is pinned, so a build cannot pick up a different version', () => {
    const pinned = packageJson.devDependencies['@electron/rebuild'];
    expect(pinned).toBeDefined();
    // Exact, not a range: this is a build-time toolchain, and drift here broke a release.
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('resolves it locally instead of fetching at build time', () => {
    expect(script).toContain('resolveElectronRebuildCli');
    // A missing install must be reported, not silently retried over the network.
    expect(script).toContain('@electron/rebuild is not installed');
  });
});
