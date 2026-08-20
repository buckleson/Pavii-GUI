/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import type { TeamAssistant } from '@/common/types/team/teamTypes';
import { assignMemberColors, memberColorValue } from './teamMemberColors';

const storageKey = (team_id: string): string => `team-member-colors-${team_id}`;

const readColorMap = (key: string): Record<string, number> => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch {
    // ignore malformed value
  }
  return {};
};

const shallowEqual = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
};

export type TeamMemberColorResolver = {
  /** CSS identity colour for one member instance (slot). */
  colorOf: (slot_id: string | undefined) => string;
  /** CSS identity colour for the member behind a conversation; the message side knows only conversation_id. */
  colorOfConversation: (conversation_id: string | undefined) => string;
};

/**
 * Team member identity colours: one `slot_id -> colour index` map per team, maintained
 * incrementally with the member list and persisted to localStorage under `team-member-colors-${team_id}`. Used only by the team detail page and never stored server-side.
 */
export function useTeamMemberColors(team_id: string, assistants: TeamAssistant[]): TeamMemberColorResolver {
  const key = storageKey(team_id);
  const [colorMap, setColorMap] = useState<Record<string, number>>(() => readColorMap(key));

  // Recomputed incrementally as the list changes: new members take a colour, removed members release theirs, existing members keep theirs.
  useEffect(() => {
    setColorMap((prev) => {
      const next = assignMemberColors(prev, assistants);
      if (shallowEqual(prev, next)) return prev;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage full or unavailable - colours still apply in memory, so the persistence failure is ignored
      }
      return next;
    });
  }, [assistants, key]);

  // conversation_id -> slot_id index: messages carry only senderConversationId, so this maps back to the member instance for its colour.
  const conversationToSlot = useMemo(() => {
    const index: Record<string, string> = {};
    for (const a of assistants) {
      if (a.conversation_id) index[a.conversation_id] = a.slot_id;
    }
    return index;
  }, [assistants]);

  return useMemo(
    () => ({
      colorOf: (slot_id) => memberColorValue(colorMap, slot_id),
      colorOfConversation: (conversation_id) => memberColorValue(colorMap, conversationToSlot[conversation_id ?? '']),
    }),
    [colorMap, conversationToSlot]
  );
}
