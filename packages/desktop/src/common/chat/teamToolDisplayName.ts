/**
 * Human-readable labels for the Team MCP tools.
 *
 * The engine exposes team coordination over an MCP server whose name is a wire
 * value (`TEAM_MCP_SERVER_NAME` in the engine's `aionui-api-types`), and ACP
 * hands the renderer the concatenated id — `aionui-team_team_task_update`.
 * Printed raw that is both unbranded and meaningless to a user watching their
 * team work.
 *
 * The mapping lives here, at render time, rather than in the engine: the server
 * name is matched on by the permission router and is already recorded in every
 * stored tool call, so renaming it would leave existing conversations reading
 * the old id anyway. Translating on display fixes history and new messages
 * alike, and keeps the protocol untouched.
 */

/** Prefix ACP prepends to every Team MCP tool id. */
const TEAM_TOOL_PREFIX = 'aionui-team_';

/**
 * Historical prefix variants seen in stored messages.
 *
 * Some agents report the id with `_` separators throughout rather than the
 * server/tool split, so both spellings must resolve to the same label or old
 * conversations would render inconsistently.
 */
const TEAM_TOOL_PREFIXES = [TEAM_TOOL_PREFIX, 'aionui_team_', 'pavii-team_', 'pavii_team_'];

/** i18n key suffix per bare tool name, under `tools.team.*`. */
const TEAM_TOOL_KEYS: Record<string, string> = {
  team_members: 'members',
  team_list_assistants: 'listAssistants',
  team_describe_assistant: 'describeAssistant',
  team_spawn_agent: 'spawnAgent',
  team_rename_agent: 'renameAgent',
  team_shutdown_agent: 'shutdownAgent',
  team_interrupt_agent: 'interruptAgent',
  team_clear_agent_context: 'clearAgentContext',
  team_send_message: 'sendMessage',
  team_read_messages: 'readMessages',
  team_task_create: 'taskCreate',
  team_task_list: 'taskList',
  team_task_update: 'taskUpdate',
  team_run_id: 'runId',
};

/** English text used when a translation is missing, keyed as above. */
const TEAM_TOOL_FALLBACKS: Record<string, string> = {
  members: 'Listing team members',
  listAssistants: 'Listing available assistants',
  describeAssistant: 'Reading assistant details',
  spawnAgent: 'Adding a teammate',
  renameAgent: 'Renaming a teammate',
  shutdownAgent: 'Stopping a teammate',
  interruptAgent: 'Interrupting a teammate',
  clearAgentContext: 'Clearing teammate context',
  sendMessage: 'Sending message to teammate',
  readMessages: 'Reading messages',
  taskCreate: 'Creating task',
  taskList: 'Listing tasks',
  taskUpdate: 'Updating task',
  runId: 'Checking the current run',
};

export type ToolDisplayLabel = {
  /** Full i18n key, e.g. `tools.team.taskUpdate`. */
  key: string;
  /** English text to show when the key is absent. */
  defaultValue: string;
};

/** Strip a known Team MCP prefix, or return null when this is not a team tool. */
const stripTeamPrefix = (rawName: string): string | null => {
  for (const prefix of TEAM_TOOL_PREFIXES) {
    if (rawName.startsWith(prefix)) {
      return rawName.slice(prefix.length);
    }
  }
  return null;
};

/**
 * Turn a raw tool id into a title-cased phrase.
 *
 * Only used for a team tool this file does not know about yet — a new engine
 * tool must degrade to "Team run id" rather than reappearing as a raw id.
 */
const humanize = (bare: string): string => {
  const words = bare.replace(/[_-]+/g, ' ').trim();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The label for a tool call, or `null` when the name is not a Team MCP tool and
 * should be shown exactly as the agent reported it.
 *
 * Returning `null` rather than guessing matters: tool ids from other MCP servers
 * are the user's own naming, and rewriting them would hide what actually ran.
 */
export const teamToolDisplayLabel = (rawName: string | undefined | null): ToolDisplayLabel | null => {
  if (!rawName) return null;
  const bare = stripTeamPrefix(rawName.trim());
  if (bare === null) return null;

  const known = TEAM_TOOL_KEYS[bare];
  if (known) {
    return { key: `tools.team.${known}`, defaultValue: TEAM_TOOL_FALLBACKS[known] };
  }

  // An unmapped team tool: keep it readable and unbranded instead of falling
  // back to the prefixed id.
  const readable = humanize(bare);
  return readable ? { key: `tools.team.${bare}`, defaultValue: readable } : null;
};
