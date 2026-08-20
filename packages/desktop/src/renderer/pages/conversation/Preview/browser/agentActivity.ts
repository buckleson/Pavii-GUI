/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recognise "the agent is driving the in-app browser" from the tool-call stream.
 *
 * Pure and side-effect free so it can be unit-tested, which matters here: getting it wrong
 * leaves the badge stuck on or never lit, and that badge is the only clue the user has about what just happened.
 *
 * Detects "the agent is driving the in-app browser" from the tool-call stream.
 * Kept pure and side-effect free so it can be unit tested: getting this wrong
 * leaves the activity badge either permanently on or never on, and it is the
 * user's only cue about what just happened.
 */

/**
 * Registration name of the built-in browser MCP, defined in common so the main process registers and the renderer recognises it by the same value.
 * Re-exported here for convenient use within this directory.
 *
 * Registered name of the built-in browser MCP. Defined in common so the main
 * process (which registers it) and the renderer (which recognises it) share one
 * value; re-exported here for local use within this directory.
 */
export { BUILTIN_BROWSER_MCP_NAME } from '@/common/config/constants';

import { BUILTIN_BROWSER_MCP_NAME, LEGACY_BUILTIN_BROWSER_MCP_NAME } from '@/common/config/constants';

/**
 * States that count as a tool still running.
 *
 * `Confirming` counts as running too: the agent is already waiting for approval of a browser
 * action, which is exactly when the user needs to know where to look.
 *
 * Statuses that count as in-flight. `Confirming` is included: at that point the
 * agent is waiting for approval of a browser action, which is exactly when the
 * user most needs to know where to look.
 */
const IN_FLIGHT_STATUSES = new Set(['Executing', 'Pending', 'Confirming']);

type ToolGroupEntry = {
  name?: string;
  status?: string;
  confirmationDetails?: { type?: string; server_name?: string } | Record<string, unknown>;
};

/**
 * Both the current and pre-rebrand server names: conversations created before
 * the rename recorded the old name in their tool calls, and their badges should
 * keep working.
 */
const BROWSER_MCP_NAMES = [BUILTIN_BROWSER_MCP_NAME, LEGACY_BUILTIN_BROWSER_MCP_NAME];

const isBrowserMcpEntry = (entry: ToolGroupEntry): boolean => {
  const details = entry.confirmationDetails as { type?: string; server_name?: string } | undefined;
  if (details?.type === 'mcp' && details.server_name && BROWSER_MCP_NAMES.includes(details.server_name)) return true;

  /**
   * Fallback matching on the tool-name prefix: engines name MCP tools differently, and some use
   * a `<server>__<tool>` prefix without filling confirmationDetails. Missing one is better than
   * claiming one falsely, and these two cover every shape seen so far.
   *
   * Fall back to the tool-name prefix: engines differ in how they name MCP tools,
   * and some emit `<server>__<tool>` without confirmationDetails. Under-detecting
   * beats over-detecting, but these two checks cover every known shape today.
   */
  const name = entry.name;
  if (typeof name === 'string' && BROWSER_MCP_NAMES.some((server) => name.startsWith(`${server}__`))) return true;

  return false;
};

/**
 * Whether a tool_group message means the agent is currently driving the browser.
 */
export const isBrowserMcpActivity = (messageType: string, data: unknown): boolean => {
  if (messageType !== 'tool_group') return false;
  if (!Array.isArray(data)) return false;

  return (data as ToolGroupEntry[]).some(
    (entry) => isBrowserMcpEntry(entry) && IN_FLIGHT_STATUSES.has(String(entry.status))
  );
};

/**
 * Whether a tool_group message means a browser action has finished, successfully or not.
 *
 * "Finished" is decided directly rather than by negating "running": one message can carry other
 * tools too, and negation would read an unrelated message as the browser finishing, putting the badge out early.
 *
 * Whether a tool_group message means a browser action has finished (either way).
 * Detected explicitly rather than as the negation of in-flight: a single message
 * may carry unrelated tools, and negating would misread those as "browser done",
 * extinguishing the badge too early.
 */
export const isBrowserMcpSettled = (messageType: string, data: unknown): boolean => {
  if (messageType !== 'tool_group') return false;
  if (!Array.isArray(data)) return false;

  const entries = (data as ToolGroupEntry[]).filter(isBrowserMcpEntry);
  if (entries.length === 0) return false;

  return entries.every((entry) => !IN_FLIGHT_STATUSES.has(String(entry.status)));
};
