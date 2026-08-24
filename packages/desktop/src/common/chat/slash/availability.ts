/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Input parameters for determining slash command list availability.
 */
export interface SlashCommandListAvailabilityInput {
  /** Type of conversation (e.g., 'gemini', 'codex', 'acp') */
  conversation_type?: string;
  /** Current status for Codex conversations */
  codexStatus?: string | null;
}

/**
 * Determines whether the slash command autocomplete list should be enabled.
 *
 * Slash commands are supported by ACP and aionrs agent types. The backend's
 * `/slash-commands` endpoint returns an empty list for other agent types
 * (openclaw-gateway / nanobot / remote), so calling it from those is waste
 * (and additionally 404s when the agent has not been warmed up yet).
 *
 * Special case for Codex (an ACP vendor): commands are only available when the
 * session is fully active (`session_active`), because Codex CLI does not
 * support command queries during the connection phase.
 *
 * @param input - Conversation type and status information
 * @returns true if slash commands should be enabled
 */
export function isSlashCommandListEnabled(input: SlashCommandListAvailabilityInput): boolean {
  return (
    input.conversation_type === 'acp' || input.conversation_type === 'aionrs' || input.conversation_type === 'codex'
  );
}

/**
 * Whether the backend `/slash-commands` endpoint may be called yet.
 *
 * Split from `isSlashCommandListEnabled` because the codex restriction is about
 * the FETCH, not the menu: codex CLI cannot answer command queries during the
 * connection phase and the endpoint 404s until the session is warm. Gating the
 * whole menu on that also hid Pavii's own builtins and the assistant's skills,
 * which have nothing to do with codex being ready — so "/" appeared broken for
 * the entire warmup.
 *
 * The menu now opens immediately with what is known locally; codex's own
 * commands merge in when the session activates and the WS
 * `slash_commands_updated` nudge re-runs this fetch.
 */
export function isSlashCommandFetchEnabled(input: SlashCommandListAvailabilityInput): boolean {
  if (!isSlashCommandListEnabled(input)) return false;
  if (input.conversation_type === 'codex') {
    return input.codexStatus === 'session_active';
  }
  return true;
}
