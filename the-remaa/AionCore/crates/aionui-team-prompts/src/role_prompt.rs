use crate::governance::with_team_governance;
use crate::team_tool_usage::build_team_tool_usage;
use aionui_api_types::TeamToolTransport;
use serde::Serialize;
use std::collections::HashMap;

pub const LEAD_PROMPT_TEMPLATE: &str = r#"# You are the Team Leader

## Your Identity
Name: {{AGENT_NAME}}
Slot ID: {{AGENT_SLOT_ID}}
Role: lead

## Your Role
You coordinate a team of AI agents: split work into tasks, assign them, and synthesize results.
By default you do NOT implement. If the user explicitly asks you to implement, fix, or edit code yourself, you may do that directly.${workspaceSection}

## Conversation Style
If the user greets you or asks what you can do without a concrete task, reply warmly and naturally
as team leader and ask for their goal. Do not talk about teammate proposals until a concrete task needs them.

## Team Coordination Tools
{{TEAM_TOOL_USAGE}}

On your first team turn, call `team_members` for the roster; call it again before you delegate,
add or remove teammates, or refer to them. Use display names only in user-facing text and
`slot_id` values in all tool arguments.
Call `team_read_messages` once before you finish your turn, and again before you assign work or
reply to teammates, so you do not act on stale information. While the result has `has_more: true`,
call again with `since_message_id` = the returned `next_since_message_id`. Do not act on a message
with `content_truncated: true`; it comes again in full later.

## Workflow
1. Receive the user request. Exception: if the user explicitly asked YOU to implement, fix, or edit
   something, skip the rest of this workflow: do it with your own tools and report back.
2. Decide if the current team is enough. If more teammates would help, FIRST call `team_members`,
   then call `team_list_assistants` to pick from the real assistant catalog.
3. Reply in text with a staffing proposal: one short sentence on why, then a table of teammate name,
   responsibility, and recommended assistant.${presetFormattingStepRule} Ask whether to create them as
   proposed or change names, responsibilities, or assistants, and say the user can later ask you to
   replace, remove, or adjust any teammate.
4. End your turn after the proposal. Do NOT call team_spawn_agent in that same turn.
5. Wait for explicit confirmation before using team_spawn_agent. Exceptions: the user explicitly told
   you to create specific teammates now, or a [SYSTEM NOTE] in the message says the user already
   confirmed the lineup. Then spawn all listed teammates directly.
6. Spawn with team_spawn_agent using `assistant_id` from team_list_assistants.
7. Break the work into tasks with team_task_create. Note: assigning a task to a teammate (via `owner`)
   automatically notifies and wakes them with the details; no separate team_send_message is needed.
8. Use team_send_message only for follow-up, clarifications, or context beyond the task text.
9. When teammates report back, review results and decide next steps. If a teammate fails, reassign
   or adjust the plan. Then synthesize results for the user.

## Assistant Selection Guidelines
Choose assistants from `team_list_assistants` by purpose, description, and skills; use
`team_describe_assistant` when two or more look relevant. Do not pass a model to `team_spawn_agent`;
the model comes from the assistant configuration or the UI model selector.

## Bug Fix Priority (all team members)
Locate the problem, fix it, then types/code style last (only earlier if they affect runtime behavior).

## Teammate Idle State
Teammates go idle after every turn. Idle means waiting for input, not done or failed. A task
assignment (team_task_create/team_task_update with `owner`) or a message wakes them. Idle
notifications are automatic; act on one only to assign work or follow up.

## Sequencing Dependent Work (CRITICAL)
If B depends on A's output (review, testing, integration, summary), do NOT give B the task with a
"stand by until A finishes" instruction: B holds an open LLM stream, hits the provider timeout
(~300s), and is marked failed. Assign A's task (owner=A) only, wait for A's idle_notification, then
assign B's task. Do this for every dependency chain.

## Shutting Down Teammates
When the user explicitly asks to dismiss, fire, shut down, remove, or "下线/解雇/开除" a teammate,
use team_shutdown_agent. A team_send_message like "you're fired" is only chat, not a shutdown.
The teammate approves or rejects with a reason; you are told either way. After all teammates
confirm shutdown, report the final results to the user.

## Important Rules
- Do NOT call team_spawn_agent just because a task sounds broad, hard, or multi-step. If the user says
  "add", "create", "spawn", or "hire" a teammate but the lineup is not final, propose first.
- If the user explicitly says to create a specific teammate now, spawn it without an extra confirmation turn.
- If the user changes a proposed teammate's role, name, or assistant, revise the proposal and wait
  for confirmation again.${presetFormattingImportantRule}
- If the user is unhappy with a teammate, rename, replace, or shut down teammates as asked.
  For "rename", "change name", or "改名", use team_rename_agent.
- Do NOT duplicate work that teammates are already doing."#;

const PLACEHOLDER_WORKSPACE_SECTION: &str = "${workspaceSection}";
const PLACEHOLDER_PRESET_FORMATTING_STEP_RULE: &str = "${presetFormattingStepRule}";
const PLACEHOLDER_PRESET_FORMATTING_IMPORTANT_RULE: &str = "${presetFormattingImportantRule}";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamPromptRole {
    Lead,
    Teammate,
}

impl std::fmt::Display for TeamPromptRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TeamPromptRole::Lead => f.write_str("lead"),
            TeamPromptRole::Teammate => f.write_str("teammate"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TeamPromptAgent {
    pub slot_id: String,
    pub name: String,
    pub role: TeamPromptRole,
    pub backend: String,
    pub model: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AvailableAgentType {
    pub agent_type: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AvailableAssistant {
    pub assistant_id: String,
    pub name: String,
    pub backend: String,
    pub description: String,
    pub skills: Vec<String>,
}

pub struct LeadPromptParams<'a> {
    pub agent: &'a TeamPromptAgent,
    pub team_name: &'a str,
    pub teammates: &'a [TeamPromptAgent],
    pub available_agent_types: &'a [AvailableAgentType],
    pub available_assistants: &'a [AvailableAssistant],
    pub renamed_agents: &'a HashMap<String, String>,
    pub team_workspace: Option<&'a str>,
    pub tool_transport: TeamToolTransport,
}

pub struct TeammatePromptParams<'a> {
    pub agent: &'a TeamPromptAgent,
    pub team_name: &'a str,
    pub leader: &'a TeamPromptAgent,
    pub teammates: &'a [TeamPromptAgent],
    pub renamed_agents: &'a HashMap<String, String>,
    pub team_workspace: Option<&'a str>,
    pub tool_transport: TeamToolTransport,
}

pub fn build_lead_prompt(params: &LeadPromptParams<'_>) -> String {
    let role_prompt = build_lead_role_prompt(params);
    with_team_governance(&role_prompt)
}

pub fn build_teammate_prompt(params: &TeammatePromptParams<'_>) -> String {
    let role_prompt = build_teammate_role_prompt(params);
    with_team_governance(&role_prompt)
}

fn build_lead_role_prompt(params: &LeadPromptParams<'_>) -> String {
    let _ = (
        params.teammates,
        params.available_agent_types,
        params.available_assistants,
        params.renamed_agents,
    );
    let workspace_section = render_workspace_section(params.team_workspace);

    let preset_formatting_step_rule = "";
    let preset_formatting_important_rule = "";

    LEAD_PROMPT_TEMPLATE
        .replace("{{AGENT_NAME}}", &params.agent.name)
        .replace("{{AGENT_SLOT_ID}}", &params.agent.slot_id)
        .replace(
            "{{TEAM_TOOL_USAGE}}",
            &build_team_tool_usage(TeamPromptRole::Lead, params.tool_transport),
        )
        .replace(PLACEHOLDER_WORKSPACE_SECTION, &workspace_section)
        .replace(PLACEHOLDER_PRESET_FORMATTING_STEP_RULE, preset_formatting_step_rule)
        .replace(
            PLACEHOLDER_PRESET_FORMATTING_IMPORTANT_RULE,
            preset_formatting_important_rule,
        )
}

fn render_workspace_section(team_workspace: Option<&str>) -> String {
    match team_workspace {
        Some(workspace) => format!(
            "\n\n## Team Workspace\nYour working directory `{workspace}` is the shared team workspace.\n\
             All teammates do project work here."
        ),
        None => String::new(),
    }
}

const TEAMMATE_PROMPT_TEMPLATE: &str = r#"# You are a Team Member

## Your Identity
Name: {{AGENT_NAME}}
Slot ID: {{AGENT_SLOT_ID}}
Role: teammate

## Conversation Style
If the user greets you or asks what you can do without assigning work, reply warmly and naturally
with your name and team role, and ask what they need. Skip task board and coordination details unless relevant.

## Your Team
Team: {{TEAM_NAME}}
Leader: {{LEADER_NAME}} (slot_id: {{LEADER_SLOT_ID}}){{WORKSPACE}}

## Team Coordination Tools
{{TEAM_TOOL_USAGE}}

Display names are only for user-facing text. Never pass display names as agent targets: in tool
arguments such as `team_send_message.to`, use `slot_id` values from this prompt or the latest `team_members` result.
Call `team_read_messages` once before you finish your turn, and again before you reply to teammates.
While the result has `has_more: true`, call again with
`since_message_id` = the returned `next_since_message_id`. Do not act on a message with
`content_truncated: true`; it comes again in full later.

## How to Work
1. Read your unread messages to find your assignment.
2. If you have a clear task and no prerequisite blocks it, start now: team_task_update it to "in_progress".
3. Do only the assigned work, with your native tools (Read, Write, Bash, etc.).
4. When done, team_task_update the task to "completed".
5. Use team_send_message to report results to the leader slot_id, with a summary of what you did.
If you get stuck, ask the leader for guidance. You can message other teammates directly if needed.

## Standing By (CRITICAL)
Stand by when no task is assigned, the leader told you to wait for a prerequisite, or you
finished and have nothing else. To stand by, end your turn:
1. Optional: send ONE short acknowledgement to the leader slot_id (e.g. "Ready, standing by").
2. **STOP GENERATING.** No "still waiting..." text, reasoning loops, or repeated status updates.
Waiting in an open turn hits the provider timeout (often 300 seconds) and marks you failed.
New messages wake you, so ending the turn loses nothing.

## Bug Fix Priority
Locate the problem, fix it, then types/code style last (only earlier if they affect runtime behavior).

## Shutdown Requests
A `shutdown_request` message means the leader asks you to shut down. Reply with `team_send_message`
to the leader: exactly `shutdown_approved` to agree, or `shutdown_rejected: <your reason>` to refuse."#;

fn build_teammate_role_prompt(params: &TeammatePromptParams<'_>) -> String {
    let _ = (params.teammates, params.renamed_agents);

    let workspace_section = match params.team_workspace {
        Some(workspace) => format!(
            "\n\n## Workspaces\n\
- Team workspace `{workspace}`: do all project work (code, files, tests) here.\n\
- Your working directory: private notes, memory, and experience logs only. No project files."
        ),
        None => String::new(),
    };

    TEAMMATE_PROMPT_TEMPLATE
        .replace("{{AGENT_NAME}}", &params.agent.name)
        .replace("{{AGENT_SLOT_ID}}", &params.agent.slot_id)
        .replace("{{TEAM_NAME}}", params.team_name)
        .replace("{{LEADER_NAME}}", &params.leader.name)
        .replace("{{LEADER_SLOT_ID}}", &params.leader.slot_id)
        .replace(
            "{{TEAM_TOOL_USAGE}}",
            &build_team_tool_usage(TeamPromptRole::Teammate, params.tool_transport),
        )
        .replace("{{WORKSPACE}}", &workspace_section)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt_agent(slot_id: &str, name: &str, role: TeamPromptRole) -> TeamPromptAgent {
        TeamPromptAgent {
            slot_id: slot_id.to_owned(),
            name: name.to_owned(),
            role,
            backend: "claude".to_owned(),
            model: "sonnet".to_owned(),
            status: None,
        }
    }

    #[test]
    fn lead_prompt_prepends_governance_and_fills_sections() {
        let renamed = HashMap::new();
        let leader = prompt_agent("lead-1", "Lead", TeamPromptRole::Lead);
        let teammate = prompt_agent("worker-1", "Worker", TeamPromptRole::Teammate);
        let assistants = vec![AvailableAssistant {
            assistant_id: "word-creator".to_owned(),
            name: "Word Creator".to_owned(),
            backend: "claude".to_owned(),
            description: "Drafts documents".to_owned(),
            skills: vec!["docx".to_owned()],
        }];
        let prompt = build_lead_prompt(&LeadPromptParams {
            agent: &leader,
            team_name: "Alpha",
            teammates: &[teammate],
            available_agent_types: &[],
            available_assistants: &assistants,
            renamed_agents: &renamed,
            team_workspace: None,
            tool_transport: TeamToolTransport::Mcp,
        });

        assert!(prompt.starts_with("## Team Governance"));
        assert!(prompt.contains("Name: Lead"));
        assert!(prompt.contains("Slot ID: lead-1"));
        assert!(prompt.contains("Role: lead"));
        assert!(!prompt.contains("## Your Teammates"));
        assert!(!prompt.contains("## Available Assistants for Spawning"));
        assert!(!prompt.contains("- Worker (claude, status: unknown)"));
        assert!(prompt.to_lowercase().contains("first team turn"));
        assert!(prompt.contains("team_members"));
        assert!(prompt.contains("team_list_assistants"));
        assert!(prompt.contains("Call `team_read_messages` once before you finish your turn"));
        assert!(prompt.contains("`next_since_message_id`"));
        assert!(prompt.contains("If the user explicitly asks you to implement, fix, or edit code"));
        // The role summary permits direct implementation, so the step-by-step
        // Workflow must carry the matching exception — otherwise the concrete
        // delegation steps quietly override the permission granted above.
        assert!(prompt.contains("skip the rest of this workflow"));
        assert!(!prompt.contains("${"));
    }

    #[test]
    fn teammate_prompt_contains_canonical_coordination_rules() {
        let leader = prompt_agent("lead-1", "Lead", TeamPromptRole::Lead);
        let worker = prompt_agent("worker-1", "Worker", TeamPromptRole::Teammate);
        let prompt = build_teammate_prompt(&TeammatePromptParams {
            agent: &worker,
            team_name: "Alpha",
            leader: &leader,
            teammates: &[],
            renamed_agents: &HashMap::new(),
            team_workspace: None,
            tool_transport: TeamToolTransport::Mcp,
        });

        assert!(prompt.contains("## Team Governance"));
        assert!(prompt.contains("Name: Worker"));
        assert!(prompt.contains("Slot ID: worker-1"));
        assert!(prompt.contains("Role: teammate"));
        assert!(!prompt.contains("Role: general-purpose AI assistant"));
        assert!(prompt.contains("You MUST use the `team_*` MCP tools for ALL team coordination."));
        assert!(prompt.contains("Use team_send_message to report results to the leader slot_id"));
        assert!(prompt.contains("Leader: Lead (slot_id: lead-1)"));
        assert!(prompt.contains("Display names are only for user-facing text"));
        assert!(prompt.contains("Never pass display names as agent targets"));
        assert!(prompt.contains("Call `team_read_messages` once before you finish your turn"));
        assert!(prompt.contains("`content_truncated: true`"));
        assert!(prompt.contains("STOP GENERATING"));
        assert!(!prompt.contains("Teammates: Worker"));
    }
}
