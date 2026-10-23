//! E2E tests for `POST /api/agents/refresh-path`.
//!
//! Thread safety: the endpoint sets the process-global PATH override in
//! `aionui_runtime`. This file is its own test binary, so the override cannot
//! leak into other test files; within it, every test holds `OVERRIDE_LOCK`
//! and clears the override on exit (even on panic) via `OverrideGuard`.

mod common;

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use tokio::sync::{Mutex, MutexGuard};
use tower::ServiceExt;

use aionui_db::{IAgentMetadataRepository, SqliteAgentMetadataRepository, UpsertAgentMetadataParams};
use common::{body_json, build_app, get_request, json_with_token, setup_and_login};

static OVERRIDE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct OverrideGuard {
    _lock: MutexGuard<'static, ()>,
}

impl Drop for OverrideGuard {
    fn drop(&mut self) {
        aionui_runtime::set_path_override(None);
    }
}

async fn lock_override() -> OverrideGuard {
    let lock = OVERRIDE_LOCK.get_or_init(|| Mutex::new(())).lock().await;
    aionui_runtime::set_path_override(None);
    OverrideGuard { _lock: lock }
}

#[cfg(unix)]
fn write_fake_cli(dir: &Path, name: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, "#!/bin/sh\necho 1.0.0\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[cfg(windows)]
fn write_fake_cli(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(format!("{name}.cmd"));
    std::fs::write(&path, "@echo off\r\necho 1.0.0\r\n").unwrap();
    path
}

async fn seed_custom_agent(services: &aionui_app::AppServices, id: &str, command: &str) {
    let repo: Arc<dyn IAgentMetadataRepository> =
        Arc::new(SqliteAgentMetadataRepository::new(services.database.pool().clone()));
    let source_info = json!({ "binary_name": command }).to_string();
    repo.upsert(&UpsertAgentMetadataParams {
        id,
        icon: None,
        name: id,
        name_i18n: None,
        description: None,
        description_i18n: None,
        backend: Some("claude"),
        agent_type: "acp",
        agent_source: "custom",
        agent_source_info: Some(&source_info),
        enabled: true,
        command: Some(command),
        args: Some("[]"),
        env: Some("[]"),
        native_skills_dirs: None,
        behavior_policy: None,
        yolo_id: None,
        agent_capabilities: None,
        auth_methods: None,
        config_options: None,
        available_modes: None,
        available_models: None,
        available_commands: None,
        sort_order: 1500,
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn refresh_path_makes_newly_installed_agent_available() {
    let _guard = lock_override().await;
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let empty = tempfile::tempdir().unwrap();
    let install_dir = tempfile::tempdir().unwrap();

    seed_custom_agent(&services, "agent-refresh-path", "aionui-refresh-path-agent").await;
    aionui_runtime::set_path_override(Some(empty.path().as_os_str().to_owned()));
    services.agent_registry.hydrate().await.unwrap();
    assert!(
        !services
            .agent_registry
            .get("agent-refresh-path")
            .await
            .unwrap()
            .available
    );

    write_fake_cli(install_dir.path(), "aionui-refresh-path-agent");
    let req = json_with_token(
        "POST",
        "/api/agents/refresh-path",
        json!({ "path": install_dir.path().to_string_lossy() }),
        &token,
        &csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["success"], true);
    assert_eq!(
        aionui_runtime::path_override().as_deref(),
        Some(install_dir.path().as_os_str())
    );
    assert!(
        services
            .agent_registry
            .get("agent-refresh-path")
            .await
            .unwrap()
            .available,
        "refresh-path must re-probe the registry against the new PATH"
    );
}

#[tokio::test]
async fn refresh_path_rejects_malformed_json() {
    let _guard = lock_override().await;
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/agents/refresh-path")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .header("x-csrf-token", &csrf)
        .header("cookie", format!("aionui-csrf-token={csrf}"))
        .body(Body::from("{ not json"))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "BAD_REQUEST");
    assert_eq!(body["error"], "Invalid JSON request body.");
    assert_eq!(
        aionui_runtime::path_override(),
        None,
        "a rejected request must not set the override"
    );
}

#[tokio::test]
async fn refresh_path_rejects_missing_path_field() {
    let _guard = lock_override().await;
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = json_with_token("POST", "/api/agents/refresh-path", json!({}), &token, &csrf);
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "BAD_REQUEST");
    assert_eq!(body["error"], "Invalid JSON request body.");
    assert_eq!(aionui_runtime::path_override(), None);
}

#[tokio::test]
async fn refresh_path_rejects_wrong_path_type() {
    let _guard = lock_override().await;
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = json_with_token("POST", "/api/agents/refresh-path", json!({ "path": 42 }), &token, &csrf);
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "BAD_REQUEST");
    assert_eq!(aionui_runtime::path_override(), None);
}

#[tokio::test]
async fn refresh_path_requires_authentication() {
    let _guard = lock_override().await;
    let (mut app, services) = build_app().await;
    // Create the account so auth is actually enforced, then call without a token.
    let (_token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let dir = tempfile::tempdir().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/agents/refresh-path")
        .header("content-type", "application/json")
        .header("x-csrf-token", &csrf)
        .header("cookie", format!("aionui-csrf-token={csrf}"))
        .body(Body::from(
            serde_json::to_vec(&json!({ "path": dir.path().to_string_lossy() })).unwrap(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "UNAUTHORIZED");
    assert_eq!(
        aionui_runtime::path_override(),
        None,
        "unauthenticated calls must not set the override"
    );
}

#[tokio::test]
async fn refresh_path_rejects_missing_csrf_token() {
    let _guard = lock_override().await;
    let (mut app, services) = build_app().await;
    let (token, _csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    // Prime a fresh CSRF cookie so the request fails only on the missing header.
    let _ = app.clone().oneshot(get_request("/api/auth/status")).await.unwrap();
    let dir = tempfile::tempdir().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/agents/refresh-path")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(
            serde_json::to_vec(&json!({ "path": dir.path().to_string_lossy() })).unwrap(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = body_json(resp).await;
    assert_eq!(body["code"], "CSRF_INVALID");
    assert_eq!(aionui_runtime::path_override(), None);
}
