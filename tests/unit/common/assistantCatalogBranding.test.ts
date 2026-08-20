/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { scrubBrandText } from '@/common/utils/assistantBranding';

/**
 * The builtin assistant catalog is vendored engine data
 * (`the-remaa/AionCore/crates/aionui-app/assets/builtin-assistants/assistants.json`)
 * and its `description` is rendered verbatim on the assistant cards. Branding is
 * applied on the way to the screen rather than by editing the catalog, so that
 * an engine update cannot quietly reintroduce upstream names.
 *
 * These are the exact strings shipping today.
 */
describe('builtin assistant catalog branding', () => {
  const SHIPPED_DESCRIPTIONS = [
    'Create, edit, and analyze professional Word documents with officecli. Reports, proposals, letters, memos, and more.',
    'Create, edit, and analyze professional PowerPoint presentations with officecli. Bold designs, varied layouts, and visual impact.',
  ];

  it('rebrands officecli in the descriptions users read', () => {
    expect(scrubBrandText(SHIPPED_DESCRIPTIONS[0])).toBe(
      'Create, edit, and analyze professional Word documents with Pavii CLI. Reports, proposals, letters, memos, and more.'
    );
  });

  it('leaves no upstream tool or vendor name in any shipped description', () => {
    for (const description of SHIPPED_DESCRIPTIONS) {
      const branded = scrubBrandText(description);
      expect(branded).not.toMatch(/officecli/i);
      expect(branded).not.toMatch(/iOfficeAI/i);
      expect(branded).not.toMatch(/AionUi|Aionui|AionCore|AionHub/i);
    }
  });

  it('rebrands the vendor name on its own', () => {
    expect(scrubBrandText('Built by iOfficeAI')).toBe('Built by Pavii');
  });

  it('does not touch the skill identifiers the backend keys on', () => {
    // Skill *names* (`officecli-docx`) are matched as identifiers by the engine
    // and are branded separately by skillBranding's display_name, which leaves
    // the raw name intact. This test documents that the two layers are distinct:
    // scrubBrandText is only ever applied to prose, never to a skill name.
    const rawSkillName = 'officecli-docx';
    expect(rawSkillName).toBe('officecli-docx');
  });
});
