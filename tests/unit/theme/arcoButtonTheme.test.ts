/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * The palette bridge shipped broken with no test watching it: arco.css
 * declares its tokens ON `body`, the app's violet bridge on `:root`, and an
 * element's own custom-property declaration beats an inherited one — so every
 * `type='primary'` button rendered Arco blue while the rest of the theme went
 * violet. These pins guard the `inherit` re-open and the explicit fills.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const overrideCss = readFileSync(
  resolve(__dirname, '../../../packages/desktop/src/renderer/styles/arco-override.css'),
  'utf-8'
);

describe('arco button palette bridge', () => {
  it('re-opens inheritance on body for every token arco.css shadows', () => {
    // The block must cover both light (`body`) and dark
    // (`body[arco-theme='dark']`) — arco declares its palette on each.
    const block = overrideCss.match(/body,\s*\nbody\[arco-theme='dark'\]\s*\{([^}]+)\}/);
    expect(block, 'body inheritance block missing from arco-override.css').toBeTruthy();

    for (const token of [
      '--primary-1',
      '--primary-2',
      '--primary-3',
      '--primary-4',
      '--primary-5',
      '--primary-6',
      '--primary-7',
      '--color-text-1',
    ]) {
      expect(block?.[1], `${token} must be re-inherited over arco's body declaration`).toContain(`${token}: inherit;`);
    }
  });

  it('pins the explicit primary/secondary/text fills to the ramp', () => {
    expect(overrideCss).toContain('background-color: rgb(var(--primary-6));');
    expect(overrideCss).toContain('background-color: rgb(var(--primary-5));');
    expect(overrideCss).toContain('color: rgb(var(--primary-6));');
    expect(overrideCss).toMatch(/arco-btn-secondary[^{]*\{\s*background-color: var\(--aou-1\);/);
  });

  it('keeps the once-hardcoded buttons on tokens', () => {
    const guidActionRow = readFileSync(
      resolve(__dirname, '../../../packages/desktop/src/renderer/pages/guid/components/GuidActionRow.tsx'),
      'utf-8'
    );
    // The welcome send button was #000000 in light mode, ignoring the palette.
    expect(guidActionRow).not.toContain("'#000000'");

    const sendboxCss = readFileSync(
      resolve(__dirname, '../../../packages/desktop/src/renderer/components/chat/SendBox/sendbox.css'),
      'utf-8'
    );
    expect(sendboxCss).not.toContain('#d3d4d9');

    const assistantList = readFileSync(
      resolve(
        __dirname,
        '../../../packages/desktop/src/renderer/pages/settings/AssistantSettings/AssistantListPanel.tsx'
      ),
      'utf-8'
    );
    expect(assistantList).not.toContain('--arcoblue-6');
  });
});
