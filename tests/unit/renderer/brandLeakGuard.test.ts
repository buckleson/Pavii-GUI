/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * The rebrand leaked once where nobody was looking: the engine's codex
 * version-drift notice carried an i18n code the locale never defined, so the
 * raw English fallback — "verified by AionUi" — rendered in chat (reported
 * live 2026-08-26). These guards pin the two halves of that failure.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const localesDir = resolve(__dirname, '../../../packages/desktop/src/renderer/services/i18n/locales/en-US');

/** Every string VALUE in a JSON tree, with its key path for the message. */
function collectValues(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === 'string') {
    out.push([path, node]);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collectValues(value, `${path}.${key}`, out);
  }
}

describe('brand leak guards', () => {
  it('no en-US locale value names the old brand', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(localesDir).filter((f) => f.endsWith('.json'))) {
      const values: Array<[string, string]> = [];
      collectValues(JSON.parse(readFileSync(join(localesDir, file), 'utf-8')), file, values);
      for (const [path, value] of values) {
        if (/Aion/.test(value)) offenders.push(`${path}: ${value.slice(0, 80)}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('defines the drift-notice codes the engine actually emits', () => {
    // The engine sends CLI_VERSION_OLDER / CLI_VERSION_NEWER
    // (cli_version.rs CODE_CLI_VERSION_*). The locale used to define only the
    // retired ANTIGRAVITY_VERSION_* names, so t() missed and the untranslated
    // backend fallback rendered instead.
    const conversation = JSON.parse(readFileSync(join(localesDir, 'conversation.json'), 'utf-8'));
    const codes = conversation.agentTip.codes;

    for (const code of ['CLI_VERSION_OLDER', 'CLI_VERSION_NEWER']) {
      expect(codes[code]?.body, `${code} missing`).toBeTruthy();
      for (const param of ['{{cli}}', '{{reported}}', '{{verified}}']) {
        expect(codes[code].body, `${code} should interpolate ${param}`).toContain(param);
      }
    }
    expect(codes.ANTIGRAVITY_VERSION_OLDER).toBeUndefined();
    expect(codes.ANTIGRAVITY_VERSION_NEWER).toBeUndefined();
  });

  it('keeps the settings drift copy CLI-agnostic', () => {
    // These keys apply to every direct CLI but used to hardcode "agy", so a
    // drifting codex read "The installed agy is newer…".
    const settings = JSON.parse(readFileSync(join(localesDir, 'settings.json'), 'utf-8'));
    const codes = settings.agentManagement.errorCodes;
    for (const key of ['version_drift_older', 'version_drift_newer']) {
      expect(codes[key]).toContain('{{cli}}');
      expect(codes[key]).not.toMatch(/\bagy\b/);
    }
  });
});
