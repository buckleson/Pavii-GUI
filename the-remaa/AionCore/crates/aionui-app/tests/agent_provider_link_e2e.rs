//! E2E tests for `PUT /api/agents/{id}/provider-link` and the link fields
//! projected onto `GET /api/agents/management`.
//!
//! Seed rows used (migration 001): `cc126dd5` = Gemini CLI (backend `gemini`,
//! linkable to `gemini` providers only) and `8e1acf31` = Codex CLI (backend
//! `codex`, no provider-link mapping).

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use common::{body_json, build_app, get_request, get_with_token, json_with_token, setup_and_login};

const GEMINI_ID: &str = "cc126dd5";
const CODEX_ID: &str = "8e1acf31";
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com";
const GEMINI_KEY: &str = "AIzaSy-provider-link-e2e-SECRET-7f3a9c";

async fn create_provider(
    app: &axum::Router,
    token: &str,
    csrf: &str,
    platform: &str,
    base_url: &str,
    api_key: &str,
) -> String {
    let req = json_with_token(
        "POST",
        "/api/providers",
        json!({
            "platform": platform,
            "name": format!("{platform} provider"),
            "base_url": base_url,
            "api_key": api_key,
        }),
        token,
        csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "provider create should succeed");
    body_json(resp).await["data"]["id"].as_str().unwrap().to_owned()
}

async fn put_link(app: &axum::Router, token: &str, csrf: &str, agent_id: &str, body: Value) -> (StatusCode, Value) {
    let req = json_with_token(
        "PUT",
        &format!("/api/agents/{agent_id}/provider-link"),
        body,
        token,
        csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    (status, body_json(resp).await)
}

async fn get_raw(app: &axum::Router, token: &str, uri: &str) -> (StatusCode, String) {
    let resp = app.clone().oneshot(get_with_token(uri, token)).await.unwrap();
    let status = resp.status();
    let bytes = http_body_util::BodyExt::collect(resp.into_body())
        .await
        .unwrap()
        .to_bytes();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

async fn management_row(app: &axum::Router, token: &str, agent_id: &str) -> Value {
    let resp = app
        .clone()
        .oneshot(get_with_token("/api/agents/management", token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    body["data"]
        .as_array()
        .expect("management data is an array")
        .iter()
        .find(|row| row["id"] == agent_id)
        .unwrap_or_else(|| panic!("agent {agent_id} missing from management list"))
        .clone()
}

fn assert_error(status: StatusCode, body: &Value, expected_status: StatusCode, code: &str, message: &str) {
    assert_eq!(status, expected_status, "unexpected status, body: {body}");
    assert_eq!(body["success"], false);
    assert_eq!(body["code"], code);
    assert_eq!(body["error"], message);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn link_and_unlink_gemini_provider_round_trips_through_management() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "gemini", GEMINI_URL, GEMINI_KEY).await;

    // Before linking: no link, platforms advertised.
    let row = management_row(&app, &token, GEMINI_ID).await;
    assert_eq!(row["linked_provider_id"], Value::Null);
    assert_eq!(row["provider_link_platforms"], json!(["gemini"]));

    let (status, body) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": provider_id })).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["success"], true);

    let row = management_row(&app, &token, GEMINI_ID).await;
    assert_eq!(row["linked_provider_id"], provider_id.as_str());
    assert!(
        row["provider_link_platforms"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "gemini")
    );

    let (status, body) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": null })).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(body["success"], true);
    let row = management_row(&app, &token, GEMINI_ID).await;
    assert_eq!(row["linked_provider_id"], Value::Null);
}

#[tokio::test]
async fn blank_or_omitted_provider_id_clears_link() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "gemini", GEMINI_URL, GEMINI_KEY).await;

    for clear_body in [json!({ "provider_id": "   " }), json!({})] {
        let (status, _) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": provider_id })).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            management_row(&app, &token, GEMINI_ID).await["linked_provider_id"],
            provider_id.as_str()
        );

        let (status, body) = put_link(&app, &token, &csrf, GEMINI_ID, clear_body.clone()).await;
        assert_eq!(status, StatusCode::OK, "clear body {clear_body} -> {body}");
        assert_eq!(
            management_row(&app, &token, GEMINI_ID).await["linked_provider_id"],
            Value::Null,
            "clear body {clear_body} must clear the link"
        );
    }
}

#[tokio::test]
async fn provider_id_is_trimmed_before_lookup_and_storage() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "gemini", GEMINI_URL, GEMINI_KEY).await;

    let (status, body) = put_link(
        &app,
        &token,
        &csrf,
        GEMINI_ID,
        json!({ "provider_id": format!("  {provider_id}  ") }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(
        management_row(&app, &token, GEMINI_ID).await["linked_provider_id"],
        provider_id.as_str()
    );
}

#[tokio::test]
async fn clearing_is_allowed_on_backend_without_mapping() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let (status, body) = put_link(&app, &token, &csrf, CODEX_ID, json!({ "provider_id": null })).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    let row = management_row(&app, &token, CODEX_ID).await;
    assert_eq!(row["linked_provider_id"], Value::Null);
    assert_eq!(row["provider_link_platforms"], json!([]));
}

// ---------------------------------------------------------------------------
// Not found
// ---------------------------------------------------------------------------

#[tokio::test]
async fn unknown_agent_returns_404_with_message() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "gemini", GEMINI_URL, GEMINI_KEY).await;

    let (status, body) = put_link(
        &app,
        &token,
        &csrf,
        "no-such-agent",
        json!({ "provider_id": provider_id }),
    )
    .await;
    assert_error(
        status,
        &body,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        "Agent 'no-such-agent' not found",
    );

    // Clearing an unknown agent is also a 404, not a silent success.
    let (status, body) = put_link(&app, &token, &csrf, "no-such-agent", json!({ "provider_id": null })).await;
    assert_error(
        status,
        &body,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        "Agent 'no-such-agent' not found",
    );
}

#[tokio::test]
async fn unknown_provider_returns_404_and_keeps_existing_link() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "gemini", GEMINI_URL, GEMINI_KEY).await;
    let (status, _) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": provider_id })).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": "prov-missing" })).await;
    assert_error(
        status,
        &body,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        "Provider 'prov-missing' not found",
    );
    assert_eq!(
        management_row(&app, &token, GEMINI_ID).await["linked_provider_id"],
        provider_id.as_str(),
        "a rejected link must not overwrite the existing one"
    );
}

#[tokio::test]
async fn unknown_provider_on_unmapped_backend_reports_provider_first() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let (status, body) = put_link(&app, &token, &csrf, CODEX_ID, json!({ "provider_id": "prov-missing" })).await;
    assert_error(
        status,
        &body,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        "Provider 'prov-missing' not found",
    );
}

#[tokio::test]
async fn provider_owned_by_another_user_is_not_found() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let (other_token, other_csrf) = setup_and_login(&mut app, &services, "alice", "StrongP@ss2").await;
    let alice_provider = create_provider(
        &app,
        &other_token,
        &other_csrf,
        "gemini",
        GEMINI_URL,
        "alice-secret-key-91b2",
    )
    .await;

    let (status, body) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": alice_provider })).await;
    assert_error(
        status,
        &body,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        &format!("Provider '{alice_provider}' not found"),
    );
    assert_eq!(
        management_row(&app, &token, GEMINI_ID).await["linked_provider_id"],
        Value::Null
    );
}

// ---------------------------------------------------------------------------
// Bad request
// ---------------------------------------------------------------------------

#[tokio::test]
async fn backend_without_mapping_returns_400() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "openai", "https://api.openai.com/v1", "sk-codex-x").await;

    let (status, body) = put_link(&app, &token, &csrf, CODEX_ID, json!({ "provider_id": provider_id })).await;
    assert_error(
        status,
        &body,
        StatusCode::BAD_REQUEST,
        "BAD_REQUEST",
        "Agent '8e1acf31' does not support linking a model provider",
    );
    assert_eq!(
        management_row(&app, &token, CODEX_ID).await["linked_provider_id"],
        Value::Null
    );
}

#[tokio::test]
async fn platform_mismatch_returns_400() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(
        &app,
        &token,
        &csrf,
        "anthropic",
        "https://api.anthropic.com",
        "sk-ant-mismatch",
    )
    .await;

    let (status, body) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": provider_id })).await;
    assert_error(
        status,
        &body,
        StatusCode::BAD_REQUEST,
        "BAD_REQUEST",
        "Provider platform 'anthropic' is not supported by agent 'cc126dd5'",
    );
    assert_eq!(
        management_row(&app, &token, GEMINI_ID).await["linked_provider_id"],
        Value::Null
    );
}

#[tokio::test]
async fn malformed_json_returns_400() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = Request::builder()
        .method("PUT")
        .uri(format!("/api/agents/{GEMINI_ID}/provider-link"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .header("x-csrf-token", &csrf)
        .header("cookie", format!("aionui-csrf-token={csrf}"))
        .body(Body::from("{ not json"))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body = body_json(resp).await;
    assert_error(
        status,
        &body,
        StatusCode::BAD_REQUEST,
        "BAD_REQUEST",
        "Invalid JSON request body.",
    );
}

#[tokio::test]
async fn wrong_provider_id_type_returns_400() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let (status, body) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": 42 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
    assert_eq!(body["code"], "BAD_REQUEST");
}

// ---------------------------------------------------------------------------
// Auth / CSRF
// ---------------------------------------------------------------------------

#[tokio::test]
async fn provider_link_requires_authentication() {
    let (mut app, services) = build_app().await;
    let (_token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = Request::builder()
        .method("PUT")
        .uri(format!("/api/agents/{GEMINI_ID}/provider-link"))
        .header("content-type", "application/json")
        .header("x-csrf-token", &csrf)
        .header("cookie", format!("aionui-csrf-token={csrf}"))
        .body(Body::from(r#"{"provider_id":null}"#))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "UNAUTHORIZED");
}

#[tokio::test]
async fn provider_link_rejects_missing_csrf_token() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "gemini", GEMINI_URL, GEMINI_KEY).await;
    // Prime a fresh CSRF cookie so the request fails only on the missing header.
    let _ = app.clone().oneshot(get_request("/api/auth/status")).await.unwrap();

    let req = Request::builder()
        .method("PUT")
        .uri(format!("/api/agents/{GEMINI_ID}/provider-link"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(
            serde_json::to_vec(&json!({ "provider_id": provider_id })).unwrap(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "CSRF_INVALID");
    assert_eq!(
        management_row(&app, &token, GEMINI_ID).await["linked_provider_id"],
        Value::Null,
        "a CSRF-rejected request must not change the link"
    );
}

// ---------------------------------------------------------------------------
// Security: the linked provider's plaintext key never reaches agent GET bodies
// ---------------------------------------------------------------------------

#[tokio::test]
async fn linked_provider_key_never_appears_in_agent_get_responses() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let provider_id = create_provider(&app, &token, &csrf, "gemini", GEMINI_URL, GEMINI_KEY).await;
    let (status, _) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": provider_id })).await;
    assert_eq!(status, StatusCode::OK);

    for uri in [
        "/api/agents/management".to_owned(),
        format!("/api/agents/{GEMINI_ID}/overrides"),
        "/api/agents/logos".to_owned(),
    ] {
        let (status, raw) = get_raw(&app, &token, &uri).await;
        assert_eq!(status, StatusCode::OK, "GET {uri} -> {raw}");
        assert!(
            !raw.contains(GEMINI_KEY),
            "GET {uri} leaked the linked provider's plaintext API key"
        );
        assert!(
            !raw.contains("GEMINI_API_KEY"),
            "GET {uri} exposed the injected env var name, implying spawn env leaked into the catalog"
        );
    }

    // The PUT response itself must not echo the key either.
    let (_, body) = put_link(&app, &token, &csrf, GEMINI_ID, json!({ "provider_id": provider_id })).await;
    assert!(!body.to_string().contains(GEMINI_KEY));
}
