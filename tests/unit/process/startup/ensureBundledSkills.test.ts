/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirs: string[] = [];
let configDir = '';
vi.mock('@process/utils/utils', () => ({
  getConfigPath: () => configDir,
}));

import { ensureBundledSkills, listBundledSkills, readSkillName } from '@process/startup/ensureBundledSkills';

const mkTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bundled-skills-'));
  tempDirs.push(dir);
  return dir;
};

const writeSkill = (root: string, relDir: string, name: string): string => {
  const dir = join(root, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill\n---\n\nBody.\n`, 'utf-8');
  return dir;
};

describe('readSkillName / listBundledSkills', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads the frontmatter name', () => {
    const root = mkTemp();
    const dir = writeSkill(root, 'token-optimizer', 'token-optimizer');
    expect(readSkillName(join(dir, 'SKILL.md'))).toBe('token-optimizer');
  });

  it('returns null for a missing or malformed file', () => {
    const root = mkTemp();
    writeFileSync(join(root, 'SKILL.md'), 'no frontmatter here', 'utf-8');
    expect(readSkillName(join(root, 'SKILL.md'))).toBeNull();
    expect(readSkillName(join(root, 'nope.md'))).toBeNull();
  });

  it('finds skills at any nesting depth without descending into skill folders', () => {
    const root = mkTemp();
    writeSkill(root, 'token-optimizer', 'token-optimizer');
    writeSkill(root, 'mattpocock/engineering/tdd', 'tdd');
    writeSkill(root, 'mattpocock/productivity/teach', 'teach');
    const names = listBundledSkills(root)
      .map((s) => s.name)
      .toSorted();
    expect(names).toEqual(['tdd', 'teach', 'token-optimizer']);
  });
});

describe('ensureBundledSkills', () => {
  let bundleRoot = '';
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const fetchCalls: Array<{ url: string; body?: unknown }> = [];

  beforeEach(() => {
    configDir = mkTemp();
    bundleRoot = mkTemp();
    mkdirSync(join(bundleRoot, 'resources', 'bundled-skills'), { recursive: true });
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(bundleRoot);
    fetchCalls.length = 0;
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const stubBackend = (existingSkills: Array<{ name: string }>, importOk = true): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (String(url).endsWith('/api/skills')) {
          return new Response(JSON.stringify({ success: true, data: existingSkills }), { status: 200 });
        }
        if (String(url).endsWith('/api/skills/import')) {
          return importOk
            ? new Response(JSON.stringify({ success: true, data: { skill_name: 'x' } }), { status: 200 })
            : new Response('nope', { status: 500 });
        }
        return new Response('not found', { status: 404 });
      })
    );
  };

  it('imports bundled skills missing from the backend and records them', async () => {
    writeSkill(bundleRoot, 'resources/bundled-skills/token-optimizer', 'token-optimizer');
    stubBackend([{ name: 'pdf' }]);

    await ensureBundledSkills(12345);

    const importCalls = fetchCalls.filter((c) => c.url.endsWith('/api/skills/import'));
    expect(importCalls).toHaveLength(1);
    expect((importCalls[0].body as { skill_path: string }).skill_path).toContain('token-optimizer');
    const marker = JSON.parse(readFileSync(join(configDir, 'pavii-bundled-skills.json'), 'utf-8'));
    expect(marker.imported).toContain('token-optimizer');
  });

  it('never re-imports a skill recorded in the marker (deletion stays respected)', async () => {
    writeSkill(bundleRoot, 'resources/bundled-skills/token-optimizer', 'token-optimizer');
    writeFileSync(
      join(configDir, 'pavii-bundled-skills.json'),
      JSON.stringify({ imported: ['token-optimizer'] }),
      'utf-8'
    );
    stubBackend([]);

    await ensureBundledSkills(12345);

    expect(fetchCalls.filter((c) => c.url.endsWith('/api/skills/import'))).toHaveLength(0);
  });

  it('records without importing when the skill already exists on the backend', async () => {
    writeSkill(bundleRoot, 'resources/bundled-skills/token-optimizer', 'token-optimizer');
    stubBackend([{ name: 'token-optimizer' }]);

    await ensureBundledSkills(12345);

    expect(fetchCalls.filter((c) => c.url.endsWith('/api/skills/import'))).toHaveLength(0);
    const marker = JSON.parse(readFileSync(join(configDir, 'pavii-bundled-skills.json'), 'utf-8'));
    expect(marker.imported).toContain('token-optimizer');
  });

  it('leaves the marker untouched on import failure so the next boot retries', async () => {
    writeSkill(bundleRoot, 'resources/bundled-skills/token-optimizer', 'token-optimizer');
    stubBackend([], false);

    await ensureBundledSkills(12345);

    expect(existsSync(join(configDir, 'pavii-bundled-skills.json'))).toBe(false);
  });

  it('does nothing when no bundled-skills directory exists', async () => {
    rmSync(join(bundleRoot, 'resources', 'bundled-skills'), { recursive: true, force: true });
    stubBackend([]);

    await ensureBundledSkills(12345);

    expect(fetchCalls).toHaveLength(0);
  });
});
