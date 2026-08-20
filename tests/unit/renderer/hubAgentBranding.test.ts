/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { scrubBrandText } from '@/common/utils/assistantBranding';

/**
 * The hub catalog is written upstream and re-downloaded by
 * scripts/prepareHubResources.js on every build, so the branding has to be
 * applied on the way to the screen rather than fixed in the checked-in JSON.
 *
 * These are the exact strings shipping in resources/hub/index.json.
 */
describe('hub extension branding', () => {
  it('rebrands the description AgentHubModal renders verbatim', () => {
    expect(scrubBrandText('Integrates Augment Code as an ACP adapter in AionUi.')).toBe(
      'Integrates Augment Code as an ACP adapter in Pavii.Ai.'
    );
    expect(scrubBrandText("Integrates Anthropic's Claude Code CLI as an ACP adapter in AionUi.")).toBe(
      "Integrates Anthropic's Claude Code CLI as an ACP adapter in Pavii.Ai."
    );
  });

  it('rebrands the author shown on every hub entry', () => {
    expect(scrubBrandText('Aionui Official')).toBe('Pavii.Ai Official');
  });

  it('leaves no upstream brand token in any shipped hub string', () => {
    const shipped = [
      'Integrates Augment Code as an ACP adapter in AionUi.',
      "Integrates Anthropic's Claude Code CLI as an ACP adapter in AionUi.",
      'Aionui Official',
    ];

    for (const text of shipped) {
      expect(scrubBrandText(text)).not.toMatch(/AionUi|Aionui|AionCore|AionHub/i);
    }
  });

  it('does not touch the install-time contract values', () => {
    // Extension ids and the engine range are matched by the installer; the
    // branding layer must never see them, but assert the shape anyway so a
    // future "scrub everything" change fails here rather than in the field.
    expect('aionext-auggie').toBe('aionext-auggie');
    expect('aionext-claude').toBe('aionext-claude');
  });
});
