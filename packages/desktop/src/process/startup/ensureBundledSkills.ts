/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigPath } from '@process/utils/utils';

/**
 * Auto-import the Pavii-curated skill pack shipped under
 * `resources/bundled-skills` (Token Optimizer + the mattpocock collection)
 * into the user's skills library via the backend import endpoint.
 *
 * Each skill is imported at most once per install: names recorded in the
 * marker file are never retried, so a user who deletes a bundled skill stays
 * rid of it on later boots.
 */

const MARKER_FILE = 'pavii-bundled-skills.json';

type ImportMarker = { imported: string[] };

/** Resolve the bundled-skills directory: packaged resources first, repo layout in dev. */
export function resolveBundledSkillsDir(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'bundled-skills');
    if (existsSync(packaged)) return packaged;
  }
  const repoLocal = join(process.cwd(), 'resources', 'bundled-skills');
  if (existsSync(repoLocal)) return repoLocal;
  return null;
}

/** Walk the bundle for directories that contain a SKILL.md, keyed by frontmatter name. */
export function listBundledSkills(rootDir: string): Array<{ name: string; path: string }> {
  const found: Array<{ name: string; path: string }> = [];
  const walk = (dir: string): void => {
    const skillFile = join(dir, 'SKILL.md');
    if (existsSync(skillFile)) {
      const name = readSkillName(skillFile);
      if (name) found.push({ name, path: dir });
      return; // skill folders do not nest further skills
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  walk(rootDir);
  return found;
}

/** Extract the `name:` field from SKILL.md frontmatter. */
export function readSkillName(skillFilePath: string): string | null {
  try {
    const head = readFileSync(skillFilePath, 'utf-8').slice(0, 2048);
    const match = head.match(/^---[\s\S]*?^name:\s*(\S+)\s*$/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function readMarker(markerPath: string): ImportMarker {
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf-8')) as ImportMarker;
    return { imported: Array.isArray(parsed.imported) ? parsed.imported : [] };
  } catch {
    return { imported: [] };
  }
}

async function backendJson<T>(port: number, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { success?: boolean; data?: T } | T;
    if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
      return (body as { data?: T }).data ?? null;
    }
    return body as T;
  } catch {
    return null;
  }
}

/** Import bundled skills that were never imported on this install. Best-effort. */
export async function ensureBundledSkills(backendPort: number): Promise<void> {
  const bundleDir = resolveBundledSkillsDir();
  if (!bundleDir) return;

  const markerPath = join(getConfigPath(), MARKER_FILE);
  const marker = readMarker(markerPath);
  const alreadyImported = new Set(marker.imported);

  const existing = await backendJson<Array<{ name: string }>>(backendPort, '/api/skills');
  const existingNames = new Set((existing ?? []).map((skill) => skill.name));

  let changed = false;
  for (const skill of listBundledSkills(bundleDir)) {
    if (alreadyImported.has(skill.name)) continue;
    if (existingNames.has(skill.name)) {
      // Present already (e.g. imported manually): record it so we never retry.
      marker.imported.push(skill.name);
      changed = true;
      continue;
    }
    const result = await backendJson<{ skill_name?: string }>(backendPort, '/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({ skill_path: skill.path }),
    });
    if (result) {
      marker.imported.push(skill.name);
      changed = true;
    } else {
      console.warn(`[BundledSkills] import failed for ${skill.name}; will retry next boot`);
    }
  }

  if (changed) {
    try {
      writeFileSync(markerPath, JSON.stringify({ imported: marker.imported }, null, 2), 'utf-8');
    } catch (error) {
      console.warn('[BundledSkills] failed to persist import marker:', error);
    }
  }
}
