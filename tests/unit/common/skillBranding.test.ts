/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { applySkillBranding, brandSkillDescription, brandSkills, skillDisplayName } from '@/common/utils/skillBranding';

describe('skillDisplayName', () => {
  it('rebrands the officecli- prefix', () => {
    expect(skillDisplayName('officecli-docx')).toBe('pavii-cli-docx');
    expect(skillDisplayName('officecli-financial-model')).toBe('pavii-cli-financial-model');
  });

  it('rebrands the bare officecli skill name', () => {
    expect(skillDisplayName('officecli')).toBe('pavii-cli');
  });

  it('rebrands the aionui- prefix', () => {
    expect(skillDisplayName('aionui-troubleshooting')).toBe('pavii-troubleshooting');
    expect(skillDisplayName('aionui-webui-setup')).toBe('pavii-webui-setup');
  });

  it('leaves neutral names unchanged', () => {
    expect(skillDisplayName('mermaid')).toBe('mermaid');
    expect(skillDisplayName('pdf')).toBe('pdf');
    expect(skillDisplayName('token-optimizer')).toBe('token-optimizer');
  });
});

describe('brandSkillDescription', () => {
  it('scrubs upstream tool brands from descriptions', () => {
    expect(brandSkillDescription('morph-ppt', 'a scene layer on top of officecli-pptx')).toBe(
      'a scene layer on top of pavii-cli-pptx'
    );
    expect(brandSkillDescription('some-skill', 'Made by OfficeCLI and iOfficeAI')).toBe('Made by Pavii CLI and Pavii');
  });

  it('scrubs upstream Aion brand names via the shared rules', () => {
    expect(brandSkillDescription('aionui-webui-setup', 'Helps configure AionUi WebUI mode')).toBe(
      'Helps configure Pavii.Ai WebUI mode'
    );
    expect(brandSkillDescription('aionui-config', 'edit config via the bundled aioncore config CLI')).toBe(
      'edit config via the bundled Pavii Engine config CLI'
    );
  });

  it('replaces Chinese builtin descriptions with English overrides', () => {
    expect(brandSkillDescription('weixin-file-send', '发给我')).toMatch(/send me the file/);
  });

  it('passes undefined through when there is no override', () => {
    expect(brandSkillDescription('mermaid', undefined)).toBeUndefined();
  });
});

describe('applySkillBranding / brandSkills', () => {
  it('keeps the raw backend name and adds a display_name', () => {
    const row = applySkillBranding({
      name: 'officecli-xlsx',
      description: 'Use for OfficeCLI spreadsheets',
      location: '/skills/officecli-xlsx',
      is_auto_inject: false,
      is_custom: false,
      source: 'builtin' as const,
    });
    expect(row.name).toBe('officecli-xlsx');
    expect(row.display_name).toBe('pavii-cli-xlsx');
    expect(row.description).toBe('Use for Pavii CLI spreadsheets');
    expect(row.location).toBe('/skills/officecli-xlsx');
  });

  it('brands every row of a list', () => {
    const rows = brandSkills([
      { name: 'pavii-webui-public', description: 'Expose AionUi WebUI' },
      { name: 'pdf', description: 'PDF toolkit' },
    ]);
    expect(rows[0].display_name).toBe('pavii-webui-public');
    expect(rows[0].description).toBe('Expose Pavii.Ai WebUI');
    expect(rows[1].display_name).toBe('pdf');
    expect(rows[1].description).toBe('PDF toolkit');
  });

  it('drops the pre-rebrand names so a renamed skill is not listed twice', () => {
    // The engine indexes builtin skills and never prunes vanished folders, so an
    // install that predates the rename still carries the old row while the new
    // one is added alongside it. Both reaching the slash menu would show the
    // user `/aionui-config` AND `/pavii-config`.
    const rows = brandSkills([
      { name: 'aionui-config', description: 'stale', source: 'builtin' },
      { name: 'pavii-config', description: 'current', source: 'builtin' },
      { name: 'officecli', description: 'stale', source: 'builtin' },
      { name: 'pavii-cli', description: 'current', source: 'builtin' },
      { name: 'officecli-xlsx', description: 'stale', source: 'builtin' },
      { name: 'pavii-cli-xlsx', description: 'current', source: 'builtin' },
    ]);
    expect(rows.map((row) => row.name)).toEqual(['pavii-config', 'pavii-cli', 'pavii-cli-xlsx']);
  });

  it('still renders an old name branded if one reaches the UI another way', () => {
    // Filtering only covers the list path; the text rules stay so a stale row
    // arriving through a path that skips `brandSkills` is not shown raw.
    expect(skillDisplayName('aionui-config')).toBe('pavii-config');
    expect(skillDisplayName('officecli-pptx')).toBe('pavii-cli-pptx');
  });

  it('tags bundled custom skills as display_source official', () => {
    const bundled = applySkillBranding({ name: 'token-optimizer', description: 'terse mode', source: 'custom' });
    expect(bundled.display_source).toBe('official');
    const userSkill = applySkillBranding({ name: 'my-own-skill', description: 'mine', source: 'custom' });
    expect(userSkill.display_source).toBeUndefined();
    const builtin = applySkillBranding({ name: 'tdd', description: 'x', source: 'builtin' });
    expect(builtin.display_source).toBeUndefined();
  });

  it('drops removed builtin skills that linger in older installs', () => {
    const rows = brandSkills([
      { name: 'x-recruiter', description: 'gone', source: 'builtin' },
      { name: 'xiaohongshu-recruiter', description: 'gone', source: 'builtin' },
      { name: 'pdf', description: 'kept', source: 'builtin' },
    ]);
    expect(rows.map((row) => row.name)).toEqual(['pdf']);
  });

  it('passes non-array payloads through untouched', () => {
    const notAList = null as unknown as Array<{ name: string; description: string }>;
    expect(brandSkills(notAList)).toBe(notAList);
  });
});
