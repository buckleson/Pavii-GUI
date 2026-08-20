/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Team member identity colours - frontend only, used solely by the team detail page.
 *
 * Purpose: when members run in parallel and one assistant can be added several times (separate
 * member instances), a low-saturation palette shows at a glance which instance a pill, bubble or column belongs to.
 *
 * The source of truth is a `slot_id -> colour index` map at member-instance level, maintained incrementally:
 * - The leader is always index 0 (the brand colour).
 * - An already-assigned member keeps its index; adding, removing or reordering others never changes it.
 * - A new member takes the lowest unused non-zero index, reusing gaps freed by removed members first.
 * - Beyond the palette size, indices wrap modulo its length (rare, and wrapped entries sit far apart).
 *
 * Colours are never persisted server-side, only in localStorage (see useTeamMemberColors).
 */

/** Identity palette: low-saturation colours near the brand slate. Index 0 is reserved for the leader. */
export const TEAM_MEMBER_PALETTE = [
  'var(--brand)', // 0 = Leader
  '#5c9ea4', // Misty teal
  '#b58a5e', // Warm brown
  '#9481bf', // Muted violet
  '#c07d97', // Dusty rose
  '#6ba07e', // Grey green
  '#4f8ac9', // Misty blue
  '#c99a4b', // Amber
] as const;

export const LEADER_COLOR_INDEX = 0;

type MemberLike = { slot_id: string; role: string };

/**
 * Incrementally assign colour indices: given the previous map and the current members, return the new map.
 * Pure and side-effect free, so it unit-tests easily.
 */
export function assignMemberColors(prev: Record<string, number>, assistants: MemberLike[]): Record<string, number> {
  const next: Record<string, number> = {};
  const used = new Set<number>();
  const paletteLen = TEAM_MEMBER_PALETTE.length;

  // 1) The leader is fixed at index 0
  const leader = assistants.find((a) => a.role === 'leader');
  if (leader) {
    next[leader.slot_id] = LEADER_COLOR_INDEX;
    used.add(LEADER_COLOR_INDEX);
  }

  // 2) Already-assigned members keep their index
  for (const a of assistants) {
    if (a.slot_id in next) continue;
    const previous = prev[a.slot_id];
    if (previous !== undefined) {
      next[a.slot_id] = previous;
      used.add(previous);
    }
  }

  // 3) New members take the lowest unused non-zero index; once the palette is full, indices wrap
  let cursor = 1;
  const nextFreeIndex = (): number => {
    // A non-zero gap remains: return the lowest unused index
    if (used.size < paletteLen - 1) {
      let idx = 1;
      while (used.has(idx)) idx++;
      return idx;
    }
    // Palette full: wrap around, skipping 0 which belongs to the leader
    const idx = cursor % paletteLen || 1;
    cursor++;
    return idx;
  };
  for (const a of assistants) {
    if (a.slot_id in next) continue;
    const idx = nextFreeIndex();
    next[a.slot_id] = idx;
    used.add(idx);
  }

  return next;
}

/** CSS colour for a member instance. An unknown slot falls back to the leader colour. */
export function memberColorValue(colorMap: Record<string, number>, slot_id: string | undefined): string {
  const idx = (slot_id && colorMap[slot_id]) ?? LEADER_COLOR_INDEX;
  return TEAM_MEMBER_PALETTE[idx % TEAM_MEMBER_PALETTE.length];
}
