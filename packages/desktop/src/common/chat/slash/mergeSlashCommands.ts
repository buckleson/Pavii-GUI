/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommandItem } from './types';

/**
 * Builds slash command items for the skills loaded into the current
 * conversation. Skills are inserted as `/name ` templates (never executed
 * immediately) so the user can add arguments before sending.
 *
 * @param loadedSkills - Skill names mounted on the conversation (snapshot).
 * @param descriptionByName - Optional map from skill name to a human-readable
 *   description (from the global skills index). Names missing here fall back to
 *   `fallbackDescription`.
 * @param fallbackDescription - Shown when a skill has no indexed description.
 */
export function buildSkillSlashCommands(
  loadedSkills: readonly string[] | undefined,
  descriptionByName: ReadonlyMap<string, string>,
  fallbackDescription: string
): SlashCommandItem[] {
  if (!loadedSkills || loadedSkills.length === 0) {
    return [];
  }
  return loadedSkills.map((name) => ({
    name,
    description: descriptionByName.get(name) ?? fallbackDescription,
    kind: 'template',
    source: 'skill',
    selectionBehavior: 'insert',
  }));
}

/**
 * Merges the slash command groups into a single de-duplicated list. Earlier
 * groups win on name collisions, so the intended priority is:
 * builtin > ACP agent commands > session skills.
 */
export function mergeSlashCommands(
  builtin: readonly SlashCommandItem[],
  acp: readonly SlashCommandItem[],
  skills: readonly SlashCommandItem[]
): SlashCommandItem[] {
  const map = new Map<string, SlashCommandItem>();
  for (const group of [builtin, acp, skills]) {
    for (const command of group) {
      if (!map.has(command.name)) {
        map.set(command.name, command);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Display order for the merged list: the agent's own commands first, then
 * Pavii builtins, then skills.
 *
 * Deliberately separate from `mergeSlashCommands`, which resolves NAME
 * COLLISIONS in the opposite direction (builtin wins, so a skill cannot shadow
 * `/copy`). Conflating the two would mean either the wrong command runs or the
 * list is ordered wrongly; they are different questions.
 *
 * Stable within each group, so the agent's own ordering is preserved.
 */
export function orderSlashCommandsForDisplay(commands: readonly SlashCommandItem[]): SlashCommandItem[] {
  const rank = (command: SlashCommandItem): number => {
    if (command.source === 'acp') return 0;
    if (command.source === 'builtin') return 1;
    return 2;
  };
  return commands
    .map((command, index) => ({ command, index }))
    .sort((a, b) => rank(a.command) - rank(b.command) || a.index - b.index)
    .map((entry) => entry.command);
}
