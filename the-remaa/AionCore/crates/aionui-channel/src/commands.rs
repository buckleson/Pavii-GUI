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

/// One entry in the command picker Telegram shows when you type "/".
#[derive(Debug, Clone, PartialEq)]
pub struct MenuCommand {
    /// Registered name, without the leading slash.
    pub name: &'static str,
    pub description: &'static str,
}

/// Commands advertised in the "/" picker.
///
/// Deliberately a subset of what [`resolve_command`] accepts: `/session` and
/// `/list` keep working as aliases but are not listed, because Telegram renders
/// one row per registered name and duplicates only clutter the picker.
///
/// Every entry here must resolve — an advertised command that reaches the model
/// instead of an action is worse than no menu at all. A test enforces it.
pub fn menu() -> Vec<MenuCommand> {
    vec![
        MenuCommand {
            name: "sessions",
            description: "List your conversations and switch between them",
        },
        MenuCommand {
            name: "projects",
            description: "Browse projects and the sessions inside them",
        },
        MenuCommand {
            name: "active_works",
            description: "Show sessions running right now and step into one",
        },
        MenuCommand {
            name: "tasks",
            description: "Show your scheduled tasks and when they next run",
        },
        MenuCommand {
            name: "status",
            description: "Show which conversation this chat is attached to",
        },
        MenuCommand {
            name: "new",
            description: "Start a fresh conversation",
        },
        MenuCommand {
            name: "help",
            description: "What this bot can do",
        },
    ]
}

/// The same commands, rendered for a Slack app manifest.
///
/// Slack has no `setMyCommands` equivalent: slash commands are **declared in
/// the app manifest**, which a human pastes into api.slack.com. Generating the
/// block from [`menu`] is what stops the declared list drifting from the
/// handled one — a command Slack advertises but nothing resolves reaches the
/// model as a prompt, which is worse than not offering it.
///
/// `request_url` is the app's own endpoint; it is left to the caller because it
/// varies per deployment.
pub fn slack_manifest_commands(request_url: &str) -> String {
    let mut out = String::from("  slash_commands:\n");
    for entry in menu() {
        out.push_str(&format!("    - command: /{}\n", entry.name));
        out.push_str(&format!("      url: {request_url}\n"));
        out.push_str(&format!("      description: {}\n", entry.description));
        out.push_str("      should_escape: false\n");
    }
    out
}

/// Resolve a slash command, or `None` when the agent should receive it.
pub fn resolve_command(text: &str) -> Option<CommandAction> {
    let name = normalize(text)?;
    let (category, action) = match name.as_str() {
        // "/session" singular is what people actually type.
        "sessions" | "session" | "list" => (ActionCategory::System, "session.list"),
        // Kept separate from "sessions" on purpose: that stays a flat list of
        // everything, this is the structured route through projects.
        "projects" | "project" => (ActionCategory::System, "project.list"),
        // Telegram command names allow only letters, digits and underscore,
        // so the advertised name is "active_works"; the hyphenated and short
        // spellings are accepted because they are what people type.
        "active_works" | "active-works" | "active" | "running" => (ActionCategory::System, "session.active"),
        "tasks" | "task" | "schedule" => (ActionCategory::System, "task.list"),
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

    // ── Slack manifest ────────────────────────────────────────────────

    #[test]
    fn the_slack_manifest_declares_every_menu_command() {
        // Slack cannot be told about commands over an API, so the manifest is
        // the only place the list exists. It must not drift from `menu()`.
        let manifest = slack_manifest_commands("https://example.invalid/slack");

        for entry in menu() {
            assert!(
                manifest.contains(&format!("- command: /{}", entry.name)),
                "{} is handled but not declared to Slack",
                entry.name
            );
            assert!(
                manifest.contains(entry.description),
                "{} is declared without its description",
                entry.name
            );
        }
    }

    #[test]
    fn the_slack_manifest_declares_nothing_that_is_not_handled() {
        // The reverse drift: a declared command nothing resolves reaches the
        // model as an ordinary prompt.
        let manifest = slack_manifest_commands("https://example.invalid/slack");

        for line in manifest.lines() {
            let Some(command) = line.trim().strip_prefix("- command: /") else {
                continue;
            };
            assert!(
                resolve_command(&format!("/{command}")).is_some(),
                "Slack declares /{command} but nothing handles it"
            );
        }
    }

    #[test]
    fn the_slack_manifest_carries_the_callers_request_url() {
        let manifest = slack_manifest_commands("https://pavii.example/slack/commands");
        assert!(manifest.contains("url: https://pavii.example/slack/commands"));
    }

    #[test]
    fn the_slack_manifest_has_one_entry_per_command() {
        let manifest = slack_manifest_commands("https://example.invalid/slack");
        let declared = manifest.lines().filter(|l| l.trim().starts_with("- command: ")).count();
        assert_eq!(declared, menu().len());
    }

    #[test]
    fn maps_the_scheduled_tasks_command() {
        assert_eq!(resolve_command("/tasks").unwrap().action, "task.list");
        assert_eq!(resolve_command("/task").unwrap().action, "task.list");
        assert_eq!(resolve_command("/schedule").unwrap().action, "task.list");
    }

    #[test]
    fn maps_the_running_sessions_command() {
        assert_eq!(resolve_command("/active_works").unwrap().action, "session.active");
    }

    #[test]
    fn accepts_the_spellings_people_actually_type_for_active_works() {
        // Telegram advertises the underscore form, but a hyphen is the natural
        // thing to type and would otherwise reach the model as a prompt.
        for spelling in ["/active-works", "/active", "/running"] {
            assert_eq!(
                resolve_command(spelling).unwrap().action,
                "session.active",
                "{spelling} should resolve"
            );
        }
    }

    #[test]
    fn maps_projects_separately_from_sessions() {
        // Two distinct routes: /sessions is the flat list, /projects is the
        // structured one. Collapsing them would lose the flat view.
        assert_eq!(resolve_command("/projects").unwrap().action, "project.list");
        assert_eq!(resolve_command("/sessions").unwrap().action, "session.list");
    }

    #[test]
    fn accepts_the_singular_project() {
        assert_eq!(resolve_command("/project").unwrap().action, "project.list");
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
    fn every_menu_entry_resolves_to_an_action() {
        // The anti-drift guard: advertising a command that falls through to the
        // model would be worse than showing no menu.
        for entry in menu() {
            let command = format!("/{}", entry.name);
            assert!(
                resolve_command(&command).is_some(),
                "menu advertises {command} but nothing handles it"
            );
        }
    }

    #[test]
    fn menu_names_satisfy_telegram_rules() {
        // Telegram rejects registration otherwise: 1-32 chars, lowercase
        // letters, digits and underscores, and no leading slash.
        for entry in menu() {
            assert!(!entry.name.starts_with('/'), "{} must not carry a slash", entry.name);
            assert!(
                (1..=32).contains(&entry.name.len()),
                "{} is out of Telegram's length range",
                entry.name
            );
            assert!(
                entry
                    .name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "{} has characters Telegram rejects",
                entry.name
            );
        }
    }

    #[test]
    fn menu_descriptions_are_present_and_within_the_limit() {
        for entry in menu() {
            assert!(
                !entry.description.trim().is_empty(),
                "{} needs a description",
                entry.name
            );
            assert!(entry.description.len() <= 256, "{} description too long", entry.name);
        }
    }

    #[test]
    fn menu_has_no_duplicate_names() {
        let mut names: Vec<&str> = menu().iter().map(|entry| entry.name).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "duplicate command in the menu");
    }

    #[test]
    fn aliases_work_but_are_not_advertised() {
        let names: Vec<&str> = menu().iter().map(|entry| entry.name).collect();
        for alias in [
            "session",
            "list",
            "project",
            "active-works",
            "active",
            "running",
            "task",
            "schedule",
        ] {
            assert!(
                resolve_command(&format!("/{alias}")).is_some(),
                "{alias} should resolve"
            );
            assert!(!names.contains(&alias), "{alias} should not be listed");
        }
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
