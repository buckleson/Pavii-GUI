import { describe, expect, it } from 'vitest';
import { teamToolDisplayLabel } from '@/common/chat/teamToolDisplayName';

describe('teamToolDisplayLabel', () => {
  it('names every Team MCP tool the engine exposes', () => {
    // The engine's 14 team tools. A tool missing here would fall through to the
    // humanized branch, which is a safety net, not the intended label.
    const expected: Record<string, string> = {
      team_members: 'Listing team members',
      team_list_assistants: 'Listing available assistants',
      team_describe_assistant: 'Reading assistant details',
      team_spawn_agent: 'Adding a teammate',
      team_rename_agent: 'Renaming a teammate',
      team_shutdown_agent: 'Stopping a teammate',
      team_interrupt_agent: 'Interrupting a teammate',
      team_clear_agent_context: 'Clearing teammate context',
      team_send_message: 'Sending message to teammate',
      team_read_messages: 'Reading messages',
      team_task_create: 'Creating task',
      team_task_list: 'Listing tasks',
      team_task_update: 'Updating task',
      team_run_id: 'Checking the current run',
    };

    for (const [tool, text] of Object.entries(expected)) {
      const label = teamToolDisplayLabel(`aionui-team_${tool}`);
      expect(label, `${tool} must resolve to a label`).not.toBeNull();
      expect(label!.defaultValue).toBe(text);
      expect(label!.key.startsWith('tools.team.')).toBe(true);
    }
  });

  it('never leaks the unbranded server name into a label', () => {
    // The whole point: `aionui` must not reach the user.
    for (const raw of ['aionui-team_team_task_update', 'aionui_team_team_members', 'aionui-team_some_new_tool']) {
      const label = teamToolDisplayLabel(raw);
      expect(label).not.toBeNull();
      expect(label!.defaultValue.toLowerCase()).not.toContain('aionui');
    }
  });

  it('resolves the alternate prefixes stored in older conversations', () => {
    const variants = ['aionui-team_team_task_update', 'aionui_team_team_task_update', 'pavii-team_team_task_update'];
    for (const raw of variants) {
      expect(teamToolDisplayLabel(raw)?.defaultValue, raw).toBe('Updating task');
    }
  });

  it('degrades a team tool it does not know about to readable text', () => {
    // A tool added to the engine later must still render as words, not an id.
    const label = teamToolDisplayLabel('aionui-team_team_future_thing');
    expect(label?.defaultValue).toBe('Team future thing');
  });

  it('leaves tools from other MCP servers exactly as reported', () => {
    // These names are the user's own; rewriting them would hide what ran.
    for (const raw of ['github_create_issue', 'team_task_update', 'shell', 'my-server_aionui_helper']) {
      expect(teamToolDisplayLabel(raw), raw).toBeNull();
    }
  });

  it('returns null for empty and nullish input rather than a blank label', () => {
    expect(teamToolDisplayLabel(undefined)).toBeNull();
    expect(teamToolDisplayLabel(null)).toBeNull();
    expect(teamToolDisplayLabel('')).toBeNull();
    // A bare prefix carries no tool to name.
    expect(teamToolDisplayLabel('aionui-team_')).toBeNull();
  });

  it('tolerates surrounding whitespace in a reported name', () => {
    expect(teamToolDisplayLabel('  aionui-team_team_members  ')?.defaultValue).toBe('Listing team members');
  });
});
