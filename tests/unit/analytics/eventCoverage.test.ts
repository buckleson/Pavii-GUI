/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYTICS_EVENTS } from '@/common/analytics/config';

const SRC = join(process.cwd(), 'packages', 'desktop', 'src');
const CONFIG_FILE = join(SRC, 'common', 'analytics', 'config.ts');

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && statSync(full).isFile()) {
      out.push(full);
    }
  }
  return out;
};

/** Every `ANALYTICS_EVENTS.<key>` reference outside the declaration itself. */
const referencedKeys = (): Set<string> => {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    if (file === CONFIG_FILE) continue;
    const source = readFileSync(file, 'utf-8');
    for (const match of source.matchAll(/ANALYTICS_EVENTS\.([A-Za-z0-9_]+)/g)) {
      found.add(match[1]);
    }
  }
  return found;
};

describe('analytics event coverage', () => {
  /**
   * A declared event with no call site produces an empty chart in PostHog,
   * which reads as "nobody uses this feature" rather than "nobody instrumented
   * it". That is a worse failure than having no chart at all, so the taxonomy
   * is not allowed to run ahead of the wiring.
   */
  it('every declared event has a real call site', () => {
    const referenced = referencedKeys();
    const unwired = Object.keys(ANALYTICS_EVENTS).filter((key) => !referenced.has(key));
    expect(unwired, `declared in ANALYTICS_EVENTS but never captured: ${unwired.join(', ')}`).toEqual([]);
  });

  it('captures nothing that is not declared', () => {
    const declared = new Set(Object.keys(ANALYTICS_EVENTS));
    const undeclared = [...referencedKeys()].filter((key) => !declared.has(key));
    expect(undeclared, `captured but missing from ANALYTICS_EVENTS: ${undeclared.join(', ')}`).toEqual([]);
  });
});
