//! Integration tests for answering agent permissions from a chat channel.
//!
//! Real in-memory SQLite and a real `ConversationService`; only the agent
//! itself is a double, and it *records* what it was told rather than accepting
//! silently. A test that only asserts "no error" would pass just as happily if
//! the answer never reached the agent at all — which is the exact failure this
//! feature exists to prevent.

use std::sync::{Arc, Mutex};

use aionui_ai_agent::agent_task::{AgentInstance, IAgentTask};
use aionui_ai_agent::types::{BuildTaskOptions, SendMessageData};
use aionui_ai_agent::{AgentError, AgentSendError, AgentStreamEvent, IMockAgent, IWorkerTaskManager};
use aionui_api_types::{AskQuestionAnswer, WebSocketMessage};
use aionui_common::{AgentKillReason, AgentType, ConversationStatus, TimestampMs, generate_id, now_ms};
use aionui_conversation::ConversationService;
use aionui_conversation::skill_resolver::{ResolvedAgentSkill, SkillResolver};
use aionui_db::models::ConversationRow;
use aionui_db::{
    IConversationRepository, SqliteAcpSessionRepository, SqliteAgentMetadataRepository, SqliteConversationRepository,
    init_database_memory,
};
use aionui_realtime::EventBroadcaster;
use async_trait::async_trait;
use tokio::sync::broadcast;

use aionui_channel::approval_service::{AnswerOutcome, ApprovalService};
use aionui_channel::approvals::{APPROVAL_TIMEOUT_MS, ApprovalChoice, ApprovalKind, pending};
use aionui_channel::stream_relay::{APPROVAL_CHOICE_KEY, APPROVAL_TICKET_KEY, approval_message};

const OWNER_ID: &str = "system_default_user";

// ── doubles ─────────────────────────────────────────────────────────

struct SilentBroadcaster;
impl EventBroadcaster for SilentBroadcaster {
    fn broadcast(&self, _event: WebSocketMessage<serde_json::Value>) {}
}

struct NoopSkillResolver;
#[async_trait]
impl SkillResolver for NoopSkillResolver {
    async fn resolve_skills(&self, _names: &[String]) -> Vec<ResolvedAgentSkill> {
        Vec::new()
    }
    async fn link_workspace_skills(
        &self,
        _workspace: &std::path::Path,
        _rel_dirs: &[&str],
        _skills: &[ResolvedAgentSkill],
    ) -> usize {
        0
    }
    async fn auto_inject_names(&self) -> Vec<String> {
        Vec::new()
    }
}

/// What the agent was actually told.
#[derive(Debug, Default)]
struct Delivered {
    confirms: Vec<(String, serde_json::Value, bool)>,
    asks: Vec<(String, Option<Vec<AskQuestionAnswer>>)>,
}

struct RecordingAgent {
    conversation_id: String,
    delivered: Arc<Mutex<Delivered>>,
    event_tx: broadcast::Sender<AgentStreamEvent>,
}

#[async_trait]
impl IAgentTask for RecordingAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Aionrs
    }
    fn conversation_id(&self) -> &str {
        &self.conversation_id
    }
    fn workspace(&self) -> &str {
        "/tmp/aionui-approvals-test"
    }
    fn status(&self) -> Option<ConversationStatus> {
        Some(ConversationStatus::Running)
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

impl IMockAgent for RecordingAgent {
    fn confirm(
        &self,
        _msg_id: &str,
        call_id: &str,
        data: serde_json::Value,
        always_allow: bool,
    ) -> Result<(), AgentError> {
        self.delivered
            .lock()
            .unwrap()
            .confirms
            .push((call_id.to_owned(), data, always_allow));
        Ok(())
    }

    fn answer_ask(&self, request_id: &str, answers: Option<Vec<AskQuestionAnswer>>) -> Result<(), AgentError> {
        self.delivered
            .lock()
            .unwrap()
            .asks
            .push((request_id.to_owned(), answers));
        Ok(())
    }
}

struct OneAgentManager {
    agent: AgentInstance,
    conversation_id: String,
}

#[async_trait]
impl IWorkerTaskManager for OneAgentManager {
    fn get_task(&self, conversation_id: &str) -> Option<AgentInstance> {
        (conversation_id == self.conversation_id).then(|| self.agent.clone())
    }
    async fn get_or_build_task(
        &self,
        _conversation_id: &str,
        _options: BuildTaskOptions,
    ) -> Result<AgentInstance, AgentError> {
        Ok(self.agent.clone())
    }
    fn kill(&self, _conversation_id: &str, _reason: Option<AgentKillReason>) -> Result<(), AgentError> {
        Ok(())
    }
    fn kill_and_wait(
        &self,
        _conversation_id: &str,
        _reason: Option<AgentKillReason>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(std::future::ready(()))
    }
    async fn clear(&self) {}
    fn active_count(&self) -> usize {
        1
    }
    fn active_conversation_ids(&self) -> Vec<String> {
        vec![self.conversation_id.clone()]
    }
    fn collect_idle(&self, _idle_threshold_ms: TimestampMs) -> Vec<String> {
        Vec::new()
    }
}

// ── harness ─────────────────────────────────────────────────────────

struct Harness {
    service: ApprovalService,
    delivered: Arc<Mutex<Delivered>>,
    conversation_id: String,
    _db: aionui_db::Database,
}

async fn setup() -> Harness {
    let db = init_database_memory().await.unwrap();
    let pool = db.pool().clone();
    let conversations: Arc<dyn IConversationRepository> = Arc::new(SqliteConversationRepository::new(pool.clone()));

    let conversation_id = generate_id();
    conversations
        .create(&ConversationRow {
            id: conversation_id.clone(),
            user_id: OWNER_ID.to_owned(),
            name: "Approval test".to_owned(),
            r#type: "aionrs".to_owned(),
            extra: "{}".to_owned(),
            model: None,
            status: Some("running".to_owned()),
            source: Some("telegram".to_owned()),
            channel_chat_id: Some("chat_1".to_owned()),
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

    let delivered = Arc::new(Mutex::new(Delivered::default()));
    let (event_tx, _) = broadcast::channel(4);
    let agent = AgentInstance::Mock(Arc::new(RecordingAgent {
        conversation_id: conversation_id.clone(),
        delivered: Arc::clone(&delivered),
        event_tx,
    }));
    let tasks: Arc<dyn IWorkerTaskManager> = Arc::new(OneAgentManager {
        agent,
        conversation_id: conversation_id.clone(),
    });

    let conversation_svc = Arc::new(ConversationService::new(
        std::env::temp_dir(),
        Arc::new(SilentBroadcaster),
        Arc::new(NoopSkillResolver),
        Arc::clone(&tasks),
        Arc::new(SqliteConversationRepository::new(pool.clone())),
        Arc::new(SqliteAgentMetadataRepository::new(pool.clone())),
        Arc::new(SqliteAcpSessionRepository::new(pool)),
    ));

    Harness {
        service: ApprovalService::new(conversation_svc, tasks),
        delivered,
        conversation_id,
        _db: db,
    }
}

fn choices() -> Vec<ApprovalChoice> {
    vec![
        ApprovalChoice {
            label: "Allow".into(),
            value: "allow".into(),
            denies: false,
        },
        ApprovalChoice {
            label: "Allow Always".into(),
            value: "allow_always".into(),
            denies: false,
        },
        ApprovalChoice {
            label: "Reject".into(),
            value: "reject".into(),
            denies: true,
        },
    ]
}

fn park(harness: &Harness, kind: ApprovalKind, choices: Vec<ApprovalChoice>) -> String {
    harness
        .service
        .register(pending(
            "call-1",
            &harness.conversation_id,
            "session-1",
            "chat_1",
            "telegram",
            kind,
            "Which one?",
            "run rm -rf /tmp/build",
            choices,
        ))
        .ticket
}

// ── delivery ────────────────────────────────────────────────────────

#[tokio::test]
async fn allowing_reaches_the_agent_with_the_chosen_option() {
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());

    let outcome = harness.service.answer(OWNER_ID, &ticket, 0).await.unwrap();

    assert!(matches!(outcome, AnswerOutcome::Delivered { .. }));
    let delivered = harness.delivered.lock().unwrap();
    assert_eq!(delivered.confirms.len(), 1, "the answer must reach the agent");
    assert_eq!(delivered.confirms[0].0, "call-1");
    assert_eq!(delivered.confirms[0].1, serde_json::Value::String("allow".into()));
    assert!(
        !delivered.confirms[0].2,
        "always_allow must not be forced; the option carries its own id"
    );
}

#[tokio::test]
async fn denying_reaches_the_agent_as_the_reject_option() {
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());

    harness.service.answer(OWNER_ID, &ticket, 2).await.unwrap();

    let delivered = harness.delivered.lock().unwrap();
    assert_eq!(delivered.confirms[0].1, serde_json::Value::String("reject".into()));
}

#[tokio::test]
async fn allow_always_is_sent_as_its_own_option_not_as_a_flag() {
    // Forcing `always_allow` would override an explicit "just this once".
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());

    harness.service.answer(OWNER_ID, &ticket, 1).await.unwrap();

    let delivered = harness.delivered.lock().unwrap();
    assert_eq!(
        delivered.confirms[0].1,
        serde_json::Value::String("allow_always".into())
    );
    assert!(!delivered.confirms[0].2);
}

#[tokio::test]
async fn a_question_answer_travels_the_ask_channel_not_the_confirm_one() {
    // Sending it down the confirm path silently drops it and leaves the agent
    // blocked.
    let harness = setup().await;
    let ticket = park(
        &harness,
        ApprovalKind::Ask,
        vec![ApprovalChoice {
            label: "Postgres".into(),
            value: "Postgres".into(),
            denies: false,
        }],
    );

    harness.service.answer(OWNER_ID, &ticket, 0).await.unwrap();

    let delivered = harness.delivered.lock().unwrap();
    assert!(delivered.confirms.is_empty(), "a question must not use confirm");
    assert_eq!(delivered.asks.len(), 1);
    let (request_id, answers) = &delivered.asks[0];
    assert_eq!(request_id, "call-1");
    let answers = answers.as_ref().expect("an answered question carries answers");
    assert_eq!(answers[0].question, "Which one?");
    assert_eq!(answers[0].labels, vec!["Postgres".to_owned()]);
}

// ── resolving exactly once ──────────────────────────────────────────

#[tokio::test]
async fn a_double_tap_sends_one_decision() {
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());

    let first = harness.service.answer(OWNER_ID, &ticket, 0).await.unwrap();
    let second = harness.service.answer(OWNER_ID, &ticket, 2).await.unwrap();

    assert!(matches!(first, AnswerOutcome::Delivered { .. }));
    assert_eq!(second, AnswerOutcome::AlreadyResolved);
    assert_eq!(
        harness.delivered.lock().unwrap().confirms.len(),
        1,
        "the agent must not receive two decisions for one request"
    );
}

#[tokio::test]
async fn an_unknown_ticket_is_reported_rather_than_delivered() {
    let harness = setup().await;

    let outcome = harness.service.answer(OWNER_ID, "never-issued", 0).await.unwrap();

    assert_eq!(outcome, AnswerOutcome::AlreadyResolved);
    assert!(harness.delivered.lock().unwrap().confirms.is_empty());
}

#[tokio::test]
async fn an_out_of_range_choice_does_not_consume_the_request() {
    // A malformed button must not cancel a legitimate approval; the real
    // buttons must still work afterwards.
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());

    let bad = harness.service.answer(OWNER_ID, &ticket, 99).await.unwrap();

    assert_eq!(bad, AnswerOutcome::UnknownChoice);
    assert_eq!(harness.service.pending_count(), 1, "the request must still be pending");

    let good = harness.service.answer(OWNER_ID, &ticket, 0).await.unwrap();
    assert!(matches!(good, AnswerOutcome::Delivered { .. }));
}

#[tokio::test]
async fn two_requests_in_one_chat_are_answered_independently() {
    let harness = setup().await;
    let first = park(&harness, ApprovalKind::Permission, choices());
    let second = park(&harness, ApprovalKind::Permission, choices());

    assert_ne!(first, second, "two requests must not share a ticket");
    harness.service.answer(OWNER_ID, &first, 0).await.unwrap();

    assert_eq!(harness.service.pending_count(), 1);
    assert!(harness.service.get(&second).is_some());
}

// ── expiry ──────────────────────────────────────────────────────────

#[tokio::test]
async fn an_unanswered_request_expires_as_denied_and_unblocks_the_agent() {
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());

    let swept = harness
        .service
        .sweep_expired(OWNER_ID, now_ms() + APPROVAL_TIMEOUT_MS)
        .await;

    assert_eq!(swept.len(), 1);
    assert_eq!(swept[0].ticket, ticket);
    let delivered = harness.delivered.lock().unwrap();
    assert_eq!(
        delivered.confirms[0].1,
        serde_json::Value::String("reject".into()),
        "expiry must deny, never allow"
    );
}

#[tokio::test]
async fn a_fresh_request_survives_a_sweep() {
    let harness = setup().await;
    park(&harness, ApprovalKind::Permission, choices());

    let swept = harness.service.sweep_expired(OWNER_ID, now_ms()).await;

    assert!(swept.is_empty());
    assert_eq!(harness.service.pending_count(), 1);
    assert!(harness.delivered.lock().unwrap().confirms.is_empty());
}

#[tokio::test]
async fn answering_after_expiry_authorizes_nothing() {
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());
    harness
        .service
        .sweep_expired(OWNER_ID, now_ms() + APPROVAL_TIMEOUT_MS)
        .await;

    let outcome = harness.service.answer(OWNER_ID, &ticket, 0).await.unwrap();

    assert_eq!(outcome, AnswerOutcome::AlreadyResolved);
    let delivered = harness.delivered.lock().unwrap();
    assert_eq!(delivered.confirms.len(), 1, "only the expiry deny should have landed");
    assert_eq!(delivered.confirms[0].1, serde_json::Value::String("reject".into()));
}

#[tokio::test]
async fn an_expired_question_is_dismissed_rather_than_answered_for_the_user() {
    // A question has no "refuse" among its answers; picking one would put words
    // in the user's mouth.
    let harness = setup().await;
    park(
        &harness,
        ApprovalKind::Ask,
        vec![ApprovalChoice {
            label: "Postgres".into(),
            value: "Postgres".into(),
            denies: false,
        }],
    );

    harness
        .service
        .sweep_expired(OWNER_ID, now_ms() + APPROVAL_TIMEOUT_MS)
        .await;

    let delivered = harness.delivered.lock().unwrap();
    assert_eq!(delivered.asks.len(), 1);
    assert!(
        delivered.asks[0].1.is_none(),
        "a dismissed card sends no answers, not an invented one"
    );
}

#[tokio::test]
async fn a_dead_session_drops_its_requests_without_answering() {
    let harness = setup().await;
    park(&harness, ApprovalKind::Permission, choices());

    let dropped = harness.service.drop_session("session-1");

    assert_eq!(dropped.len(), 1);
    assert_eq!(harness.service.pending_count(), 0);
    assert!(
        harness.delivered.lock().unwrap().confirms.is_empty(),
        "the agent is gone; there is nobody to answer"
    );
}

// ── rendering ───────────────────────────────────────────────────────

#[tokio::test]
async fn approval_buttons_fit_the_telegram_callback_budget() {
    // One over-long button makes Telegram reject the whole message, which would
    // leave the session blocked with no visible prompt at all.
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());
    let parked = harness.service.get(&ticket).unwrap();

    let message = approval_message(&parked);

    for row in message.buttons.as_ref().expect("an approval needs buttons") {
        for button in row {
            let params = button
                .params
                .as_ref()
                .map(|p| p.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(","))
                .unwrap_or_default();
            let encoded = format!("chat:{}:{}", button.action, params);
            assert!(
                encoded.len() <= 64,
                "callback data is {} bytes: {encoded}",
                encoded.len()
            );
        }
    }
}

#[tokio::test]
async fn a_long_answer_label_still_fits_because_the_index_travels() {
    // An AskUserQuestion option value is a whole answer; sending the value in
    // the callback would blow the budget on the first realistic question.
    let harness = setup().await;
    let long = "Use the managed Postgres instance in eu-west-1 with read replicas enabled".to_owned();
    let ticket = park(
        &harness,
        ApprovalKind::Ask,
        vec![ApprovalChoice {
            label: long.clone(),
            value: long,
            denies: false,
        }],
    );
    let parked = harness.service.get(&ticket).unwrap();

    let message = approval_message(&parked);
    let button = &message.buttons.as_ref().unwrap()[0][0];
    let params = button.params.as_ref().unwrap();

    assert_eq!(params.get(APPROVAL_CHOICE_KEY).unwrap(), "0");
    assert_eq!(params.get(APPROVAL_TICKET_KEY).unwrap(), &parked.ticket);
    let encoded = format!("chat:{}:t={},v=0", button.action, parked.ticket);
    assert!(encoded.len() <= 64, "{encoded}");
}

#[tokio::test]
async fn the_deny_button_is_rendered_last() {
    // A thumb reaching for the bottom of the keyboard should not authorize
    // something by muscle memory.
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());
    let parked = harness.service.get(&ticket).unwrap();

    let message = approval_message(&parked);
    let labels: Vec<&str> = message
        .buttons
        .as_ref()
        .unwrap()
        .iter()
        .map(|row| row[0].label.as_str())
        .collect();

    assert_eq!(labels.last(), Some(&"Reject"));
}

#[tokio::test]
async fn the_prompt_says_what_is_being_asked() {
    let harness = setup().await;
    let ticket = park(&harness, ApprovalKind::Permission, choices());
    let parked = harness.service.get(&ticket).unwrap();

    let text = approval_message(&parked).text.expect("an approval needs text");

    assert!(text.contains("rm -rf /tmp/build"), "unexpected prompt: {text}");
}
