/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';

/**
 * Team collaboration view mode: a team-wide property remembered per team in localStorage.
 * - parallel: every member column side by side (the default).
 * - single: the selected member fills the screen.
 * - board: a read-only messages-and-tasks board.
 */
export type TeamViewMode = 'parallel' | 'single' | 'board';

const storageKey = (team_id: string): string => `team-view-mode-${team_id}`;

const readViewMode = (team_id: string): TeamViewMode => {
  try {
    const stored = localStorage.getItem(storageKey(team_id));
    if (stored === 'single') return 'single';
    if (stored === 'board' || stored === 'flow') return 'board'; // migrate legacy 'flow'
    return 'parallel';
  } catch {
    return 'parallel';
  }
};

export function useTeamViewMode(team_id: string): [TeamViewMode, (mode: TeamViewMode) => void] {
  const [viewMode, setViewModeState] = useState<TeamViewMode>(() => readViewMode(team_id));

  const setViewMode = useCallback(
    (mode: TeamViewMode) => {
      setViewModeState(mode);
      try {
        localStorage.setItem(storageKey(team_id), mode);
      } catch {
        // storage unavailable - the view still applies in memory
      }
    },
    [team_id]
  );

  return [viewMode, setViewMode];
}
