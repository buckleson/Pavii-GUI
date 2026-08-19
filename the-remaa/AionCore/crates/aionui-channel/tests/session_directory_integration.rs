//! Integration tests for listing and attaching sessions from a channel.
//!
//! Real in-memory SQLite throughout — these assert against actual repository
//! behaviour (paging, foreign keys, persistence of the attach pointer) rather
//! than a mock's idea of it.

use std::sync::{Arc, Mutex};

use aionui_api_types::WebSocketMessage;
use aionui_common::{generate_id, now_ms};
use aionui_db::models::{AssistantUserRow, ConversationRow};
use aionui_db::{
    IChannelRepository, IConversationRepository, IUserRepository, SqliteChannelRepository,
    SqliteConversationRepository, SqliteUserRepository, init_database_memory,
};
use aionui_realtime::EventBroadcaster;

use aionui_channel::session::SessionManager;
use aionui_channel::session_directory::{SESSIONS_PER_PAGE, SessionDirectory, entry_label, page_buttons, page_text};

const OWNER_ID: &str = "system_default_user";
const CHAT_ID: &str = "chat_1";
const AGENT: &str = "aionrs";

struct MockBroadcaster;
impl EventBroadcaster for MockBroadcaster {
    fn broadcast(&self, _event: WebSocketMessage<serde_json::Value>) {}
}

struct Harness {
    directory: SessionDirectory,
    conversations: Arc<dyn IConversationRepository>,
    users: Arc<dyn IUserRepository>,
    user_id: String,
    _keep_alive: Mutex<()>,
}

async fn setup() -> Harness {
    let db = init_database_memory().await.unwrap();
    let channel_repo: Arc<dyn IChannelRepository> = Arc::new(SqliteChannelRepository::new(db.pool().clone()));
    let conversations: Arc<dyn IConversationRepository> =
        Arc::new(SqliteConversationRepository::new(db.pool().clone()));
    let users: Arc<dyn IUserRepository> = Arc::new(SqliteUserRepository::new(db.pool().clone()));

    // Sessions carry a foreign key to assistant_users.
    let user_id = generate_id();
    channel_repo
        .create_user(
            OWNER_ID,
            &AssistantUserRow {
                id: user_id.clone(),
                owner_user_id: OWNER_ID.to_owned(),
                platform_user_id: "tg_1".to_owned(),
                platform_type: "telegram".to_owned(),
                display_name: Some("Tester".to_owned()),
                authorized_at: now_ms(),
                last_active: Some(now_ms()),
                session_id: None,
            },
        )
        .await
        .unwrap();

    let sessions = Arc::new(SessionManager::new(channel_repo.clone()));
    let directory = SessionDirectory::new(conversations.clone(), sessions);

    std::mem::forget(db);
    let _ = Arc::new(MockBroadcaster);

    Harness {
        directory,
        conversations,
        users,
        user_id,
        _keep_alive: Mutex::new(()),
    }
}

async fn make_conversation(harness: &Harness, name: &str, status: Option<&str>) -> String {
    let id = generate_id();
    harness
        .conversations
        .create(&ConversationRow {
            id: id.clone(),
            user_id: OWNER_ID.to_owned(),
            name: name.to_owned(),
            r#type: AGENT.to_owned(),
            extra: "{}".to_owned(),
            model: None,
            // conversations.status is NOT NULL in the schema; the model types it
            // Option only for legacy rows that predate the column.
            status: Some(status.unwrap_or("finished").to_owned()),
            source: Some("aionui".to_owned()),
            channel_chat_id: None,
            pinned: false,
            pinned_at: None,
            created_at: now_ms(),
            updated_at: now_ms(),
            project_id: None,
            folder_id: None,
            name_source: None,
        })
        .await
        .unwrap();
    id
}

// ── Listing ─────────────────────────────────────────────────────────

#[tokio::test]
async fn lists_conversations_the_channel_never_created() {
    let harness = setup().await;
    // source = "aionui": started on the desktop. Being able to reach these from
    // a phone is the point of the feature.
    make_conversation(&harness, "Desktop work", None).await;

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].title, "Desktop work");
}

#[tokio::test]
async fn an_owner_with_no_conversations_gets_an_empty_page_not_an_error() {
    let harness = setup().await;

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert!(page.entries.is_empty());
    assert!(page.next_cursor.is_none());
    assert!(page_buttons(&page).is_empty());
    assert!(page_text(&page).contains("No conversations yet"));
}

#[tokio::test]
async fn pages_when_there_are_more_conversations_than_fit() {
    let harness = setup().await;
    for index in 0..(SESSIONS_PER_PAGE + 3) {
        make_conversation(&harness, &format!("Conversation {index}"), None).await;
    }

    let first = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();
    assert_eq!(first.entries.len() as u32, SESSIONS_PER_PAGE);
    let cursor = first.next_cursor.clone().expect("a full page should offer a cursor");

    let second = harness.directory.list_page(OWNER_ID, Some(cursor), None).await.unwrap();
    assert_eq!(second.entries.len(), 3);
    assert!(second.next_cursor.is_none(), "the last page must not offer More");

    // No conversation may appear on both pages.
    let first_ids: Vec<_> = first.entries.iter().map(|e| &e.conversation_id).collect();
    for entry in &second.entries {
        assert!(!first_ids.contains(&&entry.conversation_id), "duplicate across pages");
    }
}

#[tokio::test]
async fn marks_running_conversations() {
    let harness = setup().await;
    make_conversation(&harness, "Busy", Some("running")).await;
    make_conversation(&harness, "Idle", Some("finished")).await;

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    let busy = page.entries.iter().find(|e| e.title == "Busy").unwrap();
    let idle = page.entries.iter().find(|e| e.title == "Idle").unwrap();
    assert!(busy.running);
    assert!(!idle.running);
    assert!(entry_label(busy).contains("running"));
}

#[tokio::test]
async fn does_not_list_another_owners_conversations() {
    let harness = setup().await;
    make_conversation(&harness, "Mine", None).await;
    let other = harness.users.create_user("someone_else", "hash").await.unwrap();
    harness
        .conversations
        .create(&ConversationRow {
            id: generate_id(),
            user_id: other.id.clone(),
            name: "Theirs".to_owned(),
            r#type: AGENT.to_owned(),
            extra: "{}".to_owned(),
            model: None,
            status: Some("finished".to_owned()),
            source: Some("aionui".to_owned()),
            channel_chat_id: None,
            pinned: false,
            pinned_at: None,
            created_at: now_ms(),
            updated_at: now_ms(),
            project_id: None,
            folder_id: None,
            name_source: None,
        })
        .await
        .unwrap();

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].title, "Mine");
}

// ── Attaching ───────────────────────────────────────────────────────

#[tokio::test]
async fn attaching_points_the_chat_at_the_conversation() {
    let harness = setup().await;
    let conversation_id = make_conversation(&harness, "Target", None).await;

    let attached = harness
        .directory
        .attach(OWNER_ID, &harness.user_id, CHAT_ID, AGENT, &conversation_id)
        .await
        .unwrap();
    assert_eq!(attached.id, conversation_id);

    let current = harness
        .directory
        .attached_conversation(OWNER_ID, &harness.user_id, CHAT_ID, AGENT)
        .await
        .unwrap();
    assert_eq!(current.unwrap().id, conversation_id);
}

#[tokio::test]
async fn switching_leaves_the_previous_conversation_untouched() {
    let harness = setup().await;
    let first = make_conversation(&harness, "First", Some("running")).await;
    let second = make_conversation(&harness, "Second", None).await;

    harness
        .directory
        .attach(OWNER_ID, &harness.user_id, CHAT_ID, AGENT, &first)
        .await
        .unwrap();
    harness
        .directory
        .attach(OWNER_ID, &harness.user_id, CHAT_ID, AGENT, &second)
        .await
        .unwrap();

    // Switching must never cancel work, or parallel sessions are impossible.
    let previous = harness.conversations.get(OWNER_ID, &first).await.unwrap().unwrap();
    assert_eq!(previous.status.as_deref(), Some("running"));

    let current = harness
        .directory
        .attached_conversation(OWNER_ID, &harness.user_id, CHAT_ID, AGENT)
        .await
        .unwrap();
    assert_eq!(current.unwrap().id, second);
}

#[tokio::test]
async fn attaching_is_idempotent() {
    let harness = setup().await;
    let conversation_id = make_conversation(&harness, "Target", None).await;

    for _ in 0..3 {
        harness
            .directory
            .attach(OWNER_ID, &harness.user_id, CHAT_ID, AGENT, &conversation_id)
            .await
            .unwrap();
    }

    let current = harness
        .directory
        .attached_conversation(OWNER_ID, &harness.user_id, CHAT_ID, AGENT)
        .await
        .unwrap();
    assert_eq!(current.unwrap().id, conversation_id);
}

#[tokio::test]
async fn attaching_to_a_missing_conversation_fails_instead_of_pointing_at_nothing() {
    let harness = setup().await;

    let result = harness
        .directory
        .attach(OWNER_ID, &harness.user_id, CHAT_ID, AGENT, "does-not-exist")
        .await;

    assert!(result.is_err(), "a bad id must not silently repoint the chat");
    let current = harness
        .directory
        .attached_conversation(OWNER_ID, &harness.user_id, CHAT_ID, AGENT)
        .await
        .unwrap();
    assert!(current.is_none(), "a failed attach must leave the pointer alone");
}

#[tokio::test]
async fn attaching_to_another_owners_conversation_is_refused() {
    let harness = setup().await;
    let other = harness.users.create_user("someone_else", "hash").await.unwrap();
    let foreign_id = generate_id();
    harness
        .conversations
        .create(&ConversationRow {
            id: foreign_id.clone(),
            user_id: other.id.clone(),
            name: "Theirs".to_owned(),
            r#type: AGENT.to_owned(),
            extra: "{}".to_owned(),
            model: None,
            status: Some("finished".to_owned()),
            source: Some("aionui".to_owned()),
            channel_chat_id: None,
            pinned: false,
            pinned_at: None,
            created_at: now_ms(),
            updated_at: now_ms(),
            project_id: None,
            folder_id: None,
            name_source: None,
        })
        .await
        .unwrap();

    let result = harness
        .directory
        .attach(OWNER_ID, &harness.user_id, CHAT_ID, AGENT, &foreign_id)
        .await;

    assert!(result.is_err(), "pairing must not grant access to another owner's data");
}

#[tokio::test]
async fn two_chats_can_hold_different_sessions_at_once() {
    let harness = setup().await;
    let first = make_conversation(&harness, "First", None).await;
    let second = make_conversation(&harness, "Second", None).await;

    harness
        .directory
        .attach(OWNER_ID, &harness.user_id, "chat_a", AGENT, &first)
        .await
        .unwrap();
    harness
        .directory
        .attach(OWNER_ID, &harness.user_id, "chat_b", AGENT, &second)
        .await
        .unwrap();

    let a = harness
        .directory
        .attached_conversation(OWNER_ID, &harness.user_id, "chat_a", AGENT)
        .await
        .unwrap();
    let b = harness
        .directory
        .attached_conversation(OWNER_ID, &harness.user_id, "chat_b", AGENT)
        .await
        .unwrap();

    assert_eq!(a.unwrap().id, first);
    assert_eq!(b.unwrap().id, second);
}

#[tokio::test]
async fn a_fresh_chat_reports_no_attachment() {
    let harness = setup().await;

    let current = harness
        .directory
        .attached_conversation(OWNER_ID, &harness.user_id, "never_used", AGENT)
        .await
        .unwrap();

    assert!(current.is_none());
}

#[tokio::test]
async fn the_attached_conversation_is_marked_in_the_listing() {
    let harness = setup().await;
    let target = make_conversation(&harness, "Target", None).await;
    make_conversation(&harness, "Other", None).await;

    harness
        .directory
        .attach(OWNER_ID, &harness.user_id, CHAT_ID, AGENT, &target)
        .await
        .unwrap();

    let page = harness
        .directory
        .list_page(OWNER_ID, None, Some(target.as_str()))
        .await
        .unwrap();

    let marked: Vec<_> = page.entries.iter().filter(|e| e.attached).collect();
    assert_eq!(marked.len(), 1, "exactly one entry should be marked attached");
    assert_eq!(marked[0].conversation_id, target);
}
