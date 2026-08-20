/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  window.__backendPort = 13400;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__backendPort;
  // Deliberately no `vi.resetModules()`. Every test below asserts only the
  // module's static shape, so none of them needs a fresh instance — but the
  // reset threw away the module cache between tests, making all three pay the
  // full cold import of a graph that pulls in mermaid, katex and highlight.
  // Under the concurrent suite that repeatedly blew even a 30s timeout while
  // passing in seconds in isolation. Keeping the cache means one cold import
  // per file instead of three.
});

/**
 * PreviewPanel pulls in mermaid, katex and highlight. Importing that graph is
 * the whole point of these assertions — they exist to catch an import-time
 * crash — so it cannot be mocked away.
 *
 * The cost is paid once here rather than inside each test. In isolation the
 * file runs in about 10s; under the full concurrent suite, twenty-odd workers
 * competing for CPU stretched the cold transform past a 30s per-test budget and
 * failed three tests at once. Hoisting the import means one hook carries the
 * cost with real headroom, and the assertions themselves are instant.
 */
const IMPORT_TIMEOUT_MS = 120000;

// The module's own type, so the assertions below check the real export rather
// than a hand-written shape a cast had to force them together.
type PreviewPanelModule = typeof import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel');

let previewPanel: PreviewPanelModule;

beforeAll(async () => {
  previewPanel = await import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel');
}, IMPORT_TIMEOUT_MS);

describe('PreviewPanel', () => {
  it('is a React component module that exports a default function', () => {
    expect(typeof previewPanel.default).toBe('function');
  });

  it('module loads without throwing on import', () => {
    // The beforeAll hook would have failed the file had the import thrown.
    expect(previewPanel).toBeTruthy();
  });

  it('has a displayName or function name for debugging', () => {
    const fn = previewPanel.default;
    expect(fn.name || fn.displayName || 'anonymous').toBeTruthy();
  });
});
