/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED_SKILL_NAMES } from '@/common/utils/bundledSkillNames';
import {
  SKILL_CATEGORY_IDS,
  SKILL_CATEGORY_LABELS,
  groupSkillsByCategory,
  skillCategory,
} from '@/renderer/pages/settings/SkillsSettings/skillCategories';

const BUILTIN_ROOT = join(process.cwd(), 'the-remaa', 'AionCore', 'crates', 'aionui-app', 'assets', 'builtin-skills');

/** Built-in skill folders that show in the categorised Official list (auto-inject renders flat). */
const builtinSkillFolders = (): string[] =>
  readdirSync(BUILTIN_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'auto-inject')
    .map((entry) => entry.name);

describe('skillCategory', () => {
  it('assigns every shipped built-in skill a category other than "other"', () => {
    const unmapped = builtinSkillFolders().filter((name) => skillCategory(name) === 'other');
    expect(unmapped).toEqual([]);
  });

  it('assigns every bundled pack skill a category other than "other"', () => {
    const unmapped = [...BUNDLED_SKILL_NAMES].filter((name) => skillCategory(name) === 'other');
    expect(unmapped).toEqual([]);
  });

  it('falls back to "other" for an unrecognised skill name', () => {
    expect(skillCategory('some-user-import')).toBe('other');
    expect(skillCategory('')).toBe('other');
  });

  it('labels every category id', () => {
    for (const id of SKILL_CATEGORY_IDS) {
      expect(SKILL_CATEGORY_LABELS[id].key).toMatch(/^settings\.skillsHub\.category/);
      expect(SKILL_CATEGORY_LABELS[id].defaultValue.length).toBeGreaterThan(0);
    }
  });
});

describe('groupSkillsByCategory', () => {
  it('returns nothing for an empty list', () => {
    expect(groupSkillsByCategory([])).toEqual([]);
  });

  it('drops empty categories and keeps the declared category order', () => {
    const groups = groupSkillsByCategory([{ name: 'mystery-skill' }, { name: 'tdd' }, { name: 'pdf' }]);
    expect(groups.map((g) => g.id)).toEqual(['documents', 'development', 'other']);
  });

  it('preserves the caller order within a category', () => {
    const groups = groupSkillsByCategory([{ name: 'tdd' }, { name: 'code-review' }, { name: 'triage' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].skills.map((s) => s.name)).toEqual(['tdd', 'code-review', 'triage']);
  });

  it('puts every unrecognised skill in a single "other" group', () => {
    const groups = groupSkillsByCategory([{ name: 'aaa' }, { name: 'bbb' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('other');
    expect(groups[0].skills).toHaveLength(2);
  });
});
