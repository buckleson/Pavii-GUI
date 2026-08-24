/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App-level slash commands, shared by every composer.
 *
 * Agent TUIs advertise commands like `/new` and `/agents` that the CLIs never
 * expose over ACP — they are terminal-UI features, so no agent will ever send
 * them to us. The app answers them itself.
 *
 * This lives in one place because it already went wrong the other way: the
 * commands were registered in the conversation composer only, so typing
 * `/agents` on the new-conversation screen matched nothing, the menu never
 * opened, and the raw text was sent to the agent — which replied with nothing.
 * Two hand-maintained builtin lists will drift again; one definition cannot.
 *
 * Each composer still decides what the command DOES, because the useful action
 * differs by screen (navigate there vs. act on what is already on screen).
 */

import type { SlashCommandItem } from './types';

/** Commands every composer must offer. Pinned by test, not by convention. */
export const APP_SLASH_COMMAND_NAMES = ['new', 'agents'] as const;

export type AppSlashCommandName = (typeof APP_SLASH_COMMAND_NAMES)[number];

type Translate = (key: string, options?: { defaultValue?: string }) => string;

/**
 * Build the shared app-level commands.
 *
 * `kind: 'builtin'` means the menu EXECUTES them on selection rather than
 * inserting `/name ` as text — inserting is what made `/agents` reach the
 * agent as an unrecognised prompt in the first place.
 */
export function buildAppSlashCommands(t: Translate): SlashCommandItem[] {
  return [
    {
      name: 'new',
      description: t('messages.slash.newConversation', { defaultValue: 'Start a new conversation' }),
      kind: 'builtin',
      source: 'builtin',
    },
    {
      name: 'agents',
      description: t('messages.slash.switchAssistant', { defaultValue: 'Choose an assistant' }),
      kind: 'builtin',
      source: 'builtin',
    },
  ];
}
