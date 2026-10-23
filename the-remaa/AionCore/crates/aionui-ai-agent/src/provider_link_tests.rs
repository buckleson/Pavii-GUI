use super::*;
use aionui_api_types::{AgentHandshake, AgentSource, AgentSourceInfo, BehaviorPolicy};
use aionui_common::AgentType;
use aionui_common::encrypt_string;
use aionui_db::models::Provider;
use aionui_db::{CreateProviderParams, DbError, UpdateProviderParams};
use std::collections::HashSet;

const KEY: [u8; 32] = [0x42; 32];
const USER: &str = "user-a";
const OTHER_USER: &str = "user-b";
const PROVIDER_ID: &str = "prov-1";

/// In-memory provider repository scoped by `(user_id, id)`, like the real one.
#[derive(Default)]
struct FakeProviderRepo {
    providers: Vec<Provider>,
    fail_lookup: bool,
}

#[async_trait::async_trait]
impl IProviderRepository for FakeProviderRepo {
    async fn list(&self, user_id: &str) -> Result<Vec<Provider>, DbError> {
        Ok(self
            .providers
            .iter()
            .filter(|p| p.user_id == user_id)
            .cloned()
            .collect())
    }

    async fn find_by_id(&self, user_id: &str, id: &str) -> Result<Option<Provider>, DbError> {
        if self.fail_lookup {
            return Err(DbError::Init("lookup failed".into()));
        }
        Ok(self
            .providers
            .iter()
            .find(|p| p.user_id == user_id && p.id == id)
            .cloned())
    }

    async fn create(&self, _params: CreateProviderParams<'_>) -> Result<Provider, DbError> {
        unreachable!("provider_link never creates providers")
    }

    async fn update(&self, _user_id: &str, _id: &str, _params: UpdateProviderParams<'_>) -> Result<Provider, DbError> {
        unreachable!("provider_link never updates providers")
    }

    async fn delete(&self, _user_id: &str, _id: &str) -> Result<(), DbError> {
        unreachable!("provider_link never deletes providers")
    }
}

fn provider(platform: &str, base_url: &str, api_key: &str) -> Provider {
    Provider {
        id: PROVIDER_ID.to_owned(),
        user_id: USER.to_owned(),
        platform: platform.to_owned(),
        name: "Test Provider".to_owned(),
        base_url: base_url.to_owned(),
        api_key_encrypted: encrypt_string(api_key, &KEY).unwrap(),
        models: "[]".to_owned(),
        enabled: true,
        capabilities: "[]".to_owned(),
        context_limit: None,
        model_protocols: None,
        model_enabled: None,
        model_health: None,
        model_settings: "{}".to_owned(),
        bedrock_config: None,
        is_full_url: false,
        created_at: 0,
        updated_at: 0,
    }
}

fn repo_with(provider: Provider) -> FakeProviderRepo {
    FakeProviderRepo {
        providers: vec![provider],
        fail_lookup: false,
    }
}

fn meta(backend: Option<&str>, linked: Option<&str>) -> AgentMetadata {
    AgentMetadata {
        id: "agent-1".into(),
        icon: None,
        name: "Agent".into(),
        name_i18n: None,
        description: None,
        description_i18n: None,
        backend: backend.map(str::to_owned),
        agent_type: AgentType::Acp,
        agent_source: AgentSource::Builtin,
        agent_source_info: AgentSourceInfo::default(),
        enabled: true,
        available: true,
        command: None,
        resolved_command: None,
        args: vec![],
        env: vec![],
        native_skills_dirs: None,
        behavior_policy: BehaviorPolicy::default(),
        yolo_id: None,
        sort_order: 0,
        team_capable: false,
        last_check_status: None,
        last_check_kind: None,
        last_check_error_code: None,
        last_check_error_message: None,
        last_check_error_details: None,
        last_check_guidance: None,
        last_check_latency_ms: None,
        last_check_at: None,
        last_success_at: None,
        last_failure_at: None,
        handshake: AgentHandshake::default(),
        has_command_override: false,
        env_override_key_count: 0,
        linked_provider_id: linked.map(str::to_owned),
    }
}

fn env_entry(name: &str, value: &str) -> AgentEnvEntry {
    AgentEnvEntry {
        name: name.to_owned(),
        value: value.to_owned(),
        description: None,
    }
}

fn env_pairs(meta: &AgentMetadata) -> Vec<(String, String)> {
    meta.env.iter().map(|e| (e.name.clone(), e.value.clone())).collect()
}

async fn inject(meta: &mut AgentMetadata, repo: &FakeProviderRepo) {
    inject_linked_provider_env(meta, repo, &KEY, USER).await;
}

async fn assert_nothing_injected(backend: Option<&str>, repo: FakeProviderRepo) {
    let mut m = meta(backend, Some(PROVIDER_ID));
    m.env.push(env_entry("SEED_VAR", "seed"));
    inject(&mut m, &repo).await;
    assert_eq!(env_pairs(&m), vec![("SEED_VAR".to_owned(), "seed".to_owned())]);
}

// -- mapping table ---------------------------------------------------------

#[test]
fn backend_mapping_names_are_unique() {
    let mut seen = HashSet::new();
    for (name, _) in BACKEND_MAPPINGS {
        assert!(seen.insert(*name), "duplicate backend mapping '{name}'");
    }
}

#[test]
fn every_backend_mapping_has_non_empty_platforms() {
    for (name, mappings) in BACKEND_MAPPINGS {
        assert!(!mappings.is_empty(), "backend '{name}' has no mappings");
        for mapping in *mappings {
            assert!(
                !mapping.platforms.is_empty(),
                "backend '{name}' has a mapping with no platforms"
            );
            assert!(
                !mapping.api_key_var.is_empty(),
                "backend '{name}' has an empty api key var"
            );
        }
    }
}

#[test]
fn link_platforms_for_qwen_are_openai_compatible() {
    assert_eq!(link_platforms_for_backend(Some("qwen")), vec!["custom", "openai"]);
}

#[test]
fn link_platforms_for_hermes_cover_all_three_mappings() {
    assert_eq!(
        link_platforms_for_backend(Some("hermes")),
        vec!["custom", "openai", "anthropic", "gemini"]
    );
}

#[test]
fn link_platforms_for_unlisted_backends_are_empty() {
    assert!(link_platforms_for_backend(Some("codex")).is_empty());
    assert!(link_platforms_for_backend(Some("openclaw")).is_empty());
    assert!(link_platforms_for_backend(Some("")).is_empty());
    assert!(link_platforms_for_backend(None).is_empty());
}

#[test]
fn mapping_for_gemini_is_key_only() {
    let mapping = mapping_for(Some("gemini"), "gemini").expect("gemini mapping");
    assert_eq!(mapping.api_key_var, "GEMINI_API_KEY");
    assert_eq!(mapping.base_url_var, None);
}

#[test]
fn mapping_for_qwen_custom_carries_base_url_var() {
    let mapping = mapping_for(Some("qwen"), "custom").expect("qwen custom mapping");
    assert_eq!(mapping.api_key_var, "OPENAI_API_KEY");
    assert_eq!(mapping.base_url_var, Some("OPENAI_BASE_URL"));
}

#[test]
fn mapping_for_goose_gemini_uses_google_api_key() {
    let mapping = mapping_for(Some("goose"), "gemini").expect("goose gemini mapping");
    assert_eq!(mapping.api_key_var, "GOOGLE_API_KEY");
}

#[test]
fn mapping_for_unsupported_platform_or_backend_is_none() {
    assert_eq!(mapping_for(Some("opencode"), "custom"), None);
    assert_eq!(mapping_for(Some("gemini"), "openai"), None);
    assert_eq!(mapping_for(Some("codex"), "openai"), None);
    assert_eq!(mapping_for(None, "gemini"), None);
}

#[test]
fn mapping_for_is_case_sensitive_on_backend() {
    assert_eq!(mapping_for(Some("Gemini"), "gemini"), None);
}

// -- injection -------------------------------------------------------------

#[tokio::test]
async fn no_link_leaves_env_unchanged() {
    let repo = FakeProviderRepo {
        providers: vec![],
        fail_lookup: true,
    };
    let mut m = meta(Some("gemini"), None);
    m.env.push(env_entry("SEED_VAR", "seed"));
    inject(&mut m, &repo).await;
    assert_eq!(env_pairs(&m), vec![("SEED_VAR".to_owned(), "seed".to_owned())]);
}

#[tokio::test]
async fn gemini_backend_injects_only_gemini_api_key() {
    let repo = repo_with(provider(
        "gemini",
        "https://generativelanguage.googleapis.com",
        "gm-key",
    ));
    let mut m = meta(Some("gemini"), Some(PROVIDER_ID));
    inject(&mut m, &repo).await;
    assert_eq!(env_pairs(&m), vec![("GEMINI_API_KEY".to_owned(), "gm-key".to_owned())]);
}

#[tokio::test]
async fn qwen_custom_provider_injects_key_and_trimmed_base_url() {
    let repo = repo_with(provider("custom", "  https://llm.example.com/v1 \n", "sk-custom"));
    let mut m = meta(Some("qwen"), Some(PROVIDER_ID));
    inject(&mut m, &repo).await;
    assert_eq!(
        env_pairs(&m),
        vec![
            ("OPENAI_API_KEY".to_owned(), "sk-custom".to_owned()),
            ("OPENAI_BASE_URL".to_owned(), "https://llm.example.com/v1".to_owned()),
        ]
    );
}

#[tokio::test]
async fn hermes_anthropic_provider_injects_anthropic_vars() {
    let repo = repo_with(provider("anthropic", "https://api.anthropic.com", "sk-ant"));
    let mut m = meta(Some("hermes"), Some(PROVIDER_ID));
    inject(&mut m, &repo).await;
    assert_eq!(
        env_pairs(&m),
        vec![
            ("ANTHROPIC_API_KEY".to_owned(), "sk-ant".to_owned()),
            ("ANTHROPIC_BASE_URL".to_owned(), "https://api.anthropic.com".to_owned()),
        ]
    );
}

#[tokio::test]
async fn key_and_url_backend_with_empty_base_url_injects_nothing() {
    assert_nothing_injected(Some("qwen"), repo_with(provider("custom", "", "sk-custom"))).await;
}

#[tokio::test]
async fn key_and_url_backend_with_whitespace_base_url_injects_nothing() {
    assert_nothing_injected(Some("qwen"), repo_with(provider("custom", "   ", "sk-custom"))).await;
}

#[tokio::test]
async fn key_and_url_backend_with_full_url_provider_injects_nothing() {
    let mut p = provider("custom", "https://llm.example.com/v1/chat/completions", "sk-custom");
    p.is_full_url = true;
    assert_nothing_injected(Some("qwen"), repo_with(p)).await;
}

#[tokio::test]
async fn key_only_backend_ignores_is_full_url() {
    let mut p = provider("gemini", "https://example.com/full", "gm-key");
    p.is_full_url = true;
    let repo = repo_with(p);
    let mut m = meta(Some("gemini"), Some(PROVIDER_ID));
    inject(&mut m, &repo).await;
    assert_eq!(env_pairs(&m), vec![("GEMINI_API_KEY".to_owned(), "gm-key".to_owned())]);
}

#[tokio::test]
async fn third_party_platform_on_key_only_backend_injects_nothing() {
    assert_nothing_injected(
        Some("opencode"),
        repo_with(provider("custom", "https://llm.example.com/v1", "sk-custom")),
    )
    .await;
}

#[tokio::test]
async fn unlisted_backends_inject_nothing() {
    for backend in [Some("codex"), Some("openclaw"), None] {
        assert_nothing_injected(
            backend,
            repo_with(provider("openai", "https://api.openai.com/v1", "sk-oa")),
        )
        .await;
    }
}

#[tokio::test]
async fn disabled_provider_injects_nothing() {
    let mut p = provider("gemini", "", "gm-key");
    p.enabled = false;
    assert_nothing_injected(Some("gemini"), repo_with(p)).await;
}

#[tokio::test]
async fn missing_provider_injects_nothing() {
    assert_nothing_injected(Some("gemini"), FakeProviderRepo::default()).await;
}

#[tokio::test]
async fn provider_of_another_user_injects_nothing() {
    let mut p = provider("gemini", "", "gm-key");
    p.user_id = OTHER_USER.to_owned();
    assert_nothing_injected(Some("gemini"), repo_with(p)).await;
}

#[tokio::test]
async fn provider_lookup_error_injects_nothing() {
    let mut repo = repo_with(provider("gemini", "", "gm-key"));
    repo.fail_lookup = true;
    assert_nothing_injected(Some("gemini"), repo).await;
}

#[tokio::test]
async fn empty_decrypted_key_injects_nothing() {
    assert_nothing_injected(Some("gemini"), repo_with(provider("gemini", "", ""))).await;
}

#[tokio::test]
async fn whitespace_decrypted_key_injects_nothing() {
    assert_nothing_injected(Some("gemini"), repo_with(provider("gemini", "", "  \t "))).await;
}

#[tokio::test]
async fn undecryptable_ciphertext_injects_nothing() {
    let mut p = provider("gemini", "", "gm-key");
    p.api_key_encrypted = "not-valid-ciphertext".to_owned();
    assert_nothing_injected(Some("gemini"), repo_with(p)).await;
}

#[tokio::test]
async fn key_encrypted_with_other_key_injects_nothing() {
    let mut p = provider("gemini", "", "gm-key");
    p.api_key_encrypted = encrypt_string("gm-key", &[0x01; 32]).unwrap();
    assert_nothing_injected(Some("gemini"), repo_with(p)).await;
}

#[tokio::test]
async fn existing_env_var_is_kept_while_other_var_is_added() {
    let repo = repo_with(provider("custom", "https://llm.example.com/v1", "sk-linked"));
    let mut m = meta(Some("qwen"), Some(PROVIDER_ID));
    m.env.push(env_entry("OPENAI_API_KEY", "sk-user-override"));
    inject(&mut m, &repo).await;
    assert_eq!(
        env_pairs(&m),
        vec![
            ("OPENAI_API_KEY".to_owned(), "sk-user-override".to_owned()),
            ("OPENAI_BASE_URL".to_owned(), "https://llm.example.com/v1".to_owned()),
        ]
    );
}

#[tokio::test]
async fn existing_base_url_var_is_kept_while_key_is_added() {
    let repo = repo_with(provider("custom", "https://llm.example.com/v1", "sk-linked"));
    let mut m = meta(Some("qwen"), Some(PROVIDER_ID));
    m.env.push(env_entry("OPENAI_BASE_URL", "https://user.example.com"));
    inject(&mut m, &repo).await;
    assert_eq!(
        env_pairs(&m),
        vec![
            ("OPENAI_BASE_URL".to_owned(), "https://user.example.com".to_owned()),
            ("OPENAI_API_KEY".to_owned(), "sk-linked".to_owned()),
        ]
    );
}

#[tokio::test]
async fn resolve_linked_env_reports_reason_for_unlisted_backend() {
    let repo = repo_with(provider("openai", "https://api.openai.com/v1", "sk-oa"));
    let m = meta(Some("codex"), Some(PROVIDER_ID));
    let err = resolve_linked_env(&m, PROVIDER_ID, &repo, &KEY, USER)
        .await
        .unwrap_err();
    assert_eq!(err, "backend has no verified provider env mapping");
}

#[tokio::test]
async fn resolve_linked_env_reports_reason_for_unsupported_platform() {
    let repo = repo_with(provider("custom", "https://llm.example.com/v1", "sk-custom"));
    let m = meta(Some("opencode"), Some(PROVIDER_ID));
    let err = resolve_linked_env(&m, PROVIDER_ID, &repo, &KEY, USER)
        .await
        .unwrap_err();
    assert_eq!(err, "provider platform not supported by backend");
}
