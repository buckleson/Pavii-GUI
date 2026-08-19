/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  needsScroll,
  resolveStackTop,
  resolveViewportHeight,
  tickCenterOffset,
  tickStackHeight,
} from '@/renderer/pages/conversation/Messages/anchorRail/geometry';

const RAIL_SOURCE = path.resolve(
  __dirname,
  '../../../../packages/desktop/src/renderer/pages/conversation/Messages/anchorRail/MessageAnchorRail.tsx'
);

/**
 * The rail used to hide itself until a conversation had two user prompts, which
 * read as the feature being absent on short chats. It now appears from the
 * first prompt, so the geometry has to be sane for a single tick.
 */
describe('anchor rail visibility', () => {
  it('renders from the first prompt rather than the second', () => {
    const source = fs.readFileSync(RAIL_SOURCE, 'utf-8');
    expect(source).toContain('anchors.length === 0');
    expect(source).not.toContain('anchors.length < 2');
  });

  it('gives a single tick a real stack height', () => {
    expect(tickStackHeight(1)).toBeGreaterThan(0);
  });

  it('keeps an empty conversation at zero height', () => {
    expect(tickStackHeight(0)).toBe(0);
  });

  it('places the only tick at a positive offset inside the stack', () => {
    expect(tickCenterOffset(0)).toBeGreaterThan(0);
  });

  it('does not ask a single tick to scroll', () => {
    expect(needsScroll(600, 1)).toBe(false);
  });

  it('keeps a single tick inside the rail', () => {
    const railHeight = 600;
    const stackTop = resolveStackTop(railHeight, 1);
    const viewport = resolveViewportHeight(railHeight, 1);

    expect(stackTop).toBeGreaterThanOrEqual(0);
    expect(viewport).toBeGreaterThan(0);
    expect(stackTop + viewport).toBeLessThanOrEqual(railHeight);
  });

  it('survives a rail too short to lay anything out', () => {
    expect(() => resolveViewportHeight(0, 1)).not.toThrow();
    expect(resolveViewportHeight(0, 1)).toBeGreaterThanOrEqual(0);
  });
});
