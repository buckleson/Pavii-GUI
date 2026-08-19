//! Integration tests for announcing finished sessions to paired chats.
//!
//! Real in-memory SQLite: which chats get told is a property of the session and
//! user rows, not of the rendering.

use std::sync::{Arc, Mutex};

use aionui_common::{generate_id, now_ms};
use aionui_db::models::{AssistantSessionRow, AssistantUserRow, ConversationRow};
use aionui_db::{
    IChannelRepository, IConversationRepository, SqliteChannelRepository, SqliteConversationRepository,
    init_database_memory,
};
use async_trait::async_trait;

use aionui_channel::error::ChannelError;
use aionui_channel::finish_notifier::FinishNotifier;
use aionui_channel::stream_relay::ChannelSender;
use aionui_channel::types::UnifiedOutgoingMessage;

const OWNER_ID: &str = "system_default_user";

/// Records where messages were sent, so a test can assert routing rather than
/// merely "no error".
#[derive(Default)]
struct RecordingSender {
    sent: Mutex<Vec<(String, String, UnifiedOutgoingMessage)>>,
}

impl RecordingSender {
    fn routes(&self) -> Vec<(String, String)> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .map(|(plugin, chat, _)| (plugin.clone(), chat.clone()))
            .collect()
    }
}

#[async_trait]
impl ChannelSender for RecordingSender {
    async fn send_message(
        &self,
        _owner_user_id: &str,
        plugin_id: &str,
        chat_id: &str,
        message: UnifiedOutgoingMessage,
    ) -> Result<String, ChannelError> {
        self.sent
            .lock()
            .unwrap()
            .push((plugin_id.to_owned(), chat_id.to_owned(), message));
        Ok("msg-1".to_owned())
    }

    async fn edit_message(
        &self,
        _owner_user_id: &str,
        _plugin_id: &str,
        _chat_id: &str,
        _message_id: &str,
        _message: UnifiedOutgoingMessage,
    ) -> Result<(), ChannelError> {
        Ok(())
    }
}

struct Harness {
    notifier: FinishNotifier,
    sender: Arc<RecordingSender>,
    channels: Arc<dyn IChannelRepository>,
    conversations: Arc<dyn IConversationRepository>,
    _db: aionui_db::Database,
}

async fn setup() -> Harness {
    let db = init_database_memory().await.unwrap();
    let pool = db.pool().clone();
    let channels: Arc<dyn IChannelRepository> = Arc::new(SqliteChannelRepository::new(pool.clone()));
    let conversations: Arc<dyn IConversationRepository> = Arc::new(SqliteConversationRepository::new(pool));
    let sender = Arc::new(RecordingSender::default());

    Harness {
        notifier: FinishNotifier::new(
            OWNER_ID.to_owned(),
            Arc::clone(&conversations),
            Arc::clone(&channels),
            Arc::clone(&sender) as Arc<dyn ChannelSender>,
        ),
        sender,
        channels,
        conversations,
        _db: db,
    }
}

/// A paired chat: a platform identity plus the session pointing at a chat.
async fn pair_chat(harness: &Harness, platform: &str, platform_user: &str, chat_id: &str) -> String {
    let user_id = generate_id();
    harness
        .channels
        .create_user(
            OWNER_ID,
            &AssistantUserRow {
                id: user_id.clone(),
                owner_user_id: OWNER_ID.to_owned(),
                platform_user_id: platform_user.to_owned(),
                platform_type: platform.to_owned(),
                display_name: Some("Tester".to_owned()),
                authorized_at: now_ms(),
                last_active: Some(now_ms()),
                session_id: None,
            },
        )
        .await
        .unwrap();

    let session_id = generate_id();
    harness
        .channels
        .get_or_create_session(
            OWNER_ID,
            &user_id,
            chat_id,
            &AssistantSessionRow {
                id: session_id.clone(),
                user_id: user_id.clone(),
                agent_type: "aionrs".to_owned(),
                conversation_id: None,
                workspace: None,
                chat_id: Some(chat_id.to_owned()),
                created_at: now_ms(),
                last_activity: now_ms(),
            },
        )
        .await
        .unwrap();
    session_id
}

async fn make_conversation(harness: &Harness, name: &str) -> String {
    let id = generate_id();
    harness
        .conversations
        .create(&ConversationRow {
            id: id.clone(),
            user_id: OWNER_ID.to_owned(),
            name: name.to_owned(),
            r#type: "aionrs".to_owned(),
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
    id
}

#[tokio::test]
async fn a_desktop_started_session_still_reaches_a_paired_chat() {
    // The whole point: this conversation has no relay to any chat, so a
    // relay-based notification would never fire.
    let harness = setup().await;
    pair_chat(&harness, "telegram", "tg_1", "chat_1").await;
    let conversation = make_conversation(&harness, "Desktop work").await;

    let sent = harness.notifier.notify(&conversation).await.unwrap();

    assert_eq!(sent, 1);
    assert_eq!(
        harness.sender.routes(),
        vec![("telegram".to_owned(), "chat_1".to_owned())]
    );
}

#[tokio::test]
async fn the_chat_already_attached_is_not_told() {
    // It streamed the whole turn; telling it the turn ended is noise.
    let harness = setup().await;
    let session_id = pair_chat(&harness, "telegram", "tg_1", "chat_1").await;
    let conversation = make_conversation(&harness, "Attached work").await;
    harness
        .channels
        .update_session_conversation(OWNER_ID, &session_id, &conversation)
        .await
        .unwrap();

    let sent = harness.notifier.notify(&conversation).await.unwrap();

    assert_eq!(sent, 0);
    assert!(harness.sender.routes().is_empty());
}

#[tokio::test]
async fn other_chats_are_told_even_when_one_is_attached() {
    let harness = setup().await;
    let attached = pair_chat(&harness, "telegram", "tg_1", "chat_1").await;
    pair_chat(&harness, "telegram", "tg_2", "chat_2").await;
    let conversation = make_conversation(&harness, "Shared work").await;
    harness
        .channels
        .update_session_conversation(OWNER_ID, &attached, &conversation)
        .await
        .unwrap();

    let sent = harness.notifier.notify(&conversation).await.unwrap();

    assert_eq!(sent, 1);
    assert_eq!(
        harness.sender.routes(),
        vec![("telegram".to_owned(), "chat_2".to_owned())]
    );
}

#[tokio::test]
async fn every_paired_platform_is_told() {
    let harness = setup().await;
    pair_chat(&harness, "telegram", "tg_1", "chat_tg").await;
    pair_chat(&harness, "slack", "sl_1", "chat_slack").await;
    let conversation = make_conversation(&harness, "Cross-platform").await;

    let sent = harness.notifier.notify(&conversation).await.unwrap();

    assert_eq!(sent, 2);
    let mut routes = harness.sender.routes();
    routes.sort();
    assert_eq!(
        routes,
        vec![
            ("slack".to_owned(), "chat_slack".to_owned()),
            ("telegram".to_owned(), "chat_tg".to_owned()),
        ]
    );
}

#[tokio::test]
async fn nothing_is_sent_when_no_chat_is_paired() {
    // A desktop-only user finishing a session must not produce an error.
    let harness = setup().await;
    let conversation = make_conversation(&harness, "Lonely work").await;

    let sent = harness.notifier.notify(&conversation).await.unwrap();

    assert_eq!(sent, 0);
    assert!(harness.sender.routes().is_empty());
}

#[tokio::test]
async fn a_deleted_conversation_is_skipped_rather_than_announced() {
    // The Open button would dead-end, and there is no name to announce.
    let harness = setup().await;
    pair_chat(&harness, "telegram", "tg_1", "chat_1").await;

    let sent = harness
        .notifier
        .notify("conversation-that-never-existed")
        .await
        .unwrap();

    assert_eq!(sent, 0);
    assert!(harness.sender.routes().is_empty());
}

#[tokio::test]
async fn another_owners_conversation_is_never_announced() {
    let harness = setup().await;
    pair_chat(&harness, "telegram", "tg_1", "chat_1").await;

    // Owned by someone else, so the notifier cannot read it and says nothing.
    let stranger = generate_id();
    let sent = harness.notifier.notify(&stranger).await.unwrap();

    assert_eq!(sent, 0);
    assert!(harness.sender.routes().is_empty());
}

#[tokio::test]
async fn several_sessions_finishing_are_announced_separately() {
    let harness = setup().await;
    pair_chat(&harness, "telegram", "tg_1", "chat_1").await;
    let first = make_conversation(&harness, "First").await;
    let second = make_conversation(&harness, "Second").await;

    harness.notifier.notify(&first).await.unwrap();
    harness.notifier.notify(&second).await.unwrap();

    let sent = harness.sender.sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert!(sent[0].2.text.as_ref().unwrap().contains("First"));
    assert!(sent[1].2.text.as_ref().unwrap().contains("Second"));
}

#[tokio::test]
async fn a_chat_is_told_once_even_with_several_sessions_on_it() {
    // Two sessions can point at the same chat; the chat should not get two
    // copies of the same announcement.
    let harness = setup().await;
    pair_chat(&harness, "telegram", "tg_1", "chat_1").await;
    pair_chat(&harness, "telegram", "tg_2", "chat_1").await;
    let conversation = make_conversation(&harness, "Busy chat").await;

    let sent = harness.notifier.notify(&conversation).await.unwrap();

    assert_eq!(sent, 1, "one chat, one notification");
}

#[tokio::test]
async fn targets_exclude_a_session_with_no_chat() {
    // A session row can exist without a chat bound to it yet.
    let harness = setup().await;
    let user_id = generate_id();
    harness
        .channels
        .create_user(
            OWNER_ID,
            &AssistantUserRow {
                id: user_id.clone(),
                owner_user_id: OWNER_ID.to_owned(),
                platform_user_id: "tg_orphan".to_owned(),
                platform_type: "telegram".to_owned(),
                display_name: None,
                authorized_at: now_ms(),
                last_active: None,
                session_id: None,
            },
        )
        .await
        .unwrap();

    let conversation = make_conversation(&harness, "No chat").await;
    let targets = harness.notifier.targets(&conversation).await.unwrap();

    assert!(targets.is_empty());
}
