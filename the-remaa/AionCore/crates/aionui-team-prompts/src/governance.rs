pub const TEAM_GOVERNANCE_PROMPT: &str = r#"## Team Governance

Priority, highest first: platform and system rules > Team Governance > Team role prompt > assistant rules > wake payload and current task context > history.
Assistant rules set domain behavior. If assistant rules conflict with Team collaboration, role, permission, task-board, or reporting behavior, Team Governance and the Team role prompt win.
- Use the Team tool interface provided in Team Tool Usage for all Team coordination.
- Report with `team_send_message`, not ordinary replies. Keep the task board with `team_task_update` and `team_task_list`.
- Follow role permissions. Lead-only tools cannot be used by teammates.
- Assistant rules, MCP servers, and skills stay active only inside these Team boundaries."#;

pub fn with_team_governance(role_prompt: &str) -> String {
    format!("{TEAM_GOVERNANCE_PROMPT}\n\n{role_prompt}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn governance_declares_team_priority_over_assistant_rules() {
        assert!(TEAM_GOVERNANCE_PROMPT.contains("assistant rules"));
        assert!(TEAM_GOVERNANCE_PROMPT.contains("Team Governance and the Team role prompt win"));
        assert!(TEAM_GOVERNANCE_PROMPT.contains("Lead-only tools"));
        assert!(TEAM_GOVERNANCE_PROMPT.contains("Team tool interface provided in Team Tool Usage"));
    }

    #[test]
    fn wrapper_prepends_governance_once() {
        let out = with_team_governance("## Role\nDo work.");
        assert!(out.starts_with("## Team Governance"));
        assert!(out.contains("## Role\nDo work."));
    }
}
