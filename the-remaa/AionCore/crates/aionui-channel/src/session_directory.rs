//! Listing and attaching sessions from a chat channel.
//!
//! A chat used to *own* one session: `session.new` reset it, and there was no
//! way to see or reach anything else. Here a chat instead holds a **pointer**
//! to whichever conversation it is currently attached to, so several sessions
//! can run at once and the chat can move between them without stopping any.
//!
//! The listing spans every conversation the owner has, not only ones a channel
//! created, so a conversation started on the desktop can be picked up from a
//! phone. Pairing (`crate::pairing`) is what gates who may do that.

use std::collections::HashSet;
use std::sync::Arc;

use aionui_ai_agent::IWorkerTaskManager;
use aionui_common::ConversationStatus;
use aionui_db::ConversationFilters;
use aionui_db::IConversationRepository;
use aionui_db::IProjectStore;
use aionui_db::ProjectKind;
use aionui_db::models::ConversationRow;

use crate::branding::brand_display_text;
use crate::error::ChannelError;
use crate::session::SessionManager;
use crate::types::ActionButton;

/// Conversations shown per page. Inline keyboards are size-capped on every
/// platform, and a wall of buttons is unreadable on a phone regardless.
pub const SESSIONS_PER_PAGE: u32 = 8;

/// Longest conversation title kept in a button label. Telegram rejects
/// over-long callback button text, and long titles wrap badly on mobile.
const MAX_LABEL_LEN: usize = 40;

/// Conversations listed when a project is opened.
///
/// A project listing does not page, unlike `/sessions`. That is a hard limit
/// rather than a preference: Telegram allows 64 bytes of callback data, and a
/// "next page inside this project" button would have to carry a project id
/// *and* a cursor -- two UUIDs, 72 bytes before any prefix. Showing a generous
/// single page and saying plainly when it truncates costs no extra state and
/// leaves `/sessions` the fully paged view.
pub const PROJECT_SESSIONS_LIMIT: u32 = 24;

/// Stored project ids carry this prefix; callback data does not.
pub const PROJECT_ID_PREFIX: &str = "project_";

/// Shorten a project id for callback data.
///
/// `system:project.open:i=project_<uuid>` is 67 bytes, past the Telegram
/// limit; without the prefix it is 59. The action already names the entity, so
/// the prefix carries nothing a handler needs.
pub fn callback_project_ref(project_id: &str) -> String {
    project_id
        .strip_prefix(PROJECT_ID_PREFIX)
        .unwrap_or(project_id)
        .to_owned()
}

/// Restore a full project id from callback data.
///
/// Tolerates a reference that still carries the prefix, so a button minted by
/// an older build keeps working after an upgrade.
pub fn resolve_project_ref(reference: &str) -> String {
    if reference.starts_with(PROJECT_ID_PREFIX) {
        reference.to_owned()
    } else {
        format!("{PROJECT_ID_PREFIX}{reference}")
    }
}

/// One row in the project picker.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectEntry {
    pub project_id: String,
    pub name: String,
}

/// The project a session listing is scoped to.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectScope {
    pub project_id: String,
    pub name: String,
    /// The project holds more conversations than the listing shows.
    pub truncated: bool,
}

/// One row in the session picker.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionEntry {
    pub conversation_id: String,
    pub title: String,
    pub agent_type: String,
    /// True when the engine still considers this conversation to be working.
    pub running: bool,
    /// True when the asking chat is currently pointed at this conversation.
    pub attached: bool,
}

/// A page of the picker plus the cursor needed to ask for the next one.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionPage {
    pub entries: Vec<SessionEntry>,
    pub next_cursor: Option<String>,
}

fn truncate_label(title: &str) -> String {
    let trimmed = title.trim();
    let title = if trimmed.is_empty() { "Untitled" } else { trimmed };
    if title.chars().count() <= MAX_LABEL_LEN {
        return title.to_owned();
    }
    let kept: String = title.chars().take(MAX_LABEL_LEN - 1).collect();
    format!("{}\u{2026}", kept.trim_end())
}

/// Button label for one entry. The markers carry the state that matters at a
/// glance: which one you are talking to, and which are still working.
pub fn entry_label(entry: &SessionEntry) -> String {
    let mut label = String::new();
    if entry.attached {
        label.push_str("\u{25cf} ");
    }
    label.push_str(&truncate_label(&entry.title));
    if entry.running {
        label.push_str(" \u{00b7} running");
    }
    label
}

/// Render a page as one button per row, with a "More" button when the listing
/// continues. One per row because titles are long and two columns truncate
/// them into uselessness.
pub fn page_buttons(page: &SessionPage) -> Vec<Vec<ActionButton>> {
    let mut rows: Vec<Vec<ActionButton>> = page
        .entries
        .iter()
        .map(|entry| {
            vec![ActionButton {
                label: entry_label(entry),
                action: "session.attach".into(),
                params: Some([("id".to_owned(), entry.conversation_id.clone())].into_iter().collect()),
            }]
        })
        .collect();

    if let Some(cursor) = &page.next_cursor {
        rows.push(vec![ActionButton {
            label: "More\u{2026}".into(),
            action: "session.list".into(),
            params: Some([("cursor".to_owned(), cursor.clone())].into_iter().collect()),
        }]);
    }

    rows
}

/// Message body for a page. Kept separate from the buttons so the empty case
/// can say something useful instead of rendering a bare heading.
pub fn page_text(page: &SessionPage) -> String {
    if page.entries.is_empty() {
        return "No conversations yet. Send a message to start one.".to_owned();
    }
    let running = page.entries.iter().filter(|entry| entry.running).count();
    if running == 0 {
        "Pick a session to continue.".to_owned()
    } else if running == 1 {
        "Pick a session to continue. 1 is running.".to_owned()
    } else {
        format!("Pick a session to continue. {running} are running.")
    }
}

/// Buttons for the running-sessions list. Attaching is how you interject, so
/// the action is the same one the session picker uses.
pub fn active_buttons(entries: &[SessionEntry]) -> Vec<Vec<ActionButton>> {
    entries
        .iter()
        .map(|entry| {
            vec![ActionButton {
                label: entry_label(entry),
                action: "session.attach".into(),
                params: Some([("id".to_owned(), entry.conversation_id.clone())].into_iter().collect()),
            }]
        })
        .collect()
}

/// Message body for the running-sessions list.
pub fn active_text(entries: &[SessionEntry]) -> String {
    match entries.len() {
        0 => "Nothing is running right now.".to_owned(),
        1 => "1 session is running. Pick it to follow along or send it a message.".to_owned(),
        n => format!("{n} sessions are running. Pick one to follow along or send it a message."),
    }
}

/// Render the project picker, one project per row.
pub fn project_buttons(projects: &[ProjectEntry]) -> Vec<Vec<ActionButton>> {
    projects
        .iter()
        .map(|project| {
            vec![ActionButton {
                label: truncate_label(&project.name),
                action: "project.open".into(),
                params: Some(
                    [("i".to_owned(), callback_project_ref(&project.project_id))]
                        .into_iter()
                        .collect(),
                ),
            }]
        })
        .collect()
}

/// Message body for the project picker.
pub fn project_list_text(projects: &[ProjectEntry]) -> String {
    if projects.is_empty() {
        return "No projects yet. Open a folder in the desktop app to create one.".to_owned();
    }
    "Pick a project to see its sessions.".to_owned()
}

/// Buttons for one project: its conversations, then a way to start a fresh one
/// inside the same project.
///
/// Deliberately no "More" button -- see [`PROJECT_SESSIONS_LIMIT`].
pub fn project_page_buttons(page: &SessionPage, scope: &ProjectScope) -> Vec<Vec<ActionButton>> {
    let mut rows: Vec<Vec<ActionButton>> = page
        .entries
        .iter()
        .map(|entry| {
            vec![ActionButton {
                label: entry_label(entry),
                action: "session.attach".into(),
                params: Some([("id".to_owned(), entry.conversation_id.clone())].into_iter().collect()),
            }]
        })
        .collect();

    rows.push(vec![ActionButton {
        label: "Start a new session here".into(),
        action: "project.start".into(),
        params: Some(
            [("i".to_owned(), callback_project_ref(&scope.project_id))]
                .into_iter()
                .collect(),
        ),
    }]);

    rows
}

/// Message body for one project.
pub fn project_page_text(page: &SessionPage, scope: &ProjectScope) -> String {
    if page.entries.is_empty() {
        return format!("\"{}\" has no sessions yet. Start one below.", scope.name);
    }
    let mut text = format!("Sessions in \"{}\".", scope.name);
    if scope.truncated {
        // Saying so beats quietly showing a subset: this line is the only
        // signal that anything is missing from the list.
        text.push_str(&format!(
            " Showing the {PROJECT_SESSIONS_LIMIT} most recent -- use /sessions for the rest."
        ));
    }
    text
}

/// Convert a stored `file:` folder URI back into a filesystem path.
///
/// Returns `None` for anything that is not a local file URI -- a remote or
/// malformed folder has no path to run an agent in, and inventing one would
/// start the session somewhere the user did not ask for.
fn workspace_uri_to_path(uri: &str) -> Option<String> {
    url::Url::parse(uri)
        .ok()
        .and_then(|parsed| parsed.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Conversations the engine is working on right now.
///
/// Deliberately not `conversations.status`. That column is written twice --
/// `"pending"` when the row is created and `"finished"` when a turn completes
/// -- and never `"running"`, because the runtime keeps status in memory
/// (`SessionRuntime::set_status`) and does not write it back. Reading the row
/// was therefore wrong in both directions: a conversation that had never run a
/// turn looked busy, and one that was genuinely mid-turn looked idle.
///
/// A live task is not by itself a running one -- a warm idle agent still holds
/// a task -- so the status on the task is checked too.
fn running_conversation_ids(tasks: &Arc<dyn IWorkerTaskManager>) -> HashSet<String> {
    tasks
        .active_conversation_ids()
        .into_iter()
        .filter(|id| {
            matches!(
                tasks.get_task(id).and_then(|task| task.status()),
                Some(ConversationStatus::Running) | Some(ConversationStatus::Pending)
            )
        })
        .collect()
}

/// Reads conversations and moves a chat's pointer between them.
pub struct SessionDirectory {
    conversations: Arc<dyn IConversationRepository>,
    projects: Arc<dyn IProjectStore>,
    tasks: Arc<dyn IWorkerTaskManager>,
    sessions: Arc<SessionManager>,
}

impl SessionDirectory {
    pub fn new(
        conversations: Arc<dyn IConversationRepository>,
        projects: Arc<dyn IProjectStore>,
        tasks: Arc<dyn IWorkerTaskManager>,
        sessions: Arc<SessionManager>,
    ) -> Self {
        Self {
            conversations,
            projects,
            tasks,
            sessions,
        }
    }

    /// Conversations the engine is executing right now, for this owner.
    ///
    /// The task manager is global, so every id is resolved against the owner
    /// before it is shown: an id that does not belong to this owner reads back
    /// as `None` and is dropped rather than leaked.
    pub async fn list_active(
        &self,
        owner_user_id: &str,
        attached_conversation_id: Option<&str>,
    ) -> Result<Vec<SessionEntry>, ChannelError> {
        let running = running_conversation_ids(&self.tasks);
        let mut entries = Vec::new();

        for conversation_id in running {
            let Some(row) = self.conversations.get(owner_user_id, &conversation_id).await? else {
                continue;
            };
            entries.push(SessionEntry {
                conversation_id: row.id.clone(),
                title: brand_display_text(&row.name),
                agent_type: row.r#type.clone(),
                running: true,
                attached: attached_conversation_id == Some(row.id.as_str()),
            });
        }

        // The task manager hands back an unordered map; without this the list
        // would reshuffle between refreshes and buttons would move under the
        // thumb.
        entries.sort_by(|a, b| {
            a.title
                .cmp(&b.title)
                .then_with(|| a.conversation_id.cmp(&b.conversation_id))
        });
        Ok(entries)
    }

    /// Every project the owner has, most recently updated first.
    pub async fn list_projects(&self, owner_user_id: &str) -> Result<Vec<ProjectEntry>, ChannelError> {
        let rows = self.projects.list_projects(owner_user_id).await?;
        Ok(rows
            .into_iter()
            // Temp projects are the throwaway workspace created per
            // conversation, one per session. Listing them buries the real
            // projects under noise, and there is nothing useful to open.
            // Filtered here rather than in the store: the store method is
            // general, this is a display decision.
            .filter(|row| ProjectKind::parse(&row.kind) != Some(ProjectKind::Temp))
            .map(|row| ProjectEntry {
                project_id: row.project_id,
                name: brand_display_text(&row.name),
            })
            .collect())
    }

    /// Filesystem path of a project workspace root, when it has a local one.
    ///
    /// This is what makes "start a session in this project" actually land in
    /// the project: a new conversation is bound to a project by resolving its
    /// workspace path (`ConversationService::bind_project_best_effort`), not by
    /// being handed a project id. Folders store a `file:` URI, so it is
    /// converted back here.
    ///
    /// `None` when the project has no workspace entry or its folder is not a
    /// local path -- callers should then start an ordinary session rather than
    /// claim a project one.
    pub async fn project_workspace_path(
        &self,
        owner_user_id: &str,
        project_id: &str,
    ) -> Result<Option<String>, ChannelError> {
        let entries = self.projects.list_entries(owner_user_id, project_id).await?;
        Ok(entries
            .into_iter()
            .find(|(entry, _folder)| entry.role == "workspace")
            .and_then(|(_entry, folder)| workspace_uri_to_path(&folder.resource_canonical)))
    }

    /// One project and its conversations, newest first.
    ///
    /// Errors when the project does not exist or belongs to someone else. An
    /// empty listing would otherwise be indistinguishable from a project that
    /// simply has no conversations yet.
    pub async fn list_project_page(
        &self,
        owner_user_id: &str,
        project_id: &str,
        attached_conversation_id: Option<&str>,
    ) -> Result<(SessionPage, ProjectScope), ChannelError> {
        let project = self
            .projects
            .get_project(owner_user_id, project_id)
            .await?
            .ok_or_else(|| ChannelError::SessionNotFound(project_id.to_owned()))?;

        let filters = ConversationFilters {
            cursor: None,
            limit: PROJECT_SESSIONS_LIMIT,
            source: None,
            cron_job_id: None,
            pinned: None,
            project_id: Some(project_id.to_owned()),
        };

        let result = self.conversations.list_paginated(owner_user_id, &filters).await?;
        let truncated = result.has_more;
        let running = running_conversation_ids(&self.tasks);

        let entries = result
            .items
            .iter()
            .map(|row| SessionEntry {
                conversation_id: row.id.clone(),
                title: brand_display_text(&row.name),
                agent_type: row.r#type.clone(),
                running: running.contains(&row.id),
                attached: attached_conversation_id == Some(row.id.as_str()),
            })
            .collect();

        Ok((
            SessionPage {
                entries,
                // Never paged; see PROJECT_SESSIONS_LIMIT.
                next_cursor: None,
            },
            ProjectScope {
                project_id: project.project_id,
                name: brand_display_text(&project.name),
                truncated,
            },
        ))
    }

    /// One page of the owner's conversations, newest first.
    ///
    /// `attached_conversation_id` marks the row this chat is currently pointed
    /// at so the caller does not have to re-derive it.
    pub async fn list_page(
        &self,
        owner_user_id: &str,
        cursor: Option<String>,
        attached_conversation_id: Option<&str>,
    ) -> Result<SessionPage, ChannelError> {
        let filters = ConversationFilters {
            cursor,
            limit: SESSIONS_PER_PAGE,
            source: None,
            cron_job_id: None,
            pinned: None,
            // `/sessions` stays a flat list of everything, project or not.
            project_id: None,
        };

        let result = self.conversations.list_paginated(owner_user_id, &filters).await?;

        let next_cursor = result
            .has_more
            .then(|| result.items.last().map(|row| row.id.clone()))
            .flatten();
        let running = running_conversation_ids(&self.tasks);

        let entries = result
            .items
            .iter()
            .map(|row| SessionEntry {
                conversation_id: row.id.clone(),
                title: brand_display_text(&row.name),
                agent_type: row.r#type.clone(),
                running: running.contains(&row.id),
                attached: attached_conversation_id == Some(row.id.as_str()),
            })
            .collect();

        Ok(SessionPage { entries, next_cursor })
    }

    /// Point this chat at `conversation_id`.
    ///
    /// The previously attached session is left alone — detaching must never
    /// stop work, otherwise switching would cancel whatever was running.
    pub async fn attach(
        &self,
        owner_user_id: &str,
        internal_user_id: &str,
        chat_id: &str,
        agent_type: &str,
        conversation_id: &str,
    ) -> Result<ConversationRow, ChannelError> {
        let conversation = self
            .conversations
            .get(owner_user_id, conversation_id)
            .await?
            .ok_or_else(|| ChannelError::SessionNotFound(conversation_id.to_owned()))?;

        let session = self
            .sessions
            .get_or_create_session(owner_user_id, internal_user_id, chat_id, agent_type, None)
            .await?;

        self.sessions
            .bind_conversation(owner_user_id, &session.id, conversation_id)
            .await?;

        Ok(conversation)
    }

    /// The conversation this chat is currently pointed at, if any.
    pub async fn attached_conversation(
        &self,
        owner_user_id: &str,
        internal_user_id: &str,
        chat_id: &str,
        agent_type: &str,
    ) -> Result<Option<ConversationRow>, ChannelError> {
        let session = self
            .sessions
            .get_or_create_session(owner_user_id, internal_user_id, chat_id, agent_type, None)
            .await?;

        let Some(conversation_id) = session.conversation_id else {
            return Ok(None);
        };

        Ok(self.conversations.get(owner_user_id, &conversation_id).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, title: &str, running: bool, attached: bool) -> SessionEntry {
        SessionEntry {
            conversation_id: id.to_owned(),
            title: title.to_owned(),
            agent_type: "aionrs".to_owned(),
            running,
            attached,
        }
    }

    #[test]
    fn label_marks_the_attached_session() {
        let label = entry_label(&entry("c1", "Refactor the parser", false, true));
        assert!(
            label.starts_with('\u{25cf}'),
            "attached session should be marked: {label}"
        );
        assert!(label.contains("Refactor the parser"));
    }

    #[test]
    fn label_marks_running_sessions() {
        assert!(entry_label(&entry("c1", "Build docs", true, false)).ends_with("running"));
        assert!(!entry_label(&entry("c1", "Build docs", false, false)).ends_with("running"));
    }

    #[test]
    fn label_truncates_long_titles() {
        let label = entry_label(&entry("c1", &"x".repeat(200), false, false));
        assert!(label.chars().count() <= MAX_LABEL_LEN, "label too long: {label}");
        assert!(label.ends_with('\u{2026}'));
    }

    #[test]
    fn label_falls_back_when_the_title_is_blank() {
        assert_eq!(entry_label(&entry("c1", "   ", false, false)), "Untitled");
    }

    #[test]
    fn every_entry_becomes_an_attach_button() {
        let page = SessionPage {
            entries: vec![entry("c1", "One", false, false), entry("c2", "Two", true, false)],
            next_cursor: None,
        };
        let rows = page_buttons(&page);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0].action, "session.attach");
        assert_eq!(rows[0][0].params.as_ref().unwrap().get("id").unwrap(), "c1");
    }

    #[test]
    fn a_continuing_listing_gets_a_more_button() {
        let page = SessionPage {
            entries: vec![entry("c1", "One", false, false)],
            next_cursor: Some("c1".to_owned()),
        };
        let rows = page_buttons(&page);
        assert_eq!(rows.len(), 2, "expected the entry plus a More button");
        let more = &rows[1][0];
        assert_eq!(more.action, "session.list");
        assert_eq!(more.params.as_ref().unwrap().get("cursor").unwrap(), "c1");
    }

    #[test]
    fn the_last_page_has_no_more_button() {
        let page = SessionPage {
            entries: vec![entry("c1", "One", false, false)],
            next_cursor: None,
        };
        assert_eq!(page_buttons(&page).len(), 1);
    }

    #[test]
    fn an_empty_listing_says_so_rather_than_showing_a_bare_heading() {
        let page = SessionPage {
            entries: vec![],
            next_cursor: None,
        };
        assert!(page_buttons(&page).is_empty());
        assert!(page_text(&page).contains("No conversations yet"));
    }

    #[test]
    fn page_text_counts_running_sessions() {
        let none = SessionPage {
            entries: vec![entry("c1", "One", false, false)],
            next_cursor: None,
        };
        let one = SessionPage {
            entries: vec![entry("c1", "One", true, false)],
            next_cursor: None,
        };
        let two = SessionPage {
            entries: vec![entry("c1", "One", true, false), entry("c2", "Two", true, false)],
            next_cursor: None,
        };
        assert!(!page_text(&none).contains("running"));
        assert!(page_text(&one).contains("1 is running"));
        assert!(page_text(&two).contains("2 are running"));
    }

    #[test]
    fn the_running_marker_no_longer_comes_from_the_row() {
        // Regression guard for the real defect: `conversations.status` is only
        // ever "pending" (at creation) or "finished" (at turn completion), so
        // reading it marked never-used conversations as busy and genuinely
        // busy ones as idle. Running state now comes from the task manager,
        // and `SessionEntry.running` is set by the caller from that.
        let idle = entry("c1", "One", false, false);
        let busy = entry("c2", "Two", true, false);

        assert!(!entry_label(&idle).contains("running"));
        assert!(entry_label(&busy).contains("running"));
    }

    #[test]
    fn the_active_list_says_so_when_nothing_is_running() {
        // An empty keyboard with no explanation reads as a broken command.
        assert!(active_buttons(&[]).is_empty());
        assert_eq!(active_text(&[]), "Nothing is running right now.");
    }

    #[test]
    fn the_active_list_counts_what_is_running() {
        let one = [entry("c1", "One", true, false)];
        let two = [entry("c1", "One", true, false), entry("c2", "Two", true, false)];

        assert!(active_text(&one).starts_with("1 session is running"));
        assert!(active_text(&two).starts_with("2 sessions are running"));
        assert_eq!(active_buttons(&two).len(), 2);
        assert_eq!(active_buttons(&two)[0][0].action, "session.attach");
    }
}
