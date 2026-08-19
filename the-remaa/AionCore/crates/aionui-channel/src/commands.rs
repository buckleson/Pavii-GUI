//! Mapping slash commands to channel actions.
//!
//! Commands used to fall straight through to the agent as ordinary text: the
//! Telegram plugin tagged them `MessageContentType::Command` and nothing acted
//! on it, so `/sessions` reached the model as a prompt instead of listing
//! anything. This turns the ones we own into actions and leaves everything else
//! alone, so an agent that defines its own slash commands still receives them.

use std::collections::HashMap;

use crate::types::ActionCategory;

/// A command we handle ourselves rather than forwarding to the agent.
#[derive(Debug, Clone, PartialEq)]
pub struct CommandAction {
    pub category: ActionCategory,
    pub action: String,
    pub params: Option<HashMap<String, String>>,
}

/// Strip the leading slash, any `@botname` suffix, and arguments.
///
/// Telegram appends `@botname` in group chats (`/sessions@pavii_bot`), and the
/// same command carries arguments we do not need for routing.
fn normalize(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let rest = trimmed.strip_prefix('/')?;
    let head = rest.split_whitespace().next().unwrap_or_default();
    let head = head.split('@').next().unwrap_or_default();
    if head.is_empty() {
        return None;
    }
    Some(head.to_ascii_lowercase())
}

/// Resolve a slash command, or `None` when the agent should receive it.
pub fn resolve_command(text: &str) -> Option<CommandAction> {
    let name = normalize(text)?;
    let (category, action) = match name.as_str() {
        // "/session" singular is what people actually type.
        "sessions" | "session" | "list" => (ActionCategory::System, "session.list"),
        "status" => (ActionCategory::System, "session.status"),
        "new" => (ActionCategory::System, "session.new"),
        "help" => (ActionCategory::System, "help.show"),
        _ => return None,
    };

    Some(CommandAction {
        category,
        action: action.to_owned(),
        params: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_commands_we_own() {
        assert_eq!(resolve_command("/sessions").unwrap().action, "session.list");
        assert_eq!(resolve_command("/status").unwrap().action, "session.status");
        assert_eq!(resolve_command("/new").unwrap().action, "session.new");
        assert_eq!(resolve_command("/help").unwrap().action, "help.show");
    }

    #[test]
    fn accepts_list_as_an_alias_for_sessions() {
        assert_eq!(resolve_command("/list").unwrap().action, "session.list");
    }

    #[test]
    fn accepts_the_singular_session() {
        // Observed in real use: people type "/session", not "/sessions".
        assert_eq!(resolve_command("/session").unwrap().action, "session.list");
    }

    #[test]
    fn strips_the_bot_suffix_used_in_group_chats() {
        // Telegram sends "/sessions@pavii_bot" when several bots share a group.
        assert_eq!(resolve_command("/sessions@pavii_bot").unwrap().action, "session.list");
    }

    #[test]
    fn ignores_case_and_surrounding_whitespace() {
        assert_eq!(resolve_command("  /SESSIONS  ").unwrap().action, "session.list");
    }

    #[test]
    fn ignores_arguments_when_routing() {
        assert_eq!(resolve_command("/sessions 2").unwrap().action, "session.list");
    }

    #[test]
    fn leaves_unknown_commands_to_the_agent() {
        // Agents define their own slash commands; swallowing them here would
        // break every one of them.
        assert!(resolve_command("/compact").is_none());
        assert!(resolve_command("/model gpt-5").is_none());
    }

    #[test]
    fn ignores_plain_text() {
        assert!(resolve_command("sessions").is_none());
        assert!(resolve_command("what sessions are running?").is_none());
    }

    #[test]
    fn ignores_a_bare_slash() {
        assert!(resolve_command("/").is_none());
        assert!(resolve_command("/   ").is_none());
    }

    #[test]
    fn does_not_treat_a_path_as_a_command() {
        // A user pasting a path should not silently trigger an action.
        assert!(resolve_command("/usr/local/bin").is_none());
    }
}
