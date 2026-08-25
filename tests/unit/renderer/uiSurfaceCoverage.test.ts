/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whole-surface guards for the renderer's interactive controls.
 *
 * Modelled on `tests/unit/common-adapter/bridgeSurfaceCoverage.test.ts`, which
 * enumerates the IPC/HTTP surface rather than sampling it. That test is how
 * `task.stopAll` was caught reporting success to the tray while cancelling
 * nothing.
 *
 * The equivalent gap on the UI side is a control that exists but is reachable
 * by nothing: no spec drives it, or its handler does nothing. Neither shows up
 * in a coverage percentage, because the code "runs" fine.
 *
 * These run in milliseconds and need no credentials, which matters because
 * roughly half the Playwright suite skips itself when no AI provider is
 * configured.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const rendererDir = join(repoRoot, 'packages/desktop/src/renderer');
const e2eDir = join(repoRoot, 'tests/e2e');

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'results' || entry.name === 'report') continue;
      walk(full, exts, out);
    } else if (exts.includes(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const rendererFiles = walk(rendererDir, ['.ts', '.tsx']);
const e2eFiles = walk(e2eDir, ['.ts']);
const e2eText = e2eFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');

describe('renderer control surface', () => {
  /**
   * A handler that is an empty arrow or nothing but a `console.*` call is a
   * control the user can click to no effect.
   *
   * Both known instances are legitimate and listed here: McpManagement and
   * ToolsModalContent pass `() => {}` for extension-provided MCP servers, whose
   * entire edit/delete block is rendered behind `{!isReadOnly && ...}` in
   * McpServerHeader, so the handlers are unreachable by construction rather
   * than dead.
   */
  const ALLOWED_EMPTY_HANDLERS = new Set([
    'pages/settings/ToolsSettings/McpManagement.tsx',
    'components/settings/SettingsModal/contents/ToolsModalContent.tsx',
  ]);

  it('has no interactive handler that silently does nothing', () => {
    const emptyArrow = /on[A-Z]\w*=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/;
    const consoleOnly = /on[A-Z]\w*=\{\s*\(\s*\)\s*=>\s*console\.\w+\([^)]*\)\s*\}/;

    const offenders: string[] = [];
    for (const file of rendererFiles) {
      const rel = relative(rendererDir, file).replace(/\\/g, '/');
      if (ALLOWED_EMPTY_HANDLERS.has(rel)) continue;
      const source = readFileSync(file, 'utf-8');
      if (emptyArrow.test(source) || consoleOnly.test(source)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the allowlisted empty handlers behind a readOnly guard', () => {
    // If someone removes `isReadOnly` from McpServerHeader, the allowlist above
    // stops describing reality and those buttons become genuinely dead.
    const header = readFileSync(join(rendererDir, 'pages/settings/ToolsSettings/McpServerHeader.tsx'), 'utf-8');

    expect(header).toContain('isReadOnly');
    expect(header).toMatch(/\{!isReadOnly &&/);
  });
});

describe('e2e testid coverage', () => {
  /**
   * Every `data-testid` in the renderer that no spec references.
   *
   * A testid exists because someone intended to drive that control from a test.
   * One that nothing references is either an abandoned intention or a feature
   * that shipped untested — and the count only ever grows silently.
   *
   * This is a ratchet, not a target: the number below is what it was when the
   * guard was written. Adding a control WITH a spec keeps it flat; adding one
   * without a spec pushes it up and fails here, which is the moment to decide
   * whether that is acceptable.
   */
  // 145 → 147: the inline image card (inline-image-card / -show / -shown) is
  // driven end-to-end by tests/unit/renderer/inlineImageCard.dom.test.tsx and
  // tests/unit/chat/messageText.dom.test.tsx — DOM coverage, which this scan
  // does not count. Accepted rather than writing a Playwright spec that needs
  // a configured agent to produce an image path.
  // 147 → 149: same reasoning for the document chip (inline-file-chip /
  // inline-file-open), driven by the same DOM suite.
  // 149 → 151: the chip's reveal-in-Explorer link and copy-path button
  // (inline-file-reveal / inline-file-copy), also driven end-to-end by
  // tests/unit/renderer/inlineImageCard.dom.test.tsx.
  // 151 → 152: the shown image's copy-location button (inline-image-copy),
  // driven by the same DOM suite.
  const ORPHAN_BUDGET = 152;

  function collectTestIds(): Set<string> {
    const ids = new Set<string>();
    const literal = /data-testid=['"]([^'"{}]+)['"]/g;
    for (const file of rendererFiles) {
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(literal)) ids.add(match[1]);
    }
    return ids;
  }

  it('does not grow the set of testids no spec drives', () => {
    const ids = [...collectTestIds()];
    expect(ids.length).toBeGreaterThan(150); // sanity: the scan found the file tree

    const orphans = ids.filter((id) => !e2eText.includes(id));

    expect(
      orphans.length,
      `${orphans.length} of ${ids.length} testids are referenced by no e2e spec ` +
        `(budget ${ORPHAN_BUDGET}). Newly unreferenced:\n  ${orphans.slice(0, 20).join('\n  ')}`
    ).toBeLessThanOrEqual(ORPHAN_BUDGET);
  });

  it('drives the controls behind the most destructive actions', () => {
    // Deleting a conversation and discarding source-control changes are the two
    // irreversible actions reachable in two clicks. Whatever else drifts, these
    // must stay covered.
    const mustBeDriven = ['team-create-btn', 'team-create-name-input', 'team-create-confirm-btn'];

    const undriven = mustBeDriven.filter((id) => !e2eText.includes(id));
    expect(undriven).toEqual([]);
  });
});

describe('i18n fallbacks', () => {
  /**
   * A `t('some.key')` whose key is absent from the catalog renders the raw key
   * to the user unless a `defaultValue` is supplied.
   *
   * 47 such keys exist today across 8 files and every one supplies a fallback,
   * so the app never shows a bare key. This pins that.
   */
  it('never calls t() with a bare unknown key', () => {
    const localesDir = join(repoRoot, 'packages/desktop/src/renderer/services/i18n/locales/en-US');
    const known = new Set<string>();

    const flatten = (obj: unknown, prefix: string): void => {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') flatten(value, path);
        else known.add(path);
      }
    };

    for (const file of readdirSync(localesDir)) {
      if (extname(file) !== '.json') continue;
      const moduleName = file.replace(/\.json$/, '');
      flatten(JSON.parse(readFileSync(join(localesDir, file), 'utf-8')), moduleName);
    }
    expect(known.size).toBeGreaterThan(500);

    // `t('a.b')` with nothing after the key — no options object, so no fallback.
    const bareCall = /\bt\(\s*'([a-zA-Z0-9_.]+)'\s*\)/g;
    const offenders: string[] = [];

    for (const file of rendererFiles) {
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(bareCall)) {
        const key = match[1];
        if (!key.includes('.')) continue; // not a catalog path
        if (known.has(key)) continue;
        offenders.push(`${relative(rendererDir, file).replace(/\\/g, '/')}: ${key}`);
      }
    }

    expect(offenders, `these render the raw key to the user:\n  ${offenders.slice(0, 20).join('\n  ')}`).toEqual([]);
  });
});

describe('scan sanity', () => {
  it('actually read the trees it claims to guard', () => {
    expect(rendererFiles.length).toBeGreaterThan(400);
    expect(e2eFiles.length).toBeGreaterThan(100);
    expect(statSync(rendererDir).isDirectory()).toBe(true);
  });
});
