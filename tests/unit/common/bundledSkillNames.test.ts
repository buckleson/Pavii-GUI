/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED_SKILL_NAMES } from '@/common/utils/bundledSkillNames';

const BUNDLE_ROOT = join(process.cwd(), 'resources', 'bundled-skills');

const namesOnDisk = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    const skillFile = join(dir, 'SKILL.md');
    if (existsSync(skillFile)) {
      const match = readFileSync(skillFile, 'utf-8')
        .slice(0, 2048)
        .match(/^name:\s*(\S+)\s*$/m);
      if (match) found.push(match[1]);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  walk(BUNDLE_ROOT);
  return found;
};

describe('BUNDLED_SKILL_NAMES', () => {
  it('matches the SKILL.md frontmatter names shipped in resources/bundled-skills', () => {
    const disk = namesOnDisk().toSorted();
    expect(disk).toEqual([...BUNDLED_SKILL_NAMES].toSorted());
  });
});
