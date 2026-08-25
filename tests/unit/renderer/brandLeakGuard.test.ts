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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  it('keeps the engine-bundled assets an agent can quote free of the old brand', () => {
    // Agents read these files and repeat them verbatim to the user — this is
    // where a mandatory "Powered by @aionui" tweet template and "I use
    // officecli" self-introductions hid through two rebrand passes.
    const assetsRoots = [
      resolve(__dirname, '../../../the-remaa/AionCore/crates/aionui-app/assets'),
      resolve(__dirname, '../../../the-remaa/AionCore/crates/aionui-ai-agent/assets'),
    ];
    // Known-internal forms that may legitimately appear in assets.
    const allowed = [
      /AIONUI_(?:[A-Z_]+|\.\.\.)/g, // env var contract names (incl. `AIONUI_...` in prose)
      /~\/\.aionui[\w/.-]*/g, // real data-dir paths
      /aionui-assistant\.[\w.{}-]+/g, // rule/avatar filename contract (incl. {locale})
      /avatars\/aionui-assistant\.\w+/g, // avatar asset path contract
      /\baionrs\b/g, // agent-type wire token, display-mapped downstream
      /\.aionui\b/g, // dotfile/dir names
      // The identity rule must NAME the forbidden brands to forbid them.
      /Never describe yourself as AionUi, AionCore/g,
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(md|json|txt|yaml|yml)$/.test(entry.name)) {
          let text = readFileSync(full, 'utf-8');
          for (const pattern of allowed) text = text.replace(pattern, '');
          if (/aion/i.test(text)) {
            const line = text.split('\n').find((l) => /aion/i.test(l)) ?? '';
            offenders.push(`${full.slice(full.indexOf('assets'))}: ${line.trim().slice(0, 90)}`);
          }
        }
      }
    };
    for (const root of assetsRoots) walk(root);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('keeps the installer message strings on the new brand', () => {
    // resources/messages.yml sat dead-but-branded for the whole rebrand; a
    // packaging change away from shipping "AionUi could not finish closing…".
    const resourcesDir = resolve(__dirname, '../../../resources');
    // messages.yml was a decoy: never read (electron-builder resolves that
    // filename against its own templates dir), but sitting in buildResources
    // under the exact name that WOULD be honoured if resolution ever changed,
    // pre-loaded with the pre-rebrand English and Chinese text. Deleted; must
    // stay deleted.
    expect(existsSync(join(resourcesDir, 'messages.yml'))).toBe(false);
    const winDir = join(resourcesDir, 'windows');
    for (const file of readdirSync(winDir).filter((f) => f.endsWith('.nsh'))) {
      const text = readFileSync(join(winDir, file), 'utf-8');
      // Internal identifiers: AIONUI_* macros, $AionUi* NSIS variables, and
      // the bundled reporter script's filename. User-visible text only.
      const stripped = text
        .replace(/AIONUI_[A-Z_]+/g, '')
        // NSIS variable identifiers are AionUi + UpperCamel (AionUiStopResult,
        // $AionUiSessionLogPath…). Prose is never "AionUi" glued to an
        // uppercase letter, so this strips identifiers and only identifiers.
        .replace(/\$?AionUi[A-Z]\w*/g, '')
        .replace(/aionui-report-installer-failure\.ps1/g, '');
      expect(stripped, file).not.toMatch(/Aion[Uu]i/);
    }
  });

  it('keeps the broken weixin-file-send skill retired', async () => {
    // It instructed agents to emit [AIONUI_CHANNEL_SEND] blocks nothing
    // consumes — the raw tag rendered in the user's WeChat and the skill
    // authorized claiming a send that never happened.
    const { brandSkills } = await import('@/common/utils/skillBranding');
    const rows = brandSkills([
      { name: 'weixin-file-send', description: 'x', source: 'builtin' },
      { name: 'pavii-config', description: 'y', source: 'builtin' },
    ]);
    expect(rows.map((row) => row.name)).toEqual(['pavii-config']);
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
