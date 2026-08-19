//! Integration tests for listing and attaching sessions from a channel.
//!
//! Real in-memory SQLite throughout — these assert against actual repository
//! behaviour (paging, foreign keys, persistence of the attach pointer) rather
//! than a mock's idea of it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aionui_ai_agent::agent_task::{AgentInstance, IAgentTask};
use aionui_ai_agent::types::{BuildTaskOptions, SendMessageData};
use aionui_ai_agent::{AgentError, AgentSendError, AgentStreamEvent, IMockAgent, IWorkerTaskManager};
use aionui_api_types::WebSocketMessage;
use aionui_common::{AgentKillReason, AgentType, ConversationStatus, TimestampMs, generate_id, now_ms};
use aionui_db::ConversationRowUpdate;
use aionui_db::models::{AssistantUserRow, ConversationRow};
use aionui_db::{
    IChannelRepository, IConversationRepository, IProjectStore, IUserRepository, ProjectKind, SqliteChannelRepository,
    SqliteConversationRepository, SqliteProjectStore, SqliteUserRepository, init_database_memory,
};
use aionui_realtime::EventBroadcaster;
use async_trait::async_trait;
use tokio::sync::broadcast;

use aionui_channel::session::SessionManager;
use aionui_channel::session_directory::{
    PROJECT_SESSIONS_LIMIT, SESSIONS_PER_PAGE, SessionDirectory, active_buttons, active_text, callback_project_ref,
    entry_label, page_buttons, page_text, project_buttons, project_list_text, project_page_buttons, project_page_text,
    resolve_project_ref,
};

const OWNER_ID: &str = "system_default_user";
const CHAT_ID: &str = "chat_1";
const AGENT: &str = "aionrs";

struct MockBroadcaster;
impl EventBroadcaster for MockBroadcaster {
    fn broadcast(&self, _event: WebSocketMessage<serde_json::Value>) {}
}

/// An agent whose status the test dictates.
struct StubAgent {
    conversation_id: String,
    status: Option<ConversationStatus>,
    event_tx: broadcast::Sender<AgentStreamEvent>,
}

impl StubAgent {
    fn new(conversation_id: &str, status: Option<ConversationStatus>) -> Self {
        let (event_tx, _) = broadcast::channel(4);
        Self {
            conversation_id: conversation_id.to_owned(),
            status,
            event_tx,
        }
    }
}

#[async_trait]
impl IAgentTask for StubAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Aionrs
    }
    fn conversation_id(&self) -> &str {
        &self.conversation_id
    }
    fn workspace(&self) -> &str {
        "/tmp/aionui-session-directory-test"
    }
    fn status(&self) -> Option<ConversationStatus> {
        self.status
    }
    fn last_activity_at(&self) -> TimestampMs {
        0
    }
    fn subscribe(&self) -> broadcast::Receiver<AgentStreamEvent> {
        self.event_tx.subscribe()
    }
    async fn send_message(&self, _data: SendMessageData) -> Result<(), AgentSendError> {
        Ok(())
    }
    async fn cancel(&self) -> Result<(), AgentError> {
        Ok(())
    }
    fn kill(&self, _reason: Option<AgentKillReason>) -> Result<(), AgentError> {
        Ok(())
    }
}

impl IMockAgent for StubAgent {}

/// Task manager whose live set the test dictates.
///
/// `active_conversation_ids` is overridden deliberately: the trait ships a
/// default returning an empty vec, so a double that forgot to override it
/// would make every running-state assertion vacuously pass.
#[derive(Default)]
struct StubTasks {
    agents: Mutex<HashMap<String, AgentInstance>>,
}

impl StubTasks {
    /// Replace the live set. Conversation ids are generated at insert time, so
    /// tests populate this after creating their rows.
    fn set_live(&self, entries: &[(&str, Option<ConversationStatus>)]) {
        let mut agents = self.agents.lock().unwrap();
        agents.clear();
        for (id, status) in entries {
            agents.insert(
                (*id).to_owned(),
                AgentInstance::Mock(Arc::new(StubAgent::new(id, *status))),
            );
        }
    }
}

#[async_trait]
impl IWorkerTaskManager for StubTasks {
    fn get_task(&self, conversation_id: &str) -> Option<AgentInstance> {
        self.agents.lock().unwrap().get(conversation_id).cloned()
    }
    async fn get_or_build_task(
        &self,
        _conversation_id: &str,
        _options: BuildTaskOptions,
    ) -> Result<AgentInstance, AgentError> {
        unreachable!("the session directory never builds tasks")
    }
    fn kill(&self, conversation_id: &str, _reason: Option<AgentKillReason>) -> Result<(), AgentError> {
        self.agents.lock().unwrap().remove(conversation_id);
        Ok(())
    }
    fn kill_and_wait(
        &self,
        conversation_id: &str,
        reason: Option<AgentKillReason>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        let _ = self.kill(conversation_id, reason);
        Box::pin(std::future::ready(()))
    }
    async fn clear(&self) {
        self.agents.lock().unwrap().clear();
    }
    fn active_count(&self) -> usize {
        self.agents.lock().unwrap().len()
    }
    fn active_conversation_ids(&self) -> Vec<String> {
        self.agents.lock().unwrap().keys().cloned().collect()
    }
    fn collect_idle(&self, _idle_threshold_ms: TimestampMs) -> Vec<String> {
        Vec::new()
    }
}

struct Harness {
    directory: SessionDirectory,
    conversations: Arc<dyn IConversationRepository>,
    projects: Arc<dyn IProjectStore>,
    tasks: Arc<StubTasks>,
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
    let projects: Arc<dyn IProjectStore> = Arc::new(SqliteProjectStore::new(db.pool().clone()));
    let tasks = Arc::new(StubTasks::default());

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
    let directory = SessionDirectory::new(
        conversations.clone(),
        projects.clone(),
        Arc::clone(&tasks) as Arc<dyn IWorkerTaskManager>,
        sessions,
    );

    std::mem::forget(db);
    let _ = Arc::new(MockBroadcaster);

    Harness {
        directory,
        conversations,
        projects,
        tasks,
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

async fn make_project(harness: &Harness, canonical: &str, name: &str, owner: &str) -> String {
    make_project_of_kind(harness, canonical, name, owner, ProjectKind::Standard).await
}

async fn make_project_of_kind(
    harness: &Harness,
    canonical: &str,
    name: &str,
    owner: &str,
    kind: ProjectKind,
) -> String {
    let folder = harness.projects.upsert_folder(canonical, canonical).await.unwrap();
    let (project, _entry) = harness
        .projects
        .create_project_with_workspace_entry(owner, &folder.folder_id, name, kind)
        .await
        .unwrap();
    project.project_id
}

async fn make_conversation_in(harness: &Harness, name: &str, project_id: Option<&str>) -> String {
    let id = make_conversation(harness, name, None).await;
    if let Some(project_id) = project_id {
        // Mirrors how the conversation service binds a project after resolving
        // a workspace path -- the column is set by update, never at insert.
        harness
            .conversations
            .update(
                OWNER_ID,
                &id,
                &ConversationRowUpdate {
                    project_id: Some(project_id.to_owned()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
    }
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
    // Running state comes from the task manager, not the row. The row column
    // is deliberately set the wrong way round here: "Busy" carries the
    // "finished" status while actually running, and "Idle" carries "pending"
    // while doing nothing. Reading the column would get both backwards, which
    // is precisely the defect this replaced.
    let harness = setup().await;
    let busy_id = make_conversation(&harness, "Busy", Some("finished")).await;
    let idle_id = make_conversation(&harness, "Idle", Some("pending")).await;

    harness.tasks.set_live(&[
        (busy_id.as_str(), Some(ConversationStatus::Running)),
        (idle_id.as_str(), Some(ConversationStatus::Finished)),
    ]);

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    let busy = page.entries.iter().find(|e| e.title == "Busy").unwrap();
    let idle = page.entries.iter().find(|e| e.title == "Idle").unwrap();
    assert!(busy.running, "a conversation the engine is running must be marked");
    assert!(
        !idle.running,
        "a finished task must not be marked, whatever the row says"
    );
    assert!(entry_label(busy).contains("running"));
}

#[tokio::test]
async fn a_conversation_with_no_task_is_never_marked_running() {
    // The regression that started this: rows are created with status
    // "pending", so reading the column marked every untouched conversation as
    // busy forever.
    let harness = setup().await;
    make_conversation(&harness, "Never run", Some("pending")).await;

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert!(!page.entries[0].running);
    assert!(!page_text(&page).contains("running"));
}

#[tokio::test]
async fn a_queued_turn_counts_as_running() {
    let harness = setup().await;
    let id = make_conversation(&harness, "Queued", Some("finished")).await;
    harness
        .tasks
        .set_live(&[(id.as_str(), Some(ConversationStatus::Pending))]);

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert!(page.entries[0].running, "work waiting to start is still work in flight");
}

#[tokio::test]
async fn a_warm_task_with_no_status_is_not_running() {
    // A live task is not the same as a running one -- an idle warm agent keeps
    // its task around, and marking it busy would make the list meaningless.
    let harness = setup().await;
    let id = make_conversation(&harness, "Warm", Some("finished")).await;
    harness.tasks.set_live(&[(id.as_str(), None)]);

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert!(!page.entries[0].running);
}

// ── /active-works ───────────────────────────────────────────────────

#[tokio::test]
async fn the_active_list_shows_only_what_is_running() {
    let harness = setup().await;
    let busy = make_conversation(&harness, "Busy", None).await;
    let idle = make_conversation(&harness, "Idle", None).await;
    harness.tasks.set_live(&[
        (busy.as_str(), Some(ConversationStatus::Running)),
        (idle.as_str(), Some(ConversationStatus::Finished)),
    ]);

    let entries = harness.directory.list_active(OWNER_ID, None).await.unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].title, "Busy");
    assert!(entries[0].running);
    assert_eq!(active_buttons(&entries)[0][0].action, "session.attach");
}

#[tokio::test]
async fn the_active_list_is_empty_rather_than_erroring_when_nothing_runs() {
    let harness = setup().await;
    make_conversation(&harness, "Idle", None).await;

    let entries = harness.directory.list_active(OWNER_ID, None).await.unwrap();

    assert!(entries.is_empty());
    assert_eq!(active_text(&entries), "Nothing is running right now.");
}

#[tokio::test]
async fn the_active_list_never_shows_another_owners_running_session() {
    // The task manager is global. Without the per-owner lookup this would leak
    // the title of someone else running work.
    let harness = setup().await;
    let other = harness.users.create_user("someone_else", "hash").await.unwrap();
    let theirs = generate_id();
    harness
        .conversations
        .create(&ConversationRow {
            id: theirs.clone(),
            user_id: other.id.clone(),
            name: "Their secret work".to_owned(),
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

    let mine = make_conversation(&harness, "Mine", None).await;
    harness.tasks.set_live(&[
        (mine.as_str(), Some(ConversationStatus::Running)),
        (theirs.as_str(), Some(ConversationStatus::Running)),
    ]);

    let entries = harness.directory.list_active(OWNER_ID, None).await.unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].title, "Mine");
}

#[tokio::test]
async fn a_task_whose_conversation_is_gone_is_skipped_not_fatal() {
    // A session can finish and be deleted between the task manager reporting
    // it and the row being read.
    let harness = setup().await;
    let mine = make_conversation(&harness, "Mine", None).await;
    harness.tasks.set_live(&[
        (mine.as_str(), Some(ConversationStatus::Running)),
        ("conversation_that_never_existed", Some(ConversationStatus::Running)),
    ]);

    let entries = harness.directory.list_active(OWNER_ID, None).await.unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].title, "Mine");
}

#[tokio::test]
async fn the_active_list_marks_the_one_this_chat_is_attached_to() {
    let harness = setup().await;
    let a = make_conversation(&harness, "Alpha", None).await;
    let b = make_conversation(&harness, "Beta", None).await;
    harness.tasks.set_live(&[
        (a.as_str(), Some(ConversationStatus::Running)),
        (b.as_str(), Some(ConversationStatus::Running)),
    ]);

    let entries = harness.directory.list_active(OWNER_ID, Some(&a)).await.unwrap();

    let alpha = entries.iter().find(|e| e.title == "Alpha").unwrap();
    let beta = entries.iter().find(|e| e.title == "Beta").unwrap();
    assert!(alpha.attached);
    assert!(!beta.attached);
}

#[tokio::test]
async fn the_active_list_keeps_a_stable_order() {
    // The task manager hands back an unordered map; a list that reshuffles
    // between refreshes moves buttons under the thumb.
    let harness = setup().await;
    let a = make_conversation(&harness, "Alpha", None).await;
    let b = make_conversation(&harness, "Beta", None).await;
    let c = make_conversation(&harness, "Gamma", None).await;
    harness.tasks.set_live(&[
        (c.as_str(), Some(ConversationStatus::Running)),
        (a.as_str(), Some(ConversationStatus::Running)),
        (b.as_str(), Some(ConversationStatus::Running)),
    ]);

    let first: Vec<String> = harness
        .directory
        .list_active(OWNER_ID, None)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.title)
        .collect();
    let second: Vec<String> = harness
        .directory
        .list_active(OWNER_ID, None)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.title)
        .collect();

    assert_eq!(first, vec!["Alpha", "Beta", "Gamma"]);
    assert_eq!(first, second);
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
// ── Projects ────────────────────────────────────────────────────────
//
// `/projects` is the structured route; `/sessions` stays a flat list of
// everything. These assert the two do not bleed into each other.

#[tokio::test]
async fn a_project_with_no_conversations_still_lists() {
    // The case a "derive projects from conversations" shortcut would lose --
    // and the one where you most want to start a first session.
    let harness = setup().await;
    make_project(&harness, "file:///ws/empty", "Empty", OWNER_ID).await;

    let projects = harness.directory.list_projects(OWNER_ID).await.unwrap();

    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "Empty");
    assert!(!project_buttons(&projects).is_empty());
}

#[tokio::test]
async fn opening_a_project_excludes_other_projects_and_loose_conversations() {
    let harness = setup().await;
    let mine = make_project(&harness, "file:///ws/mine", "Mine", OWNER_ID).await;
    let other = make_project(&harness, "file:///ws/other", "Other", OWNER_ID).await;

    let wanted = make_conversation_in(&harness, "In mine", Some(&mine)).await;
    make_conversation_in(&harness, "In other", Some(&other)).await;
    make_conversation_in(&harness, "Unassigned", None).await;

    let (page, scope) = harness
        .directory
        .list_project_page(OWNER_ID, &mine, None)
        .await
        .unwrap();

    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].conversation_id, wanted);
    assert_eq!(scope.name, "Mine");
    assert!(!scope.truncated);
}

#[tokio::test]
async fn sessions_still_lists_everything_regardless_of_project() {
    // The explicit requirement: /projects is additive, /sessions is unchanged.
    let harness = setup().await;
    let project = make_project(&harness, "file:///ws/p", "P", OWNER_ID).await;
    make_conversation_in(&harness, "In project", Some(&project)).await;
    make_conversation_in(&harness, "Loose", None).await;

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert_eq!(page.entries.len(), 2);
}

#[tokio::test]
async fn opening_an_unknown_project_errors_rather_than_showing_nothing() {
    // An empty list would be indistinguishable from a project with no
    // conversations, which is a meaningfully different thing.
    let harness = setup().await;

    let err = harness
        .directory
        .list_project_page(OWNER_ID, "project_does_not_exist", None)
        .await
        .expect_err("an unknown project must not read as empty");

    assert!(
        matches!(err, aionui_channel::error::ChannelError::SessionNotFound(ref id) if id == "project_does_not_exist"),
        "expected SessionNotFound, got {err:?}"
    );
}

#[tokio::test]
async fn another_owner_can_neither_list_nor_open_a_project() {
    let harness = setup().await;
    harness.users.create_user("intruder", "hash").await.unwrap();
    let intruder = harness
        .users
        .find_by_username("intruder")
        .await
        .unwrap()
        .expect("intruder exists")
        .id;

    let mine = make_project(&harness, "file:///ws/private", "Private", OWNER_ID).await;
    make_conversation_in(&harness, "Secret", Some(&mine)).await;

    assert!(
        harness.directory.list_projects(&intruder).await.unwrap().is_empty(),
        "another owner must not see the project"
    );

    let err = harness
        .directory
        .list_project_page(&intruder, &mine, None)
        .await
        .expect_err("another owner must not open the project");
    assert!(
        matches!(err, aionui_channel::error::ChannelError::SessionNotFound(_)),
        "expected SessionNotFound, got {err:?}"
    );
}

#[tokio::test]
async fn a_project_listing_says_so_when_it_truncates() {
    // Silence here would read as "this is everything", which is the one thing
    // a capped list must never imply.
    let harness = setup().await;
    let project = make_project(&harness, "file:///ws/busy", "Busy", OWNER_ID).await;
    for i in 0..(PROJECT_SESSIONS_LIMIT + 3) {
        make_conversation_in(&harness, &format!("c{i}"), Some(&project)).await;
    }

    let (page, scope) = harness
        .directory
        .list_project_page(OWNER_ID, &project, None)
        .await
        .unwrap();

    assert_eq!(page.entries.len() as u32, PROJECT_SESSIONS_LIMIT);
    assert!(scope.truncated);
    assert!(
        project_page_text(&page, &scope).contains("/sessions"),
        "a truncated listing must point at the full view"
    );
    assert!(
        page.next_cursor.is_none(),
        "a project listing does not page; a cursor would render a dead button"
    );
}

#[tokio::test]
async fn an_empty_project_offers_a_way_to_start() {
    let harness = setup().await;
    let project = make_project(&harness, "file:///ws/fresh", "Fresh", OWNER_ID).await;

    let (page, scope) = harness
        .directory
        .list_project_page(OWNER_ID, &project, None)
        .await
        .unwrap();

    assert!(page.entries.is_empty());
    let buttons = project_page_buttons(&page, &scope);
    assert_eq!(buttons.len(), 1, "an empty project still needs its start button");
    assert_eq!(buttons[0][0].action, "project.start");
}

#[tokio::test]
async fn the_attached_marker_shows_inside_a_project_too() {
    let harness = setup().await;
    let project = make_project(&harness, "file:///ws/p", "P", OWNER_ID).await;
    let id = make_conversation_in(&harness, "Current", Some(&project)).await;

    let (page, _scope) = harness
        .directory
        .list_project_page(OWNER_ID, &project, Some(&id))
        .await
        .unwrap();

    assert!(page.entries[0].attached);
    assert!(entry_label(&page.entries[0]).starts_with("\u{25cf} "));
}

#[tokio::test]
async fn a_project_workspace_resolves_to_a_filesystem_path() {
    // This is what makes a project-started session actually land in the
    // project: the conversation is bound by resolving this path.
    let harness = setup().await;
    let uri = if cfg!(windows) {
        "file:///C:/ws/demo"
    } else {
        "file:///ws/demo"
    };
    let project = make_project(&harness, uri, "Demo", OWNER_ID).await;

    let path = harness
        .directory
        .project_workspace_path(OWNER_ID, &project)
        .await
        .unwrap()
        .expect("a local folder must resolve to a path");

    assert!(path.contains("demo"), "unexpected workspace path: {path}");
    assert!(!path.starts_with("file:"), "the URI must not leak through as a path");
}

#[tokio::test]
async fn an_unknown_project_has_no_workspace_rather_than_a_wrong_one() {
    let harness = setup().await;
    assert!(
        harness
            .directory
            .project_workspace_path(OWNER_ID, "project_missing")
            .await
            .unwrap()
            .is_none()
    );
}

// ── Callback budget ─────────────────────────────────────────────────

#[tokio::test]
async fn project_callbacks_fit_the_telegram_budget() {
    // Telegram rejects callback_data over 64 bytes, and one over-long button
    // makes it refuse the whole message -- so this is not cosmetic.
    let harness = setup().await;
    let project = make_project(&harness, "file:///ws/p", "P", OWNER_ID).await;
    make_conversation_in(&harness, "One", Some(&project)).await;

    let projects = harness.directory.list_projects(OWNER_ID).await.unwrap();
    let (page, scope) = harness
        .directory
        .list_project_page(OWNER_ID, &project, None)
        .await
        .unwrap();

    let rows = project_buttons(&projects)
        .into_iter()
        .chain(project_page_buttons(&page, &scope))
        .flatten();

    for button in rows {
        // Mirrors format_callback_data in the telegram plugin:
        // "<category>:<action>:<k=v,...>".
        let params = button
            .params
            .as_ref()
            .map(|p| p.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(","))
            .unwrap_or_default();
        let encoded = if params.is_empty() {
            format!("system:{}", button.action)
        } else {
            format!("system:{}:{}", button.action, params)
        };
        assert!(
            encoded.len() <= 64,
            "callback data is {} bytes, over the 64-byte limit: {encoded}",
            encoded.len()
        );
    }
}

#[tokio::test]
async fn a_project_reference_survives_the_round_trip() {
    let id = "project_0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000";
    let reference = callback_project_ref(id);

    assert!(
        !reference.starts_with("project_"),
        "the prefix costs bytes we do not have"
    );
    assert_eq!(resolve_project_ref(&reference), id);
    // A button minted before the prefix was dropped must still resolve.
    assert_eq!(resolve_project_ref(id), id);
}

#[tokio::test]
async fn the_project_picker_says_something_useful_when_empty() {
    let harness = setup().await;
    let projects = harness.directory.list_projects(OWNER_ID).await.unwrap();

    assert!(projects.is_empty());
    assert!(project_buttons(&projects).is_empty());
    assert!(
        !project_list_text(&projects).is_empty(),
        "an empty picker must still explain itself"
    );
}
// ── Temp projects and branding ──────────────────────────────────────
//
// Every conversation gets a throwaway workspace, and each becomes a
// ProjectKind::Temp project. Listing them buries the real ones.

#[tokio::test]
async fn the_project_picker_hides_temp_projects() {
    let harness = setup().await;
    let real = make_project(&harness, "file:///ws/real", "Real work", OWNER_ID).await;
    make_project_of_kind(
        &harness,
        "file:///ws/tmp/pavii-temp-conv-1",
        "pavii-temp-conv-1",
        OWNER_ID,
        ProjectKind::Temp,
    )
    .await;

    let projects = harness.directory.list_projects(OWNER_ID).await.unwrap();

    assert_eq!(projects.len(), 1, "a temp workspace is not a project worth listing");
    assert_eq!(projects[0].project_id, real);
}

#[tokio::test]
async fn an_owner_with_only_temp_projects_sees_the_empty_picker() {
    // Must read as "no projects", not as a broken command.
    let harness = setup().await;
    for i in 0..3 {
        make_project_of_kind(
            &harness,
            &format!("file:///ws/tmp/pavii-temp-conv-{i}"),
            &format!("pavii-temp-conv-{i}"),
            OWNER_ID,
            ProjectKind::Temp,
        )
        .await;
    }

    let projects = harness.directory.list_projects(OWNER_ID).await.unwrap();

    assert!(projects.is_empty());
    assert!(project_buttons(&projects).is_empty());
    assert!(project_list_text(&projects).contains("No projects yet"));
}

#[tokio::test]
async fn hiding_temp_projects_leaves_the_real_ones_in_order() {
    let harness = setup().await;
    let first = make_project(&harness, "file:///ws/a", "Alpha", OWNER_ID).await;
    make_project_of_kind(
        &harness,
        "file:///ws/tmp/pavii-temp-x",
        "pavii-temp-x",
        OWNER_ID,
        ProjectKind::Temp,
    )
    .await;
    let second = make_project(&harness, "file:///ws/b", "Beta", OWNER_ID).await;

    let ids: Vec<String> = harness
        .directory
        .list_projects(OWNER_ID)
        .await
        .unwrap()
        .into_iter()
        .map(|p| p.project_id)
        .collect();

    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&first) && ids.contains(&second));
}

#[tokio::test]
async fn a_temp_project_can_still_be_opened_by_id() {
    // Only the *listing* hides it. An older button should not start erroring.
    let harness = setup().await;
    let temp = make_project_of_kind(
        &harness,
        "file:///ws/tmp/pavii-temp-conv-9",
        "pavii-temp-conv-9",
        OWNER_ID,
        ProjectKind::Temp,
    )
    .await;

    let (_page, scope) = harness
        .directory
        .list_project_page(OWNER_ID, &temp, None)
        .await
        .unwrap();

    assert_eq!(scope.project_id, temp);
}

#[tokio::test]
async fn a_legacy_conversation_title_is_branded_in_the_listing() {
    // Rows written before the rebrand still store the internal token; the
    // channel must not show it.
    let harness = setup().await;
    make_conversation(&harness, "tg-aionrs-123456", None).await;

    let page = harness.directory.list_page(OWNER_ID, None, None).await.unwrap();

    assert_eq!(page.entries[0].title, "tg-paviirs-123456");
    assert!(!entry_label(&page.entries[0]).contains("aionrs"));
}

#[tokio::test]
async fn a_legacy_title_is_branded_inside_a_project_and_in_the_active_list() {
    let harness = setup().await;
    let project = make_project(&harness, "file:///ws/p", "P", OWNER_ID).await;
    let id = make_conversation_in(&harness, "tg-aionrs-777", Some(&project)).await;
    harness
        .tasks
        .set_live(&[(id.as_str(), Some(ConversationStatus::Running))]);

    let (page, _scope) = harness
        .directory
        .list_project_page(OWNER_ID, &project, None)
        .await
        .unwrap();
    let active = harness.directory.list_active(OWNER_ID, None).await.unwrap();

    assert_eq!(page.entries[0].title, "tg-paviirs-777");
    assert_eq!(active[0].title, "tg-paviirs-777");
}

#[tokio::test]
async fn a_legacy_project_name_is_branded() {
    let harness = setup().await;
    make_project(&harness, "file:///ws/aionrs-legacy", "aionrs-legacy", OWNER_ID).await;

    let projects = harness.directory.list_projects(OWNER_ID).await.unwrap();

    assert_eq!(projects[0].name, "paviirs-legacy");
}
