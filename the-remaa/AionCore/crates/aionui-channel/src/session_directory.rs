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

use std::sync::Arc;

use aionui_db::IConversationRepository;
use aionui_db::models::ConversationRow;
use aionui_db::ConversationFilters;

use crate::error::ChannelError;
use crate::session::SessionManager;
use crate::types::ActionButton;

/// Conversations shown per page. Inline keyboards are size-capped on every
/// platform, and a wall of buttons is unreadable on a phone regardless.
pub const SESSIONS_PER_PAGE: u32 = 8;

/// Longest conversation title kept in a button label. Telegram rejects
/// over-long callback button text, and long titles wrap badly on mobile.
const MAX_LABEL_LEN: usize = 40;

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
                params: Some(
                    [("id".to_owned(), entry.conversation_id.clone())]
                        .into_iter()
                        .collect(),
                ),
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

fn is_running(row: &ConversationRow) -> bool {
    matches!(row.status.as_deref(), Some("running") | Some("pending"))
}

/// Reads conversations and moves a chat's pointer between them.
pub struct SessionDirectory {
    conversations: Arc<dyn IConversationRepository>,
    sessions: Arc<SessionManager>,
}

impl SessionDirectory {
    pub fn new(conversations: Arc<dyn IConversationRepository>, sessions: Arc<SessionManager>) -> Self {
        Self { conversations, sessions }
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
        };

        let result = self.conversations.list_paginated(owner_user_id, &filters).await?;

        let next_cursor = result
            .has_more
            .then(|| result.items.last().map(|row| row.id.clone()))
            .flatten();

        let entries = result
            .items
            .iter()
            .map(|row| SessionEntry {
                conversation_id: row.id.clone(),
                title: row.name.clone(),
                agent_type: row.r#type.clone(),
                running: is_running(row),
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
        assert!(label.starts_with('\u{25cf}'), "attached session should be marked: {label}");
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
    fn pending_conversations_count_as_running() {
        let mut row = ConversationRow {
            id: "c1".into(),
            user_id: "u1".into(),
            name: "One".into(),
            r#type: "aionrs".into(),
            extra: "{}".into(),
            model: None,
            status: Some("pending".into()),
            source: None,
            channel_chat_id: None,
            pinned: false,
            pinned_at: None,
            created_at: 0,
            updated_at: 0,
            project_id: None,
            folder_id: None,
            name_source: None,
        };
        assert!(is_running(&row), "a queued turn is still work in flight");
        row.status = Some("finished".into());
        assert!(!is_running(&row));
        row.status = None;
        assert!(!is_running(&row), "legacy rows without status are not running");
    }
}
