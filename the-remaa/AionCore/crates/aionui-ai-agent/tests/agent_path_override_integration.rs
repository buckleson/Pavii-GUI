//! Integration tests for re-detecting agent CLIs against a PATH override
//! (`aionui_runtime::set_path_override`), the concurrent row probing used by
//! `hydrate` / `refresh_availability`, and the manual health check reloading
//! a newly installed agent into the registry.
//!
//! Thread safety: the PATH override is process-global. This file is its own
//! test binary, so the override cannot leak into other test files; within
//! this binary every test holds `OVERRIDE_LOCK` for its whole body and clears
//! the override on exit (even on panic) via `OverrideGuard`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use aionui_ai_agent::{AgentRegistry, AgentService, UnavailableReason};
use aionui_db::{
    IAgentMetadataRepository, IProviderRepository, SqliteAgentMetadataRepository, SqliteProviderRepository,
    UpsertAgentMetadataParams, init_database_memory,
};
use aionui_realtime::EventBroadcaster;
use tokio::sync::{Mutex, MutexGuard};

const SYSTEM_DEFAULT_USER_ID: &str = "system_default_user";

static OVERRIDE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Holds the override lock and clears the PATH override when dropped.
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

fn set_override(dir: &Path) {
    aionui_runtime::set_path_override(Some(dir.as_os_str().to_owned()));
}

struct NoopBroadcaster;

impl EventBroadcaster for NoopBroadcaster {
    fn broadcast(&self, _msg: aionui_api_types::WebSocketMessage<serde_json::Value>) {}
}

/// Write a fake CLI named `name` into `dir` that prints `version_line` for
/// `--version` and exits with `exit_code`.
#[cfg(unix)]
fn write_fake_cli(dir: &Path, name: &str, version_line: &str, exit_code: i32) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\necho '{version_line}'\nexit {exit_code}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// Write a fake npm-style CLI shim (`name.cmd`) into `dir`.
#[cfg(windows)]
fn write_fake_cli(dir: &Path, name: &str, version_line: &str, exit_code: i32) -> PathBuf {
    let path = dir.join(format!("{name}.cmd"));
    std::fs::write(
        &path,
        format!("@echo off\r\necho {version_line}\r\nexit /b {exit_code}\r\n"),
    )
    .unwrap();
    path
}

fn custom_params<'a>(id: &'a str, command: &'a str, agent_source_info: &'a str) -> UpsertAgentMetadataParams<'a> {
    UpsertAgentMetadataParams {
        id,
        icon: None,
        name: id,
        name_i18n: None,
        description: None,
        description_i18n: None,
        backend: Some("claude"),
        agent_type: "acp",
        agent_source: "custom",
        agent_source_info: Some(agent_source_info),
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
        sort_order: 100,
    }
}

async fn repo() -> Arc<dyn IAgentMetadataRepository> {
    let db = init_database_memory().await.unwrap();
    Arc::new(SqliteAgentMetadataRepository::new(db.pool().clone()))
}

async fn upsert_custom(repo: &Arc<dyn IAgentMetadataRepository>, id: &str, command: &str) {
    let source_info = serde_json::json!({ "binary_name": command }).to_string();
    repo.upsert(&custom_params(id, command, &source_info)).await.unwrap();
}

// ── refresh_availability honours the PATH override ──────────────────────────

#[tokio::test]
async fn refresh_availability_finds_agent_installed_in_path_override_dir() {
    let _guard = lock_override().await;
    let empty = tempfile::tempdir().unwrap();
    let install_dir = tempfile::tempdir().unwrap();
    let repo = repo().await;
    upsert_custom(&repo, "agent-late-install", "aionui-late-install-agent").await;

    // Startup: PATH has nothing, so the agent is missing.
    set_override(empty.path());
    let registry = AgentRegistry::new(repo);
    registry.hydrate().await.unwrap();
    let before = registry.get("agent-late-install").await.unwrap();
    assert!(!before.available, "agent must start unavailable");
    assert!(before.resolved_command.is_none());

    // The CLI gets installed into a directory that only the new PATH lists.
    let installed = write_fake_cli(install_dir.path(), "aionui-late-install-agent", "1.0.0", 0);
    registry.refresh_availability().await;
    assert!(
        !registry.get("agent-late-install").await.unwrap().available,
        "refresh against the old PATH must not find the new CLI"
    );

    set_override(install_dir.path());
    registry.refresh_availability().await;

    let after = registry.get("agent-late-install").await.unwrap();
    assert!(
        after.available,
        "refresh against the override PATH must find the new CLI"
    );
    let resolved = after.resolved_command.expect("resolved command must be recorded");
    assert_eq!(
        std::fs::canonicalize(resolved).unwrap(),
        std::fs::canonicalize(installed).unwrap()
    );
    let reasons = registry.diagnostic_snapshot().await;
    let (_, reason) = reasons
        .iter()
        .find(|(meta, _)| meta.id == "agent-late-install")
        .expect("agent present in diagnostics");
    assert!(
        reason.is_none(),
        "available agent must not keep a stale reason: {reason:?}"
    );
}

#[tokio::test]
async fn refresh_availability_marks_agent_missing_when_override_drops_its_dir() {
    let _guard = lock_override().await;
    let install_dir = tempfile::tempdir().unwrap();
    let empty = tempfile::tempdir().unwrap();
    write_fake_cli(install_dir.path(), "aionui-removed-agent", "1.0.0", 0);
    let repo = repo().await;
    upsert_custom(&repo, "agent-removed", "aionui-removed-agent").await;

    set_override(install_dir.path());
    let registry = AgentRegistry::new(repo);
    registry.hydrate().await.unwrap();
    assert!(registry.get("agent-removed").await.unwrap().available);

    set_override(empty.path());
    registry.refresh_availability().await;

    let after = registry.get("agent-removed").await.unwrap();
    assert!(!after.available);
    assert!(after.resolved_command.is_none());
    let reasons = registry.diagnostic_snapshot().await;
    let (_, reason) = reasons.iter().find(|(meta, _)| meta.id == "agent-removed").unwrap();
    assert!(
        matches!(reason, Some(UnavailableReason::CommandMissing { command }) if command == "aionui-removed-agent"),
        "expected CommandMissing for the dropped CLI, got {reason:?}"
    );
}

#[tokio::test]
async fn refresh_agent_path_service_sets_override_and_reprobes_registry() {
    let _guard = lock_override().await;
    let empty = tempfile::tempdir().unwrap();
    let install_dir = tempfile::tempdir().unwrap();
    let db = init_database_memory().await.unwrap();
    let repo: Arc<dyn IAgentMetadataRepository> = Arc::new(SqliteAgentMetadataRepository::new(db.pool().clone()));
    let provider_repo: Arc<dyn IProviderRepository> = Arc::new(SqliteProviderRepository::new(db.pool().clone()));
    upsert_custom(&repo, "agent-service-refresh", "aionui-service-refresh-agent").await;

    set_override(empty.path());
    let registry = AgentRegistry::new(repo);
    registry.hydrate().await.unwrap();
    assert!(!registry.get("agent-service-refresh").await.unwrap().available);

    write_fake_cli(install_dir.path(), "aionui-service-refresh-agent", "1.0.0", 0);
    let data_dir = tempfile::tempdir().unwrap();
    let service = AgentService::new(
        registry.clone(),
        Arc::new(NoopBroadcaster),
        provider_repo,
        [0; 32],
        data_dir.path().to_path_buf(),
    );

    service
        .refresh_agent_path(install_dir.path().to_string_lossy().into_owned())
        .await;

    assert_eq!(
        aionui_runtime::path_override().as_deref(),
        Some(install_dir.path().as_os_str())
    );
    assert!(registry.get("agent-service-refresh").await.unwrap().available);
}

#[tokio::test]
async fn refresh_agent_path_with_empty_string_clears_override() {
    let _guard = lock_override().await;
    let install_dir = tempfile::tempdir().unwrap();
    let db = init_database_memory().await.unwrap();
    let repo: Arc<dyn IAgentMetadataRepository> = Arc::new(SqliteAgentMetadataRepository::new(db.pool().clone()));
    let provider_repo: Arc<dyn IProviderRepository> = Arc::new(SqliteProviderRepository::new(db.pool().clone()));
    write_fake_cli(install_dir.path(), "aionui-cleared-override-agent", "1.0.0", 0);
    upsert_custom(&repo, "agent-cleared", "aionui-cleared-override-agent").await;

    set_override(install_dir.path());
    let registry = AgentRegistry::new(repo);
    registry.hydrate().await.unwrap();
    assert!(registry.get("agent-cleared").await.unwrap().available);
    let data_dir = tempfile::tempdir().unwrap();
    let service = AgentService::new(
        registry.clone(),
        Arc::new(NoopBroadcaster),
        provider_repo,
        [0; 32],
        data_dir.path().to_path_buf(),
    );

    service.refresh_agent_path(String::new()).await;

    assert_eq!(
        aionui_runtime::path_override(),
        None,
        "empty PATH must clear the override"
    );
    assert!(
        !registry.get("agent-cleared").await.unwrap().available,
        "after clearing, the process PATH (without the temp dir) is used again"
    );
}

// ── hydrate with concurrent probing stays complete and stable ───────────────

#[tokio::test]
async fn concurrent_hydrate_keeps_every_row_and_records_unavailable_reasons() {
    let _guard = lock_override().await;
    let install_dir = tempfile::tempdir().unwrap();
    let repo = repo().await;

    const AGENT_COUNT: usize = 24;
    let mut expected_available = Vec::new();
    let mut expected_missing = Vec::new();
    for i in 0..AGENT_COUNT {
        let id = format!("agent-concurrent-{i:02}");
        let command = format!("aionui-concurrent-agent-{i:02}");
        if i % 2 == 0 {
            write_fake_cli(install_dir.path(), &command, "1.0.0", 0);
            expected_available.push(id.clone());
        } else {
            expected_missing.push((id.clone(), command.clone()));
        }
        upsert_custom(&repo, &id, &command).await;
    }
    let db_row_count = repo.list_all().await.unwrap().len();

    // Every seed row resolves against the temp dir only, so probing is fast
    // and independent of what happens to be installed on the test host.
    set_override(install_dir.path());
    let registry = AgentRegistry::new(repo);
    registry.hydrate().await.unwrap();

    let all = registry.list_all_including_hidden().await;
    assert_eq!(all.len(), db_row_count, "hydrate must keep every DB row");
    let ids: std::collections::HashSet<_> = all.iter().map(|meta| meta.id.clone()).collect();
    assert_eq!(ids.len(), db_row_count, "no duplicate ids");

    for id in &expected_available {
        let meta = registry.get(id).await.unwrap_or_else(|| panic!("{id} missing"));
        assert!(meta.available, "{id} should be available");
        assert!(meta.resolved_command.is_some(), "{id} should record its resolved path");
    }
    let diagnostics = registry.diagnostic_snapshot().await;
    for (id, command) in &expected_missing {
        let meta = registry.get(id).await.unwrap_or_else(|| panic!("{id} missing"));
        assert!(!meta.available, "{id} should be unavailable");
        let (_, reason) = diagnostics.iter().find(|(meta, _)| &meta.id == id).unwrap();
        assert!(
            matches!(reason, Some(UnavailableReason::CommandMissing { command: c }) if c == command),
            "{id} should record CommandMissing({command}), got {reason:?}"
        );
    }

    // A second hydrate (and a refresh, which shares the concurrent runner)
    // must produce the same verdict for every row.
    let snapshot = |metas: Vec<aionui_api_types::AgentMetadata>| {
        let mut rows: Vec<_> = metas.into_iter().map(|m| (m.id, m.available)).collect();
        rows.sort();
        rows
    };
    let first = snapshot(all);
    registry.hydrate().await.unwrap();
    assert_eq!(snapshot(registry.list_all_including_hidden().await), first);
    registry.refresh_availability().await;
    assert_eq!(snapshot(registry.list_all_including_hidden().await), first);
}

#[tokio::test]
async fn hydrate_with_empty_path_override_marks_custom_agents_missing() {
    let _guard = lock_override().await;
    let empty = tempfile::tempdir().unwrap();
    let repo = repo().await;
    upsert_custom(&repo, "agent-nothing-on-path", "aionui-nothing-on-path").await;
    let db_row_count = repo.list_all().await.unwrap().len();

    set_override(empty.path());
    let registry = AgentRegistry::new(repo);
    registry.hydrate().await.unwrap();

    assert_eq!(registry.list_all_including_hidden().await.len(), db_row_count);
    let meta = registry.get("agent-nothing-on-path").await.unwrap();
    assert!(!meta.available);
}

// ── manual health check reloads a newly installed agent ─────────────────────

async fn builtin_claude_fixture(
    override_dir: &Path,
) -> (Arc<AgentRegistry>, Arc<AgentService>, String, String, tempfile::TempDir) {
    let db = init_database_memory().await.unwrap();
    let repo: Arc<dyn IAgentMetadataRepository> = Arc::new(SqliteAgentMetadataRepository::new(db.pool().clone()));
    let provider_repo: Arc<dyn IProviderRepository> = Arc::new(SqliteProviderRepository::new(db.pool().clone()));
    set_override(override_dir);
    let registry = AgentRegistry::new(repo);
    registry.hydrate().await.unwrap();
    let claude = registry
        .find_builtin_by_backend("claude")
        .await
        .expect("seeded builtin claude row");
    let binary = claude
        .agent_source_info
        .binary_name
        .clone()
        .expect("builtin claude declares its primary binary");
    let data_dir = tempfile::tempdir().unwrap();
    let service = AgentService::new(
        registry.clone(),
        Arc::new(NoopBroadcaster),
        provider_repo,
        [0; 32],
        data_dir.path().to_path_buf(),
    );
    (registry, service, claude.id, binary, data_dir)
}

#[tokio::test]
async fn manual_health_check_online_reloads_agent_that_was_unavailable() {
    let _guard = lock_override().await;
    let install_dir = tempfile::tempdir().unwrap();
    let (registry, service, claude_id, binary, _data_dir) = builtin_claude_fixture(install_dir.path()).await;
    assert!(
        !registry.get(&claude_id).await.unwrap().available,
        "builtin claude must start unavailable with an empty PATH"
    );

    // CLI installed after startup, in the directory the PATH now lists.
    write_fake_cli(install_dir.path(), &binary, "1.0.0", 0);

    let row = service
        .health_check_agent_by_id(SYSTEM_DEFAULT_USER_ID, &claude_id)
        .await
        .expect("manual health check");

    assert_eq!(
        row.last_check_status,
        Some(aionui_api_types::AgentSnapshotCheckStatus::Online),
        "fake CLI answers --version, so the manual check is online"
    );
    let meta = registry.get(&claude_id).await.unwrap();
    assert!(meta.available, "an online manual check must reload the registry row");
    assert!(meta.resolved_command.is_some());
}

#[tokio::test]
async fn manual_health_check_offline_does_not_reload_unavailable_agent() {
    let _guard = lock_override().await;
    let install_dir = tempfile::tempdir().unwrap();
    let (registry, service, claude_id, binary, _data_dir) = builtin_claude_fixture(install_dir.path()).await;
    assert!(!registry.get(&claude_id).await.unwrap().available);

    // Installed but broken: `--version` exits non-zero.
    write_fake_cli(install_dir.path(), &binary, "broken install", 1);

    let row = service
        .health_check_agent_by_id(SYSTEM_DEFAULT_USER_ID, &claude_id)
        .await
        .expect("manual health check");

    assert_eq!(
        row.last_check_status,
        Some(aionui_api_types::AgentSnapshotCheckStatus::Offline)
    );
    assert!(
        !registry.get(&claude_id).await.unwrap().available,
        "an offline check must not reload the row into the available set"
    );
}

#[tokio::test]
async fn manual_health_check_unknown_agent_returns_not_found() {
    let _guard = lock_override().await;
    let empty = tempfile::tempdir().unwrap();
    let (_registry, service, _claude_id, _binary, _data_dir) = builtin_claude_fixture(empty.path()).await;

    let err = service
        .health_check_agent_by_id(SYSTEM_DEFAULT_USER_ID, "agent-does-not-exist")
        .await
        .expect_err("unknown agent id must fail");

    assert!(
        err.to_string().contains("agent-does-not-exist"),
        "error should name the missing agent, got {err}"
    );
}
