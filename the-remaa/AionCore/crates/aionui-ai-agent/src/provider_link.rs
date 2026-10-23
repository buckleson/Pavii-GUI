//! Opt-in "link a saved model provider to an agent" support.
//!
//! When an agent row carries `linked_provider_id`, the spawn path decrypts that
//! provider's API key and hands it to the agent CLI through the environment
//! variable(s) the CLI is *verified* to read. The mapping below is the single
//! source of truth for which backend accepts which provider `platform`; every
//! entry cites the upstream source it was verified against. A backend that is
//! not listed (or a platform not listed for it) gets no injection at all.
//!
//! Provider `platform` values are the strings Pavii stores in the `providers`
//! table: `custom` is the OpenAI-compatible platform (the OpenAI preset itself
//! is stored as `custom` with `https://api.openai.com/v1`), alongside
//! `openai`, `anthropic`, `gemini`, `gemini-vertex-ai`, `bedrock`, `new-api`
//! (see `factory/aionrs.rs` `map_aionrs_provider`).
//!
//! Entries that carry a base-URL variable route the key to the provider's own
//! endpoint; they are only injected when the provider has a usable base URL,
//! so a third-party key is never sent to a CLI's default (vendor) endpoint.
//! Entries without a base-URL variable are restricted to first-party
//! platforms, whose key belongs to the CLI's default endpoint anyway.

use aionui_api_types::{AgentEnvEntry, AgentMetadata};
use aionui_db::IProviderRepository;
use tracing::{info, warn};

/// One verified way to hand a provider's credentials to an agent CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderEnvMapping {
    /// Provider `platform` values this entry accepts.
    pub platforms: &'static [&'static str],
    /// Environment variable the CLI reads the API key from.
    pub api_key_var: &'static str,
    /// Environment variable the CLI reads the endpoint from, when it has one.
    pub base_url_var: Option<&'static str>,
}

const OPENAI_COMPATIBLE: &[&str] = &["custom", "openai"];

const fn key_only(platforms: &'static [&'static str], api_key_var: &'static str) -> ProviderEnvMapping {
    ProviderEnvMapping {
        platforms,
        api_key_var,
        base_url_var: None,
    }
}

const fn key_and_url(
    platforms: &'static [&'static str],
    api_key_var: &'static str,
    base_url_var: &'static str,
) -> ProviderEnvMapping {
    ProviderEnvMapping {
        platforms,
        api_key_var,
        base_url_var: Some(base_url_var),
    }
}

/// Backend label -> verified mappings. Backends absent here (e.g. `codex`,
/// whose `app-server` ignores env API keys, and `openclaw`, whose ACP bridge
/// forwards to a Gateway that owns the model credentials) support no link.
const BACKEND_MAPPINGS: &[(&str, &[ProviderEnvMapping])] = &[
    (
        "gemini",
        // verified: github.com/google-gemini/gemini-cli packages/core/src/core/contentGenerator.ts
        // (`getAuthTypeFromEnv`: GEMINI_API_KEY -> USE_GEMINI; apiKey from getEnv('GEMINI_API_KEY')).
        // GOOGLE_GEMINI_BASE_URL is deliberately not set: it switches auth to GATEWAY.
        &[key_only(&["gemini"], "GEMINI_API_KEY")],
    ),
    (
        "qwen",
        // verified: github.com/QwenLM/qwen-code docs/users/configuration/auth.md (protocol table:
        // OpenAI-compatible reads OPENAI_API_KEY / OPENAI_BASE_URL; "to select OpenAI-compatible
        // auth with environment variables alone, export OPENAI_API_KEY") and
        // packages/core/src/models/constants.ts (apiKey ['OPENAI_API_KEY'], baseUrl ['OPENAI_BASE_URL']).
        &[key_and_url(OPENAI_COMPATIBLE, "OPENAI_API_KEY", "OPENAI_BASE_URL")],
    ),
    (
        "hermes",
        // verified: github.com/NousResearch/hermes-agent website/docs/reference/environment-variables.md
        // (OPENAI_API_KEY + OPENAI_BASE_URL for a custom OpenAI-compatible endpoint;
        // ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL; GEMINI_API_KEY alias of GOOGLE_API_KEY).
        &[
            key_and_url(OPENAI_COMPATIBLE, "OPENAI_API_KEY", "OPENAI_BASE_URL"),
            key_and_url(&["anthropic"], "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"),
            key_only(&["gemini"], "GEMINI_API_KEY"),
        ],
    ),
    (
        "opencode",
        // verified: github.com/anomalyco/opencode packages/core/src/plugin/models-dev.ts (env auth
        // names come from each models.dev provider's `env` list) + github.com/sst/models.dev
        // providers/openai/provider.toml (env = ["OPENAI_API_KEY"]) and providers/anthropic/provider.toml
        // (env = ["ANTHROPIC_API_KEY"]). No base-URL env var is documented (baseURL is a config option,
        // packages/web/src/content/docs/providers.mdx), so only first-party platforms are mapped.
        &[
            key_only(&["openai"], "OPENAI_API_KEY"),
            key_only(&["anthropic"], "ANTHROPIC_API_KEY"),
        ],
    ),
    (
        "kilo",
        // verified: github.com/Kilo-Org/kilocode packages/opencode/src/provider/provider.ts ("load env":
        // `provider.env.map((item) => envs[item]).find(Boolean)` over the models.dev `env` list) +
        // models.dev providers/openai|anthropic/provider.toml as above. Google is omitted: its list has
        // three names and the loader passes no explicit key when `env.length !== 1`.
        &[
            key_only(&["openai"], "OPENAI_API_KEY"),
            key_only(&["anthropic"], "ANTHROPIC_API_KEY"),
        ],
    ),
    (
        "pi",
        // verified: github.com/earendil-works/pi packages/ai/src/env-api-keys.ts (openai: OPENAI_API_KEY,
        // anthropic: ANTHROPIC_API_KEY, google: GEMINI_API_KEY) + github.com/svkozak/pi-acp
        // src/pi-rpc/process.ts (spawns `pi --mode rpc` with `env: process.env`).
        &[
            key_only(&["openai"], "OPENAI_API_KEY"),
            key_only(&["anthropic"], "ANTHROPIC_API_KEY"),
            key_only(&["gemini"], "GEMINI_API_KEY"),
        ],
    ),
    (
        "goose",
        // verified: github.com/aaif-goose/goose crates/goose/src/config/base.rs (`get_secret` checks the
        // upper-cased env var before the keyring) + crates/goose/src/providers/openai_def.rs
        // (OPENAI_API_KEY), anthropic_def.rs (ANTHROPIC_API_KEY), google_def.rs (GOOGLE_API_KEY).
        // Hosts are not set: OPENAI_HOST is combined with OPENAI_BASE_PATH, which does not match
        // Pavii's stored base URL shape.
        &[
            key_only(&["openai"], "OPENAI_API_KEY"),
            key_only(&["anthropic"], "ANTHROPIC_API_KEY"),
            key_only(&["gemini"], "GOOGLE_API_KEY"),
        ],
    ),
    (
        "deepagents",
        // verified: github.com/langchain-ai/deepagentsjs libs/acp/src/cli.ts (default model
        // "claude-sonnet-4-5-20250929"; help lists ANTHROPIC_API_KEY) + libs/acp/README.md.
        // OPENAI_API_KEY is only used with a non-default `--model`, which the seed row does not pass.
        &[key_only(&["anthropic"], "ANTHROPIC_API_KEY")],
    ),
];

fn mappings_for_backend(backend: Option<&str>) -> &'static [ProviderEnvMapping] {
    let Some(backend) = backend else {
        return &[];
    };
    BACKEND_MAPPINGS
        .iter()
        .find(|(name, _)| *name == backend)
        .map(|(_, mappings)| *mappings)
        .unwrap_or(&[])
}

/// Provider platforms an agent with this backend can be linked to. Empty when
/// the backend has no verified provider-link mapping.
pub fn link_platforms_for_backend(backend: Option<&str>) -> Vec<String> {
    mappings_for_backend(backend)
        .iter()
        .flat_map(|mapping| mapping.platforms.iter().map(|platform| (*platform).to_owned()))
        .collect()
}

/// The verified mapping for `platform` on `backend`, if any.
pub fn mapping_for(backend: Option<&str>, platform: &str) -> Option<ProviderEnvMapping> {
    mappings_for_backend(backend)
        .iter()
        .find(|mapping| mapping.platforms.contains(&platform))
        .copied()
}

/// Append the linked provider's credentials to `meta.env` so both spawn paths
/// (ACP command spec and direct-CLI spawn env) observe them.
///
/// No-op when the agent has no link. Never fails the spawn: a missing,
/// disabled, unsupported or undecryptable provider is logged (agent id and
/// provider id only) and the agent starts without injection. A variable that
/// is already present in `meta.env` — the seed env or the user's env override —
/// is left untouched, so explicit user configuration always wins.
pub async fn inject_linked_provider_env(
    meta: &mut AgentMetadata,
    provider_repo: &dyn IProviderRepository,
    encryption_key: &[u8; 32],
    user_id: &str,
) {
    let Some(provider_id) = meta.linked_provider_id.clone() else {
        return;
    };
    let entries = match resolve_linked_env(meta, &provider_id, provider_repo, encryption_key, user_id).await {
        Ok(entries) => entries,
        Err(reason) => {
            warn!(
                agent_id = %meta.id,
                provider_id = %provider_id,
                reason,
                "linked provider not injected; spawning agent without provider credentials"
            );
            return;
        }
    };

    let mut injected = Vec::new();
    let mut kept_existing = Vec::new();
    for entry in entries {
        if meta.env.iter().any(|existing| existing.name == entry.name) {
            kept_existing.push(entry.name);
            continue;
        }
        injected.push(entry.name.clone());
        meta.env.push(entry);
    }
    info!(
        agent_id = %meta.id,
        provider_id = %provider_id,
        injected_vars = ?injected,
        kept_existing_vars = ?kept_existing,
        "linked provider credentials injected into agent spawn env"
    );
}

async fn resolve_linked_env(
    meta: &AgentMetadata,
    provider_id: &str,
    provider_repo: &dyn IProviderRepository,
    encryption_key: &[u8; 32],
    user_id: &str,
) -> Result<Vec<AgentEnvEntry>, &'static str> {
    if mappings_for_backend(meta.backend.as_deref()).is_empty() {
        return Err("backend has no verified provider env mapping");
    }
    let provider = provider_repo
        .find_by_id(user_id, provider_id)
        .await
        .map_err(|_| "provider lookup failed")?
        .ok_or("provider not found for user")?;
    if !provider.enabled {
        return Err("provider is disabled");
    }
    let mapping =
        mapping_for(meta.backend.as_deref(), &provider.platform).ok_or("provider platform not supported by backend")?;

    let base_url = provider.base_url.trim();
    if mapping.base_url_var.is_some() && (base_url.is_empty() || provider.is_full_url) {
        // Without the provider's own endpoint the CLI would send this key to
        // its default vendor endpoint.
        return Err("provider has no usable base URL for this backend");
    }

    let api_key = aionui_common::decrypt_string(&provider.api_key_encrypted, encryption_key)
        .map_err(|_| "provider API key could not be decrypted")?;
    if api_key.trim().is_empty() {
        return Err("provider API key is empty");
    }

    let mut entries = vec![AgentEnvEntry {
        name: mapping.api_key_var.to_owned(),
        value: api_key,
        description: None,
    }];
    if let Some(var) = mapping.base_url_var {
        entries.push(AgentEnvEntry {
            name: var.to_owned(),
            value: base_url.to_owned(),
            description: None,
        });
    }
    Ok(entries)
}

#[cfg(test)]
#[path = "provider_link_tests.rs"]
mod tests;
