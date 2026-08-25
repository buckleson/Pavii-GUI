//! `GET /api/usage/ledger` — the per-day token ledger the desktop profile page
//! reads.
//!
//! Driven through the real router and the real auth middleware so the three
//! things that can silently break the profile page are all covered: the wire
//! casing (`byModel` / `byBackend`), the row-to-day folding, and the fact that
//! the ledger is scoped to the token's user and to nobody else's.

use std::sync::Arc;

use aionui_ai_agent::{ActiveLeaseRegistry, AgentError, IWorkerTaskManager};
use aionui_api_types::WebSocketMessage;
use aionui_auth::{AuthIdentityMode, AuthState, JwtService, auth_middleware};
use aionui_common::{AgentKillReason, TimestampMs};
use aionui_conversation::skill_resolver::SkillResolver;
use aionui_conversation::{ConversationRouterState, ConversationService, conversation_ops_routes};
use aionui_db::{
    DbError, IUsageLedgerRepository, IUserRepository, SqliteConversationRepository, SqliteUsageLedgerRepository,
    SqliteUserRepository, TurnTokens, UsageDayTotals, UsageEntry, init_database_memory,
};
use aionui_realtime::EventBroadcaster;
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use axum::middleware;
use serde_json::{Value, json};
use tower::ServiceExt;

// ── Test doubles ───────────────────────────────────────────────────

struct NoopBroadcaster;

impl EventBroadcaster for NoopBroadcaster {
    fn broadcast(&self, _event: WebSocketMessage<serde_json::Value>) {}
}

struct NoopTaskManager;

#[async_trait::async_trait]
impl IWorkerTaskManager for NoopTaskManager {
    fn get_task(&self, _: &str) -> Option<aionui_ai_agent::AgentInstance> {
        None
    }

    async fn get_or_build_task(
        &self,
        _: &str,
        _: aionui_ai_agent::types::BuildTaskOptions,
    ) -> Result<aionui_ai_agent::AgentInstance, AgentError> {
        Err(AgentError::internal("noop"))
    }

    fn kill(&self, _: &str, _: Option<AgentKillReason>) -> Result<(), AgentError> {
        Ok(())
    }

    fn kill_and_wait(
        &self,
        _: &str,
        _: Option<AgentKillReason>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(std::future::ready(()))
    }

    async fn clear(&self) {}

    fn active_count(&self) -> usize {
        0
    }

    fn collect_idle(&self, _: TimestampMs) -> Vec<String> {
        vec![]
    }
}

struct EmptySkillResolver;

#[async_trait::async_trait]
impl SkillResolver for EmptySkillResolver {
    async fn auto_inject_names(&self) -> Vec<String> {
        Vec::new()
    }

    async fn resolve_skills(&self, _names: &[String]) -> Vec<aionui_extension::ResolvedAgentSkill> {
        Vec::new()
    }

    async fn link_workspace_skills(
        &self,
        _workspace: &std::path::Path,
        _rel_dirs: &[&str],
        _skills: &[aionui_extension::ResolvedAgentSkill],
    ) -> usize {
        0
    }
}

/// A ledger whose read side always fails, with a message that must never reach
/// the client.
struct ExplodingLedger;

const LEAKY_DB_DETAIL: &str = "no such table: usage_ledger_days at C:/secret/aionui.db";

#[async_trait::async_trait]
impl IUsageLedgerRepository for ExplodingLedger {
    async fn add_usage(&self, _entry: UsageEntry<'_>) -> Result<(), DbError> {
        Ok(())
    }

    async fn list_days(&self, _user_id: &str) -> Result<Vec<UsageDayTotals>, DbError> {
        Err(DbError::Init(LEAKY_DB_DETAIL.to_owned()))
    }
}

// ── Harness ────────────────────────────────────────────────────────

const JWT_SECRET: &str = "usage_ledger_endpoint_test_secret";
const ALPHA_ID: &str = "system_default_user";

struct Harness {
    router: Router,
    ledger: Arc<SqliteUsageLedgerRepository>,
    alpha_token: String,
    beta_token: String,
    beta_id: String,
}

impl Harness {
    /// The router as the app wires it: ops routes behind the JWT auth
    /// middleware, in the multi-user identity mode. Local mode would inject a
    /// fixed default user and defeat every isolation assertion here.
    async fn new() -> Self {
        Self::with_ledger(None).await
    }

    async fn with_ledger(override_ledger: Option<Arc<dyn IUsageLedgerRepository>>) -> Self {
        let db = init_database_memory().await.unwrap();

        let user_repo = Arc::new(SqliteUserRepository::new(db.pool().clone()));
        let beta = user_repo.create_user("beta", "not-a-real-hash").await.unwrap();

        let jwt_service = Arc::new(JwtService::new(JWT_SECRET.to_owned()));
        let alpha_token = jwt_service.sign(ALPHA_ID, ALPHA_ID).unwrap();
        let beta_token = jwt_service.sign(&beta.id, "beta").unwrap();

        let ledger = Arc::new(SqliteUsageLedgerRepository::new(db.pool().clone()));
        let service = ConversationService::new(
            std::env::temp_dir(),
            Arc::new(NoopBroadcaster),
            Arc::new(EmptySkillResolver),
            Arc::new(NoopTaskManager),
            Arc::new(SqliteConversationRepository::new(db.pool().clone())),
            Arc::new(aionui_db::SqliteAgentMetadataRepository::new(db.pool().clone())),
            Arc::new(aionui_db::SqliteAcpSessionRepository::new(db.pool().clone())),
        );

        let state = ConversationRouterState {
            service,
            task_manager: Arc::new(NoopTaskManager),
            active_leases: Arc::new(ActiveLeaseRegistry::new()),
            usage_ledger: override_ledger.unwrap_or_else(|| ledger.clone() as Arc<dyn IUsageLedgerRepository>),
        };

        let auth_state = AuthState {
            jwt_service,
            user_repo: user_repo as Arc<dyn IUserRepository>,
            identity_mode: AuthIdentityMode::UserSession,
            runtime_token_verifier: None,
        };

        let router =
            conversation_ops_routes(state).route_layer(middleware::from_fn_with_state(auth_state, auth_middleware));

        Self {
            router,
            ledger,
            alpha_token,
            beta_token,
            beta_id: beta.id,
        }
    }

    async fn record(&self, user_id: &str, day: &str, agent_kind: &str, model: &str, tokens: i64, turns: i64) {
        self.ledger
            .add_usage(UsageEntry {
                user_id,
                day,
                agent_kind,
                model,
                tokens: TurnTokens::unattributed(tokens),
                turns,
            })
            .await
            .unwrap();
    }

    async fn get_ledger(&self, token: &str) -> (StatusCode, Value) {
        self.send(
            Request::get("/api/usage/ledger")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    async fn send(&self, request: Request<Body>) -> (StatusCode, Value) {
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
}

/// The `days` map of a successful response.
fn days(body: &Value) -> &serde_json::Map<String, Value> {
    body["data"]["days"]
        .as_object()
        .unwrap_or_else(|| panic!("no days object in {body}"))
}

// ── Happy path: shape and casing on the wire ───────────────────────

#[tokio::test]
async fn the_ledger_reports_a_recorded_day_with_camel_case_breakdowns() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;

    let (status, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["days"]["2026-08-20"]["byModel"]["sonnet"], json!(100));
    assert_eq!(body["data"]["days"]["2026-08-20"]["byBackend"]["claude"], json!(100));
}

#[tokio::test]
async fn the_ledger_never_sends_snake_case_breakdown_keys() {
    // The desktop reads `byModel` / `byBackend`
    // (packages/desktop/src/renderer/pages/profile/profileStats.ts:150-151);
    // snake_case would render every model and backend total as zero instead of
    // failing the request.
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    let day = body["data"]["days"]["2026-08-20"].as_object().unwrap();
    assert!(
        !day.contains_key("by_model") && !day.contains_key("by_backend"),
        "{body}"
    );
}

#[tokio::test]
async fn the_ledger_reports_the_day_total_and_turn_count() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 2).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(body["data"]["days"]["2026-08-20"]["tokens"], json!(100));
    assert_eq!(body["data"]["days"]["2026-08-20"]["turns"], json!(2));
}

#[tokio::test]
async fn the_ledger_keys_each_recorded_day_separately() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-19", "claude", "sonnet", 40, 1).await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 60, 1).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(days(&body).len(), 2, "{body}");
    assert_eq!(body["data"]["days"]["2026-08-19"]["tokens"], json!(40));
    assert_eq!(body["data"]["days"]["2026-08-20"]["tokens"], json!(60));
}

#[tokio::test]
async fn a_day_spanning_several_backends_folds_into_one_entry() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "opus", 50, 1).await;
    h.record(ALPHA_ID, "2026-08-20", "codex", "gpt-5", 25, 1).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(days(&body).len(), 1, "{body}");
    assert_eq!(body["data"]["days"]["2026-08-20"]["tokens"], json!(175));
    assert_eq!(body["data"]["days"]["2026-08-20"]["turns"], json!(3));
}

#[tokio::test]
async fn a_backend_used_with_two_models_sums_into_one_backend_bucket() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "opus", 50, 1).await;
    h.record(ALPHA_ID, "2026-08-20", "codex", "gpt-5", 25, 1).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    let by_backend = &body["data"]["days"]["2026-08-20"]["byBackend"];
    assert_eq!(by_backend["claude"], json!(150));
    assert_eq!(by_backend["codex"], json!(25));
}

#[tokio::test]
async fn each_model_keeps_its_own_bucket_within_a_day() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "opus", 50, 1).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    let by_model = body["data"]["days"]["2026-08-20"]["byModel"].as_object().unwrap();
    assert_eq!(by_model.len(), 2, "{body}");
    assert_eq!(by_model["opus"], json!(50));
}

// ── Boundaries ─────────────────────────────────────────────────────

#[tokio::test]
async fn a_user_with_no_recorded_usage_gets_an_empty_days_object() {
    // Not null and not an error: the profile page iterates this map directly.
    let h = Harness::new().await;

    let (status, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"], json!({ "days": {} }));
}

#[tokio::test]
async fn a_backend_that_reported_no_model_is_left_out_of_the_model_breakdown() {
    // The ledger stores an unknown model as an empty string so the primary key
    // behaves (crates/aionui-db/migrations/040_usage_ledger.sql); it must not
    // surface as a real model.
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "aionrs", "", 80, 1).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(body["data"]["days"]["2026-08-20"]["byModel"], json!({}));
    assert_eq!(body["data"]["days"]["2026-08-20"]["byBackend"]["aionrs"], json!(80));
}

#[tokio::test]
async fn a_signed_correction_lowers_the_day_total_without_adding_a_turn() {
    // Corrections arrive as a difference with `turns: 0`
    // (crates/aionui-db/src/repository/usage_ledger.rs:74-77).
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", -40, 0).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(body["data"]["days"]["2026-08-20"]["tokens"], json!(60));
    assert_eq!(body["data"]["days"]["2026-08-20"]["turns"], json!(1));
}

// ── Security: cross-user isolation ─────────────────────────────────

#[tokio::test]
async fn one_users_ledger_never_contains_another_users_day() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;
    h.record(&h.beta_id, "2026-08-21", "codex", "gpt-5", 7, 1).await;

    let (status, body) = h.get_ledger(&h.beta_token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(days(&body).keys().collect::<Vec<_>>(), vec!["2026-08-21"], "{body}");
}

#[tokio::test]
async fn one_users_ledger_never_contains_another_users_tokens_on_a_shared_day() {
    // Same calendar day for both users — the folding must not merge them.
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;
    h.record(&h.beta_id, "2026-08-20", "codex", "gpt-5", 7, 1).await;

    let (_, body) = h.get_ledger(&h.beta_token).await;

    assert_eq!(body["data"]["days"]["2026-08-20"]["tokens"], json!(7));
    assert_eq!(body["data"]["days"]["2026-08-20"]["byBackend"], json!({ "codex": 7 }));
}

#[tokio::test]
async fn two_tokens_get_two_different_ledgers_from_the_same_router() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;
    h.record(&h.beta_id, "2026-08-20", "codex", "gpt-5", 7, 1).await;

    let (_, alpha) = h.get_ledger(&h.alpha_token).await;
    let (_, beta) = h.get_ledger(&h.beta_token).await;

    assert_eq!(alpha["data"]["days"]["2026-08-20"]["tokens"], json!(100));
    assert_eq!(beta["data"]["days"]["2026-08-20"]["tokens"], json!(7));
}

// ── Security: authentication ───────────────────────────────────────

#[tokio::test]
async fn an_unauthenticated_request_is_rejected_with_401() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;

    let (status, body) = h
        .send(Request::get("/api/usage/ledger").body(Body::empty()).unwrap())
        .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], "UNAUTHORIZED");
}

#[tokio::test]
async fn an_unauthenticated_request_returns_no_ledger_data() {
    let h = Harness::new().await;
    h.record(ALPHA_ID, "2026-08-20", "claude", "sonnet", 100, 1).await;

    let (_, body) = h
        .send(Request::get("/api/usage/ledger").body(Body::empty()).unwrap())
        .await;

    assert_eq!(body["success"], json!(false));
    assert!(body.get("data").is_none(), "{body}");
}

#[tokio::test]
async fn a_token_signed_with_the_wrong_secret_is_rejected_with_401() {
    let h = Harness::new().await;
    let forged = JwtService::new("some-other-secret".to_owned())
        .sign(ALPHA_ID, ALPHA_ID)
        .unwrap();

    let (status, body) = h.get_ledger(&forged).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], "UNAUTHORIZED");
}

#[tokio::test]
async fn a_token_for_an_unknown_user_is_rejected_with_401() {
    let h = Harness::new().await;
    let orphan = JwtService::new(JWT_SECRET.to_owned())
        .sign("user_does_not_exist", "ghost")
        .unwrap();

    let (status, body) = h.get_ledger(&orphan).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], "UNAUTHORIZED");
}

// ── Bad path: repository failure ───────────────────────────────────

#[tokio::test]
async fn a_ledger_read_failure_answers_500_with_the_internal_error_code() {
    let h = Harness::with_ledger(Some(Arc::new(ExplodingLedger))).await;

    let (status, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["code"], "INTERNAL_ERROR");
}

#[tokio::test]
async fn a_ledger_read_failure_does_not_leak_the_database_detail() {
    let h = Harness::with_ledger(Some(Arc::new(ExplodingLedger))).await;

    let (_, body) = h.get_ledger(&h.alpha_token).await;

    assert_eq!(body["error"], "Internal server error.");
    assert!(!body.to_string().contains("usage_ledger_days"), "{body}");
}

// ── Bad path: wrong method ─────────────────────────────────────────

#[tokio::test]
async fn the_ledger_path_does_not_accept_a_post() {
    let h = Harness::new().await;

    let response = h
        .router
        .clone()
        .oneshot(
            Request::post("/api/usage/ledger")
                .header(header::AUTHORIZATION, format!("Bearer {}", h.alpha_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}
