/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill names offered in the composer's slash menu.
 *
 * Previously the menu listed only `conversationContext.loadedSkills` — skills
 * already mounted on the conversation — which is usually empty, so the skills
 * half of the menu appeared broken. The useful set is what the conversation's
 * assistant actually has enabled, which is what the user configured on purpose.
 *
 * Auto-inject skills are excluded: they already apply to every turn, so
 * offering them as commands is noise that pushes real choices off screen.
 * Skills already loaded into the conversation stay listed regardless, because
 * they are live in this session.
 */

import useSWR from 'swr';
import { useMemo } from 'react';
import { ipcBridge } from '@/common';
import type { AssistantDetail } from '@/common/types/agent/assistantTypes';

export type AssistantSlashSkills = {
  /** Skill names to offer, in a stable order. */
  names: string[];
  /** Description per skill name, for the menu's secondary line. */
  descriptionByName: ReadonlyMap<string, string>;
};

/**
 * Resolve the skills an assistant makes available.
 *
 * Reads `capabilities.default_*`, matching how the assistant editor derives the
 * same set (`useAssistantEditor.ts:270-272`) — `preferences.last_*` is a
 * different concept (the previous session's picks) and using it here would make
 * the menu disagree with what Settings shows.
 *
 * Subtraction runs last so a name appearing in both lists is treated as
 * disabled: the explicit "off" switch has to win, or turning a builtin off in
 * Settings would silently do nothing here.
 */
export function resolveAssistantSkillNames(
  assistant: Pick<AssistantDetail, 'capabilities'> | undefined,
  loadedSkills: readonly string[] | undefined
): string[] {
  const capabilities = assistant?.capabilities;
  const disabled = new Set(capabilities?.default_disabled_builtin_skill_ids ?? []);
  const names = new Set<string>();

  for (const name of capabilities?.default_skill_ids ?? []) {
    if (!disabled.has(name)) names.add(name);
  }
  for (const name of capabilities?.custom_skill_names ?? []) {
    if (!disabled.has(name)) names.add(name);
  }
  // Already mounted on this conversation: live right now, so it stays offered
  // even if the assistant config changed underneath the session.
  for (const name of loadedSkills ?? []) {
    names.add(name);
  }

  return Array.from(names);
}

/**
 * Slash-menu skills for the current conversation.
 *
 * Both fetches use shared SWR keys, so mounting a composer costs no extra
 * request: `skills-index` is already used elsewhere in the renderer, and the
 * assistant is keyed by id.
 */
export function useAssistantSlashSkills(
  assistantId: string | undefined,
  loadedSkills: readonly string[] | undefined
): AssistantSlashSkills {
  const { data: assistant } = useSWR(assistantId ? ['assistant-slash-skills', assistantId] : null, () =>
    ipcBridge.assistants.get.invoke({ id: assistantId as string })
  );

  const hasCandidates = Boolean(assistantId) || (loadedSkills?.length ?? 0) > 0;
  const { data: skillIndex } = useSWR(hasCandidates ? 'skills-index' : null, () =>
    ipcBridge.fs.listAvailableSkills.invoke()
  );

  return useMemo(() => {
    const candidates = resolveAssistantSkillNames(assistant, loadedSkills);
    if (candidates.length === 0) {
      return { names: [], descriptionByName: new Map<string, string>() };
    }

    // Index still loading: show the candidates rather than an empty menu that
    // fills in a moment later. Once it has loaded, an entry it does not know is
    // an id with no matching skill and is dropped.
    const indexLoaded = skillIndex !== undefined;
    const byName = new Map((skillIndex ?? []).map((entry) => [entry.name, entry]));
    const loaded = new Set(loadedSkills ?? []);

    const names = candidates.filter((name) => {
      const entry = byName.get(name);
      if (!entry) return !indexLoaded || loaded.has(name);
      // Auto-inject skills apply to every turn already — unless this session
      // explicitly loaded it, in which case the user is working with it.
      return !entry.is_auto_inject || loaded.has(name);
    });

    const descriptionByName = new Map<string, string>();
    for (const name of names) {
      const description = byName.get(name)?.description;
      if (description) descriptionByName.set(name, description);
    }

    return { names, descriptionByName };
  }, [assistant, loadedSkills, skillIndex]);
}
