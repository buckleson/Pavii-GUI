//! E2E tests for the external-session import endpoints:
//! `PUT /api/conversations/{id}/backend-session`,
//! `POST /api/conversations/{id}/messages/import`, and
//! `GET /api/conversations/sessions-index`, plus the `.pavii/sessions.json`
//! index the create and bind paths write into a user-chosen workspace.
//!
//! Seed rows used (migration 001): `2d23ff1c` = Claude Code (backend
//! `claude`) and `8e1acf31` = Codex CLI (backend `codex`).

mod common;

use aionui_db::NewMessageParams;
use aionui_db::models::ConversationRow;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use aionui_app::AppServices;
use common::{body_json, build_app, get_with_token, json_with_token, setup_and_login};

const CLAUDE_ID: &str = "2d23ff1c";
const CODEX_ID: &str = "8e1acf31";
const UUID: &str = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";
const PASSWORD: &str = "StrongP@ss1";

// ── Helpers ───────────────────────────────────────────────────────────

async fn create_conversation(app: &axum::Router, token: &str, csrf: &str, body: Value) -> Value {
    let req = json_with_token("POST", "/api/conversations", body, token, csrf);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "conversation create should succeed");
    body_json(resp).await["data"].clone()
}

async fn create_claude(app: &axum::Router, token: &str, csrf: &str, workspace: Option<&std::path::Path>) -> Value {
    let mut extra = json!({ "backend": "claude", "agent_id": CLAUDE_ID, "agent_source": "builtin" });
    if let Some(workspace) = workspace {
        extra["workspace"] = Value::String(workspace.to_string_lossy().into_owned());
    }
    create_conversation(
        app,
        token,
        csrf,
        json!({ "type": "acp", "name": "Claude chat", "extra": extra }),
    )
    .await
}

fn id_of(conversation: &Value) -> String {
    conversation["id"].as_str().unwrap().to_owned()
}

async fn put_backend_session(
    app: &axum::Router,
    token: &str,
    csrf: &str,
    conversation_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = json_with_token(
        "PUT",
        &format!("/api/conversations/{conversation_id}/backend-session"),
        body,
        token,
        csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    (status, body_json(resp).await)
}

async fn post_import(
    app: &axum::Router,
    token: &str,
    csrf: &str,
    conversation_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = json_with_token(
        "POST",
        &format!("/api/conversations/{conversation_id}/messages/import"),
        body,
        token,
        csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    (status, body_json(resp).await)
}

async fn sessions_index(app: &axum::Router, token: &str) -> Vec<Value> {
    let resp = app
        .clone()
        .oneshot(get_with_token("/api/conversations/sessions-index", token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["success"], true);
    body["data"].as_array().expect("sessions index is an array").clone()
}

async fn index_entry(app: &axum::Router, token: &str, conversation_id: &str) -> Value {
    sessions_index(app, token)
        .await
        .into_iter()
        .find(|entry| entry["conversation_id"] == conversation_id)
        .unwrap_or_else(|| panic!("conversation {conversation_id} missing from sessions index"))
}

fn assert_error(status: StatusCode, body: &Value, expected_status: StatusCode, code: &str, message: &str) {
    assert_eq!(status, expected_status, "unexpected status, body: {body}");
    assert_eq!(body["success"], false);
    assert_eq!(body["code"], code, "body: {body}");
    assert_eq!(body["error"], message, "body: {body}");
}

/// Stored message rows for a conversation, oldest first.
async fn message_rows(services: &AppServices, conversation_id: &str) -> Vec<(String, String, String, String, i64)> {
    sqlx::query_as::<_, (String, String, String, String, i64)>(
        "SELECT type, content, position, status, created_at FROM messages \
         WHERE conversation_id = ? ORDER BY created_at, id",
    )
    .bind(conversation_id)
    .fetch_all(services.database.pool())
    .await
    .unwrap()
}

async fn user_id(services: &AppServices, username: &str) -> String {
    sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
        .bind(username)
        .fetch_one(services.database.pool())
        .await
        .unwrap()
}

fn read_pavii_sessions(workspace: &std::path::Path) -> Value {
    let bytes = std::fs::read(workspace.join(".pavii").join("sessions.json")).expect("sessions.json should exist");
    serde_json::from_slice(&bytes).unwrap()
}

fn msg(role: &str, text: &str, created_at: i64) -> Value {
    json!({ "role": role, "text": text, "created_at": created_at })
}

// ── PUT /backend-session ──────────────────────────────────────────────

#[tokio::test]
async fn bind_backend_session_sets_anchor_and_updates_pavii_index() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let workspace = tempfile::tempdir().unwrap();
    let conversation = create_claude(&app, &token, &csrf, Some(workspace.path())).await;
    let id = id_of(&conversation);

    // Creation alone indexes the conversation with no anchor yet.
    let file = read_pavii_sessions(workspace.path());
    assert_eq!(file["version"], 1);
    assert_eq!(file["sessions"][0]["conversationId"], id.as_str());
    assert_eq!(file["sessions"][0]["backendSessionId"], Value::Null);
    assert_eq!(file["sessions"][0]["source"], "pavii");
    assert_eq!(
        std::fs::read_to_string(workspace.path().join(".pavii").join(".gitignore")).unwrap(),
        "*\n"
    );
    assert_eq!(index_entry(&app, &token, &id).await["backend_session_id"], Value::Null);

    // Surrounding whitespace is trimmed before validation and storage.
    let (status, body) =
        put_backend_session(&app, &token, &csrf, &id, json!({ "session_id": format!("  {UUID}  ") })).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["success"], true);

    let entry = index_entry(&app, &token, &id).await;
    assert_eq!(entry["backend_session_id"], UUID);
    assert_eq!(entry["agent_id"], CLAUDE_ID);
    assert_eq!(entry["backend"], "claude");
    assert_eq!(entry["workspace"], conversation["extra"]["workspace"]);

    let file = read_pavii_sessions(workspace.path());
    let sessions = file["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 1, "bind must upsert, not append: {file}");
    assert_eq!(sessions[0]["backendSessionId"], UUID);
    assert_eq!(sessions[0]["agentId"], CLAUDE_ID);
}

#[tokio::test]
async fn bind_backend_session_accepts_non_uuid_for_non_claude_backend() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let conversation = create_conversation(
        &app,
        &token,
        &csrf,
        json!({ "type": "acp", "extra": { "backend": "codex", "agent_id": CODEX_ID } }),
    )
    .await;
    let id = id_of(&conversation);

    let (status, body) =
        put_backend_session(&app, &token, &csrf, &id, json!({ "session_id": "codex-thread-42" })).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(
        index_entry(&app, &token, &id).await["backend_session_id"],
        "codex-thread-42"
    );
}

#[tokio::test]
async fn bind_backend_session_unknown_conversation_is_404() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;

    let (status, body) = put_backend_session(&app, &token, &csrf, "no-such-conv", json!({ "session_id": UUID })).await;
    assert_error(
        status,
        &body,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        "Conversation no-such-conv not found",
    );
}

#[tokio::test]
async fn bind_backend_session_on_another_users_conversation_is_404_and_unchanged() {
    let (mut app, services) = build_app().await;
    let (owner_token, owner_csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &owner_token, &owner_csrf, None).await);
    let (other_token, other_csrf) = setup_and_login(&mut app, &services, "mallory", PASSWORD).await;

    let (status, body) = put_backend_session(&app, &other_token, &other_csrf, &id, json!({ "session_id": UUID })).await;
    assert_error(
        status,
        &body,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        &format!("Conversation {id} not found"),
    );
    assert_eq!(
        index_entry(&app, &owner_token, &id).await["backend_session_id"],
        Value::Null,
        "a cross-user bind must not touch the owner's anchor"
    );
}

#[tokio::test]
async fn bind_backend_session_rejects_blank_session_id() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    for blank in ["", "   ", "\t\n"] {
        let (status, body) = put_backend_session(&app, &token, &csrf, &id, json!({ "session_id": blank })).await;
        assert_error(
            status,
            &body,
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "session_id must not be empty",
        );
    }
}

#[tokio::test]
async fn bind_backend_session_rejects_missing_field() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let (status, body) = put_backend_session(&app, &token, &csrf, &id, json!({})).await;
    assert!(
        status == StatusCode::BAD_REQUEST || status == StatusCode::UNPROCESSABLE_ENTITY,
        "missing session_id must be a client error, got {status}: {body}"
    );
    assert_eq!(body["success"], false);
    assert_eq!(index_entry(&app, &token, &id).await["backend_session_id"], Value::Null);
}

#[tokio::test]
async fn bind_backend_session_rejects_conversation_without_acp_session() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let conversation = create_conversation(&app, &token, &csrf, json!({ "type": "aionrs", "extra": {} })).await;

    let (status, body) = put_backend_session(
        &app,
        &token,
        &csrf,
        &id_of(&conversation),
        json!({ "session_id": UUID }),
    )
    .await;
    assert_error(
        status,
        &body,
        StatusCode::BAD_REQUEST,
        "BAD_REQUEST",
        "this conversation type has no backend session to bind",
    );
}

#[tokio::test]
async fn bind_backend_session_requires_uuid_for_claude() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    for bad in [
        "not-a-uuid",
        "0b1c2d3e4f506172839 4a5b6c7d8e9f0",
        "{0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0}",
        "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9fz",
        "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0a",
    ] {
        let (status, body) = put_backend_session(&app, &token, &csrf, &id, json!({ "session_id": bad })).await;
        assert_error(
            status,
            &body,
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "session_id must be a UUID for claude conversations",
        );
    }
    assert_eq!(index_entry(&app, &token, &id).await["backend_session_id"], Value::Null);
}

#[tokio::test]
async fn bind_backend_session_requires_authentication() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let req = Request::builder()
        .method("PUT")
        .uri(format!("/api/conversations/{id}/backend-session"))
        .header("content-type", "application/json")
        .header("x-csrf-token", &csrf)
        .header("cookie", format!("aionui-csrf-token={csrf}"))
        .body(Body::from(json!({ "session_id": UUID }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body_json(resp).await["code"], "UNAUTHORIZED");
    assert_eq!(index_entry(&app, &token, &id).await["backend_session_id"], Value::Null);
}

#[tokio::test]
async fn bind_backend_session_rejects_missing_csrf_token() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let req = Request::builder()
        .method("PUT")
        .uri(format!("/api/conversations/{id}/backend-session"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(json!({ "session_id": UUID }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(resp).await["code"], "CSRF_INVALID");
    assert_eq!(index_entry(&app, &token, &id).await["backend_session_id"], Value::Null);
}

// ── POST /messages/import ─────────────────────────────────────────────

#[tokio::test]
async fn import_messages_stores_text_rows_and_raises_updated_at() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);
    let before = index_entry(&app, &token, &id).await["updated_at"].as_i64().unwrap();

    // Far-future timestamps so the bump is observable; out of order on purpose.
    let newest = before + 86_400_000;
    let messages = json!([
        msg("user", "hello there", newest - 2_000),
        msg("assistant", "hi! \"quoted\" ✓", newest - 1_000),
        msg("user", "", newest),
    ]);
    let (status, body) = post_import(&app, &token, &csrf, &id, json!({ "messages": messages })).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["success"], true);
    assert_eq!(body["data"], json!({ "imported": 3 }));

    let rows = message_rows(&services, &id).await;
    assert_eq!(rows.len(), 3);
    let expected = [
        ("right", "hello there", newest - 2_000),
        ("left", "hi! \"quoted\" ✓", newest - 1_000),
        ("right", "", newest),
    ];
    for ((kind, content, position, status, created_at), (exp_pos, exp_text, exp_at)) in rows.iter().zip(expected) {
        assert_eq!(kind, "text");
        assert_eq!(
            serde_json::from_str::<Value>(content).unwrap(),
            json!({ "content": exp_text })
        );
        assert_eq!(position, exp_pos);
        assert_eq!(status, "finish");
        assert_eq!(*created_at, exp_at, "created_at must be kept verbatim");
    }

    assert_eq!(index_entry(&app, &token, &id).await["updated_at"], newest);

    // Imported rows are visible through the normal message list.
    let resp = app
        .clone()
        .oneshot(get_with_token(&format!("/api/conversations/{id}/messages"), &token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(body_json(resp).await.to_string().contains("hello there"));
}

#[tokio::test]
async fn import_messages_with_old_timestamps_does_not_lower_updated_at() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);
    let before = index_entry(&app, &token, &id).await["updated_at"].as_i64().unwrap();

    let (status, body) = post_import(
        &app,
        &token,
        &csrf,
        &id,
        json!({ "messages": [msg("user", "old", 1_000)] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(index_entry(&app, &token, &id).await["updated_at"], before);
    assert_eq!(message_rows(&services, &id).await[0].4, 1_000);
}

#[tokio::test]
async fn import_messages_unknown_or_foreign_conversation_is_404() {
    let (mut app, services) = build_app().await;
    let (owner_token, owner_csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &owner_token, &owner_csrf, None).await);
    let (other_token, other_csrf) = setup_and_login(&mut app, &services, "mallory", PASSWORD).await;
    let body = json!({ "messages": [msg("user", "x", 1)] });

    let (status, resp) = post_import(&app, &other_token, &other_csrf, &id, body.clone()).await;
    assert_error(
        status,
        &resp,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        &format!("Conversation {id} not found"),
    );
    assert!(message_rows(&services, &id).await.is_empty());

    let (status, resp) = post_import(&app, &owner_token, &owner_csrf, "no-such-conv", body).await;
    assert_error(
        status,
        &resp,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        "Conversation no-such-conv not found",
    );
}

#[tokio::test]
async fn import_messages_rejects_empty_list() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let (status, body) = post_import(&app, &token, &csrf, &id, json!({ "messages": [] })).await;
    assert_error(
        status,
        &body,
        StatusCode::BAD_REQUEST,
        "BAD_REQUEST",
        "messages must not be empty",
    );
}

#[tokio::test]
async fn import_messages_rejects_unknown_role_and_inserts_nothing() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    for role in ["system", "User", ""] {
        let body = json!({ "messages": [msg("user", "ok", 1), msg("assistant", "ok", 2), msg(role, "bad", 3)] });
        let (status, resp) = post_import(&app, &token, &csrf, &id, body).await;
        assert_error(
            status,
            &resp,
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "messages[2].role must be \"user\" or \"assistant\"",
        );
    }
    assert!(message_rows(&services, &id).await.is_empty());
}

#[tokio::test]
async fn import_messages_rejects_more_than_5000_messages() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let messages: Vec<Value> = (0..5001).map(|i| msg("user", "m", i)).collect();
    let (status, body) = post_import(&app, &token, &csrf, &id, json!({ "messages": messages })).await;
    assert_error(
        status,
        &body,
        StatusCode::BAD_REQUEST,
        "BAD_REQUEST",
        "too many messages: at most 5000 can be imported at once",
    );
    assert!(message_rows(&services, &id).await.is_empty());
}

#[tokio::test]
async fn import_messages_accepts_exactly_5000_messages() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let messages: Vec<Value> = (0..5000)
        .map(|i| msg(if i % 2 == 0 { "user" } else { "assistant" }, "m", i))
        .collect();
    let (status, body) = post_import(&app, &token, &csrf, &id, json!({ "messages": messages })).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["data"]["imported"], 5000);
    assert_eq!(message_rows(&services, &id).await.len(), 5000);
}

#[tokio::test]
async fn import_messages_rejects_more_than_20_mb_of_text() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    // 2 x 10.5 MB = 21 MB of text: over the text cap, under the 32 MB body cap.
    let chunk = "a".repeat(10 * 1024 * 1024 + 512 * 1024);
    let body = json!({ "messages": [msg("user", &chunk, 1), msg("assistant", &chunk, 2)] });
    let (status, resp) = post_import(&app, &token, &csrf, &id, body).await;
    assert_error(
        status,
        &resp,
        StatusCode::BAD_REQUEST,
        "BAD_REQUEST",
        "messages exceed the 20 MB total text limit",
    );
    assert!(message_rows(&services, &id).await.is_empty());
}

#[tokio::test]
async fn import_messages_accepts_body_above_global_limit_within_text_cap() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    // ~12 MB body: above the global 10 MB body limit, within the 20 MB text cap.
    let chunk = "b".repeat(6 * 1024 * 1024);
    let body = json!({ "messages": [msg("user", &chunk, 1), msg("assistant", &chunk, 2)] });
    let (status, resp) = post_import(&app, &token, &csrf, &id, body).await;
    assert_eq!(status, StatusCode::OK, "body: {resp}");
    assert_eq!(resp["data"]["imported"], 2);
}

#[tokio::test]
async fn second_import_into_non_empty_conversation_is_409() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let (status, _) = post_import(
        &app,
        &token,
        &csrf,
        &id,
        json!({ "messages": [msg("user", "first", 1)] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = post_import(
        &app,
        &token,
        &csrf,
        &id,
        json!({ "messages": [msg("user", "second", 2)] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "body: {body}");
    assert_eq!(body["success"], false);
    assert_eq!(body["code"], "CONFLICT");
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("IMPORT_CONVERSATION_NOT_EMPTY"),
        "body: {body}"
    );
    let rows = message_rows(&services, &id).await;
    assert_eq!(rows.len(), 1, "the rejected import must insert nothing");
    assert!(rows[0].1.contains("first"));
}

#[tokio::test]
async fn import_messages_requires_authentication() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/conversations/{id}/messages/import"))
        .header("content-type", "application/json")
        .header("x-csrf-token", &csrf)
        .header("cookie", format!("aionui-csrf-token={csrf}"))
        .body(Body::from(json!({ "messages": [msg("user", "x", 1)] }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body_json(resp).await["code"], "UNAUTHORIZED");
    assert!(message_rows(&services, &id).await.is_empty());
}

#[tokio::test]
async fn import_messages_rejects_missing_csrf_token() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/conversations/{id}/messages/import"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(json!({ "messages": [msg("user", "x", 1)] }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(resp).await["code"], "CSRF_INVALID");
    assert!(message_rows(&services, &id).await.is_empty());
}

#[tokio::test]
async fn repository_import_rolls_back_entire_batch_on_failing_row() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let id = id_of(&create_claude(&app, &token, &csrf, None).await);
    let admin_id = user_id(&services, "admin").await;
    let before = index_entry(&app, &token, &id).await["updated_at"].as_i64().unwrap();

    // The second row violates the `position` CHECK constraint.
    let batch = [
        NewMessageParams {
            message_type: "text",
            content: r#"{"content":"ok"}"#,
            position: "right",
            status: "finish",
            created_at: before + 10_000,
        },
        NewMessageParams {
            message_type: "text",
            content: r#"{"content":"bad"}"#,
            position: "sideways",
            status: "finish",
            created_at: before + 20_000,
        },
    ];
    let result = services.conversation_repo.insert_messages(&admin_id, &id, &batch).await;
    assert!(result.is_err(), "a CHECK violation must fail the batch");

    assert!(
        message_rows(&services, &id).await.is_empty(),
        "no row of a failed batch may persist"
    );
    assert_eq!(
        index_entry(&app, &token, &id).await["updated_at"],
        before,
        "updated_at must not move on rollback"
    );

    // The connection is usable and the conversation still counts as empty.
    let (status, body) = post_import(
        &app,
        &token,
        &csrf,
        &id,
        json!({ "messages": [msg("user", "retry", 5)] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
}

// ── GET /sessions-index ───────────────────────────────────────────────

#[tokio::test]
async fn sessions_index_lists_only_own_conversations_newest_first() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let (other_token, other_csrf) = setup_and_login(&mut app, &services, "mallory", PASSWORD).await;

    let workspace = tempfile::tempdir().unwrap();
    let older = create_claude(&app, &token, &csrf, Some(workspace.path())).await;
    let newer = id_of(&create_claude(&app, &token, &csrf, None).await);
    let foreign = id_of(&create_claude(&app, &other_token, &other_csrf, None).await);

    // Make `older` the most recently updated so ordering is by updated_at, not creation.
    let older_id = id_of(&older);
    let (status, _) = post_import(
        &app,
        &token,
        &csrf,
        &older_id,
        json!({ "messages": [msg("user", "x", 4_000_000_000_000_i64)] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let entries = sessions_index(&app, &token).await;
    let ids: Vec<&str> = entries.iter().map(|e| e["conversation_id"].as_str().unwrap()).collect();
    assert!(
        !ids.contains(&foreign.as_str()),
        "another user's conversation leaked: {ids:?}"
    );
    let pos_older = ids.iter().position(|i| *i == older_id).unwrap();
    let pos_newer = ids.iter().position(|i| *i == newer).unwrap();
    assert!(pos_older < pos_newer, "newest updated_at must come first: {ids:?}");
    let updated: Vec<i64> = entries.iter().map(|e| e["updated_at"].as_i64().unwrap()).collect();
    assert!(updated.windows(2).all(|w| w[0] >= w[1]), "not sorted desc: {updated:?}");

    let entry = &entries[pos_older];
    assert_eq!(entry["title"], "Claude chat");
    assert_eq!(entry["agent_id"], CLAUDE_ID);
    assert_eq!(entry["backend"], "claude");
    assert_eq!(entry["backend_session_id"], Value::Null);
    assert_eq!(entry["workspace"], older["extra"]["workspace"]);
    assert!(entry["created_at"].as_i64().is_some());

    let other_ids: Vec<String> = sessions_index(&app, &other_token)
        .await
        .iter()
        .map(|e| e["conversation_id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(other_ids, vec![foreign]);
}

#[tokio::test]
async fn sessions_index_reports_null_for_absent_fields() {
    let (mut app, services) = build_app().await;
    let (token, _csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let admin_id = user_id(&services, "admin").await;

    // A legacy-shaped row: no workspace/backend/agent in extra, no acp_session.
    let row = ConversationRow {
        id: "legacy-conv".into(),
        user_id: admin_id,
        name: "Legacy".into(),
        r#type: "acp".into(),
        extra: "{}".into(),
        model: None,
        status: Some("pending".into()),
        source: Some("aionui".into()),
        channel_chat_id: None,
        pinned: false,
        pinned_at: None,
        created_at: 10,
        updated_at: 20,
        project_id: None,
        folder_id: None,
        name_source: None,
    };
    services.conversation_repo.create(&row).await.unwrap();

    let entry = index_entry(&app, &token, "legacy-conv").await;
    assert_eq!(
        entry,
        json!({
            "conversation_id": "legacy-conv",
            "title": "Legacy",
            "agent_id": null,
            "backend": null,
            "backend_session_id": null,
            "workspace": null,
            "created_at": 10,
            "updated_at": 20,
        })
    );
}

#[tokio::test]
async fn sessions_index_requires_authentication() {
    let (app, _services) = build_app().await;
    let req = Request::builder()
        .method("GET")
        .uri("/api/conversations/sessions-index")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body_json(resp).await["code"], "UNAUTHORIZED");
}

// ── .pavii/sessions.json source tagging ───────────────────────────────

#[tokio::test]
async fn imported_conversation_is_tagged_with_import_source_in_pavii_index() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let workspace = tempfile::tempdir().unwrap();
    let conversation = create_conversation(
        &app,
        &token,
        &csrf,
        json!({
            "type": "acp",
            "name": "Imported",
            "extra": {
                "backend": "claude",
                "agent_id": CLAUDE_ID,
                "workspace": workspace.path().to_string_lossy(),
                "import_source": "claude-import",
            }
        }),
    )
    .await;

    let file = read_pavii_sessions(workspace.path());
    assert_eq!(file["sessions"][0]["conversationId"], id_of(&conversation).as_str());
    assert_eq!(file["sessions"][0]["source"], "claude-import");
    assert_eq!(file["sessions"][0]["title"], "Imported");
}

#[tokio::test]
async fn auto_provisioned_workspace_gets_no_pavii_index() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", PASSWORD).await;
    let conversation = create_claude(&app, &token, &csrf, None).await;
    let id = id_of(&conversation);
    let workspace = std::path::PathBuf::from(conversation["extra"]["workspace"].as_str().unwrap());

    let (status, _) = put_backend_session(&app, &token, &csrf, &id, json!({ "session_id": UUID })).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !workspace.join(".pavii").exists(),
        "engine temp workspace {} must not get a .pavii index",
        workspace.display()
    );
}
