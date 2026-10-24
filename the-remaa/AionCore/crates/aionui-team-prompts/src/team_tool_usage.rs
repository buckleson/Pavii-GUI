use aionui_api_types::{TeamToolDescriptor, TeamToolRole, TeamToolTransport};

use crate::role_prompt::TeamPromptRole;

pub fn build_team_tool_usage(role: TeamPromptRole, transport: TeamToolTransport) -> String {
    let tool_role = match role {
        TeamPromptRole::Lead => TeamToolRole::Lead,
        TeamPromptRole::Teammate => TeamToolRole::Teammate,
    };
    let descriptors = aionui_api_types::team_tool_descriptors_for_role(tool_role);
    match transport {
        TeamToolTransport::Mcp => render_mcp_usage(role, &descriptors),
        TeamToolTransport::CliAssumed => render_cli_usage(role, &descriptors),
    }
}

fn render_mcp_usage(role: TeamPromptRole, descriptors: &[TeamToolDescriptor]) -> String {
    let mut text = String::from(
        "You MUST use the `team_*` MCP tools for ALL team coordination.\n\
Do NOT use similarly named built-in tools from your platform.\n\
If a `team_*` call fails (invalid arguments, schema mismatch, role/permission), run\n\
\"$AIONUI_HELPER_BIN\" team capabilities (exact schema) or \"$AIONUI_HELPER_BIN\" team help,\n\
then retry the MCP tool call with corrected arguments.\n\
If the `team_*` MCP tools are unavailable, disconnected, or still fail after correction,\n\
use the Team CLI fallback: \"$AIONUI_HELPER_BIN\" team ... commands.\n\n\
| When | MCP tool | Input |\n\
|---|---|---|\n",
    );
    for tool in descriptors {
        text.push_str(&format!(
            "| {} | `{}` | {} |\n",
            tool.when, tool.name, tool.input_summary
        ));
    }
    if role == TeamPromptRole::Teammate {
        text.push_str("\nLead-only tools are unavailable to teammates.\n");
    }
    text
}

fn render_cli_usage(role: TeamPromptRole, descriptors: &[TeamToolDescriptor]) -> String {
    let mut text = String::from(
        "You MUST use the Pavii Team CLI for ALL team coordination: \"$AIONUI_HELPER_BIN\" team ...\n\
Run \"$AIONUI_HELPER_BIN\" team capabilities for exact schema: command names, stdin JSON schema,\n\
required fields, enum values, permissions, examples, and error meanings.\n\
Run \"$AIONUI_HELPER_BIN\" team help for a short readable guide.\n\
Do not guess team_id, slot_id, role, permissions, or internal tokens.\n\
Do not claim you used MCP tools in CLI transport.\n\
Use slot_id values from this prompt, team context, or team members results for all agent targets.\n\
On schema_validation_failed, unknown_command, or permission_denied: consult team capabilities\n\
or team help, correct the call, and retry at most once.\n\n\
| When | CLI command | Canonical tool | Input |\n\
|---|---|---|---|\n",
    );
    for tool in descriptors {
        text.push_str(&format!(
            "| {} | `team {}` | `{}` | {} |\n",
            tool.when,
            tool.cli_command.join(" "),
            tool.name,
            tool.input_summary
        ));
    }
    if role == TeamPromptRole::Teammate {
        text.push_str("\nLead-only tools are unavailable to teammates.\n");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_teammate_usage_excludes_lead_only_tools() {
        let usage = build_team_tool_usage(TeamPromptRole::Teammate, TeamToolTransport::CliAssumed);
        assert!(usage.contains("\"$AIONUI_HELPER_BIN\" team"));
        assert!(usage.contains("team send-message"));
        assert!(!usage.contains("team spawn-agent"));
        assert!(usage.contains("Lead-only tools are unavailable to teammates"));
    }

    #[test]
    fn mcp_lead_usage_includes_lead_tools() {
        let usage = build_team_tool_usage(TeamPromptRole::Lead, TeamToolTransport::Mcp);
        assert!(usage.contains("team_*` MCP tools"));
        assert!(usage.contains("team_spawn_agent"));
        assert!(usage.contains("\"$AIONUI_HELPER_BIN\" team capabilities"));
        assert!(usage.contains("retry the MCP tool call with corrected arguments"));
        assert!(usage.contains("use the Team CLI fallback"));
    }

    #[test]
    fn mcp_teammate_usage_includes_shared_fallback_guidance() {
        let usage = build_team_tool_usage(TeamPromptRole::Teammate, TeamToolTransport::Mcp);
        assert!(usage.contains("\"$AIONUI_HELPER_BIN\" team capabilities"));
        assert!(usage.contains("retry the MCP tool call with corrected arguments"));
        assert!(usage.contains("use the Team CLI fallback"));
        assert!(usage.contains("Lead-only tools are unavailable to teammates"));
    }
}
