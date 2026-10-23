//! Business-logic layer for the ai-agent crate.
//!
//! Per `AGENTS.md` "Domain Crate Structure", this is the sole location
//! for agent-related business logic. HTTP handlers in `routes/` should
//! only extract inputs, call methods on this service, and wrap the
//! result in `ApiResponse`.
//!
//! Session-scoped operations (mode/model/config/usage/capabilities/
//! slash-commands/side-question/workspace/openclaw-runtime) now live in
//! `aionui-conversation::ConversationService`, which dispatches through
//! `AgentInstance`. This service retains only agent-catalog and
//! ACP health-check responsibilities, plus support for the custom-agent
//! CRUD endpoints (see `services::custom`).

use std::path::PathBuf;
use std::sync::Arc;

use aionui_api_types::{AgentLogoEntry, AgentManagementRow, ProviderHealthCheckRequest, ProviderHealthCheckResponse};
use aionui_db::IProviderRepository;
use aionui_realtime::EventBroadcaster;

use super::availability::{AgentAvailabilityFeedbackPort, AgentAvailabilityService};
use super::provider_health::ProviderHealthCheckService;
use crate::error::AgentError;
use crate::registry::AgentRegistry;

pub struct AgentService {
    registry: Arc<AgentRegistry>,
    broadcaster: Arc<dyn EventBroadcaster>,
    provider_repo: Arc<dyn IProviderRepository>,
    provider_health: ProviderHealthCheckService,
    availability: AgentAvailabilityService,
}

impl AgentService {
    pub fn new(
        registry: Arc<AgentRegistry>,
        broadcaster: Arc<dyn EventBroadcaster>,
        provider_repo: Arc<dyn IProviderRepository>,
        encryption_key: [u8; 32],
        data_dir: PathBuf,
    ) -> Arc<Self> {
        let provider_health = ProviderHealthCheckService::new(provider_repo.clone(), encryption_key, data_dir.clone());
        let availability = AgentAvailabilityService::new(registry.clone(), provider_repo.clone());
        Arc::new(Self {
            registry,
            broadcaster,
            provider_repo,
            provider_health,
            availability,
        })
    }

    /// Registry accessor consumed by the `services::custom` submodule
    /// for direct repository access (upsert / delete / enable toggle).
    pub(crate) fn registry(&self) -> &Arc<AgentRegistry> {
        &self.registry
    }

    pub(crate) fn broadcaster(&self) -> &Arc<dyn EventBroadcaster> {
        &self.broadcaster
    }

    pub fn availability_feedback_port(&self) -> Arc<dyn AgentAvailabilityFeedbackPort> {
        Arc::new(self.availability.clone())
    }
}

// Agent operations
impl AgentService {
    pub async fn list_management_agents(&self, user_id: &str) -> Result<Vec<AgentManagementRow>, AgentError> {
        self.availability.list_management_rows(user_id).await
    }

    /// Backend → logo URL catalog for business surfaces.
    ///
    /// Business pages (guid, team, cron, conversation lists) must render
    /// an agent logo from a backend identifier alone, without owning a
    /// hardcoded path map. This projects every known agent row — including
    /// user-disabled or currently-missing ones, so historical conversations
    /// still resolve a logo — down to its `backend` and stored `icon` URL.
    pub async fn list_agent_logos(&self) -> Result<Vec<AgentLogoEntry>, AgentError> {
        let mut seen = std::collections::HashSet::new();
        let mut entries = Vec::new();
        for agent in self.registry.list_all_including_hidden().await {
            let Some(logo) = agent.icon.filter(|value| !value.is_empty()) else {
                continue;
            };
            // Frontend rows resolve a logo from the conversation's runtime key,
            // which is the vendor `backend` for ACP agents but the `agent_type`
            // for backends without a vendor label (e.g. aionrs, where `backend`
            // is NULL). Key on `backend` when present, otherwise the agent_type.
            let key = agent
                .backend
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| agent.agent_type.serde_name().to_owned());
            if key.is_empty() {
                continue;
            }
            if seen.insert(key.clone()) {
                entries.push(AgentLogoEntry { backend: key, logo });
            }
        }
        Ok(entries)
    }

    pub async fn health_check_agent_by_id(&self, user_id: &str, id: &str) -> Result<AgentManagementRow, AgentError> {
        self.availability.run_manual_health_check(user_id, id).await
    }

    /// Re-detect every agent against `path`, the user's current PATH as
    /// re-read by the desktop shell. Lets a CLI installed after the engine
    /// started be found without a restart.
    pub async fn refresh_agent_path(&self, path: String) {
        aionui_runtime::set_path_override(Some(path.into()));
        self.registry.refresh_availability().await;
    }

    pub async fn provider_health_check(
        &self,
        user_id: &str,
        req: ProviderHealthCheckRequest,
    ) -> Result<ProviderHealthCheckResponse, AgentError> {
        self.provider_health.health_check(user_id, req).await
    }

    pub async fn set_agent_overrides(
        &self,
        user_id: &str,
        id: &str,
        req: aionui_api_types::SetAgentOverridesRequest,
    ) -> Result<AgentManagementRow, AgentError> {
        let repo = self.registry.repo_handle();
        let row = repo
            .get_for_user(user_id, id)
            .await
            .map_err(|e| AgentError::internal(format!("repo.get_for_user: {e}")))?
            .ok_or_else(|| AgentError::not_found(format!("Agent '{id}' not found")))?;

        let command_override = req
            .command_override
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let has_env_override = req
            .env_override
            .as_ref()
            .is_some_and(|entries| entries.iter().any(|entry| !entry.name.trim().is_empty()));

        if (command_override.is_some() || has_env_override) && is_internal_aion_cli_row(&row) {
            return Err(AgentError::bad_request(
                "The built-in Pavii CLI does not support overrides",
            ));
        }

        // Launch-path overrides only make sense for direct-CLI rows. Bridge-launched
        // rows (e.g. `npx`) keep the bridge's own arguments in `args` (such as
        // `-y <package> acp`); swapping `command` for a launch path would feed those
        // bridge arguments to the target binary and break startup. Reject the write so
        // the stored spawn command stays coherent (env overrides remain allowed).
        if command_override.is_some() && is_bridge_launched_row(&row) {
            return Err(AgentError::bad_request(
                "This agent launches through a package runner (npx); its launch path cannot be overridden. Use environment variables instead.",
            ));
        }

        let env_json = match req.env_override {
            Some(entries) if !entries.is_empty() => Some(
                serde_json::to_string(&entries)
                    .map_err(|e| AgentError::internal(format!("encode env_override: {e}")))?,
            ),
            _ => None,
        };

        repo.update_agent_overrides_for_user(user_id, id, command_override.as_deref(), env_json.as_deref())
            .await
            .map_err(|e| AgentError::internal(format!("repo.update_agent_overrides_for_user: {e}")))?;

        self.availability.run_manual_health_check(user_id, id).await
    }

    /// Link the agent to one of the caller's saved model providers
    /// (`provider_id = Some`) or clear the link (`None` / blank).
    ///
    /// Errors: unknown agent -> NotFound; unknown provider (or one owned by
    /// another user) -> NotFound; a provider whose platform has no verified
    /// env mapping for this agent's backend -> BadRequest.
    pub async fn set_agent_provider_link(
        &self,
        user_id: &str,
        id: &str,
        req: aionui_api_types::SetAgentProviderLinkRequest,
    ) -> Result<(), AgentError> {
        let repo = self.registry.repo_handle();
        let row = repo
            .get_for_user(user_id, id)
            .await
            .map_err(|e| AgentError::internal(format!("repo.get_for_user: {e}")))?
            .ok_or_else(|| AgentError::not_found(format!("Agent '{id}' not found")))?;

        let provider_id = req
            .provider_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);

        if let Some(provider_id) = provider_id.as_deref() {
            let provider = self
                .provider_repo
                .find_by_id(user_id, provider_id)
                .await
                .map_err(|e| AgentError::internal(format!("provider_repo.find_by_id: {e}")))?
                .ok_or_else(|| AgentError::not_found(format!("Provider '{provider_id}' not found")))?;
            let backend = row.backend.as_deref();
            if crate::provider_link::link_platforms_for_backend(backend).is_empty() {
                return Err(AgentError::bad_request(format!(
                    "Agent '{id}' does not support linking a model provider"
                )));
            }
            if crate::provider_link::mapping_for(backend, &provider.platform).is_none() {
                return Err(AgentError::bad_request(format!(
                    "Provider platform '{}' is not supported by agent '{id}'",
                    provider.platform
                )));
            }
        }

        let updated = repo
            .set_linked_provider_for_user(user_id, id, provider_id.as_deref())
            .await
            .map_err(|e| AgentError::internal(format!("repo.set_linked_provider_for_user: {e}")))?;
        if !updated {
            return Err(AgentError::not_found(format!("Agent '{id}' not found")));
        }
        tracing::info!(
            agent_id = %id,
            provider_id = provider_id.as_deref().unwrap_or(""),
            linked = provider_id.is_some(),
            "agent provider link updated"
        );

        // The link lives on the machine-level catalog row; refresh the cache
        // so management reads reflect it. Spawns re-read the row per build.
        self.registry.reload_one(id).await?;
        Ok(())
    }

    pub async fn get_agent_overrides(
        &self,
        user_id: &str,
        id: &str,
    ) -> Result<aionui_api_types::AgentOverridesResponse, AgentError> {
        let row = self
            .registry
            .repo_handle()
            .get_for_user(user_id, id)
            .await
            .map_err(|e| AgentError::internal(format!("repo.get_for_user: {e}")))?
            .ok_or_else(|| AgentError::not_found(format!("Agent '{id}' not found")))?;

        let env_override = row
            .env_override
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<aionui_api_types::AgentEnvEntry>>(s).ok())
            .unwrap_or_default();

        Ok(aionui_api_types::AgentOverridesResponse {
            command_override: if is_internal_aion_cli_row(&row) {
                None
            } else {
                row.command_override
            },
            env_override,
        })
    }
}

/// True when the row is launched through a bridge binary (e.g. `npx`) rather
/// than a direct CLI. Such rows store the bridge's own arguments in `args`
/// (e.g. `-y <package> acp`), so replacing `command` with a launch path would
/// forward those bridge arguments to the target binary. Launch-path overrides
/// are therefore only valid for direct-CLI rows (`command == binary_name`, no
/// bridge). Unparseable or absent `agent_source_info` is treated as direct.
fn is_bridge_launched_row(row: &aionui_db::AgentMetadataRow) -> bool {
    let Some(raw) = row.agent_source_info.as_deref() else {
        return false;
    };
    let Ok(info) = serde_json::from_str::<aionui_api_types::AgentSourceInfo>(raw) else {
        return false;
    };
    match info.bridge_binary.as_deref() {
        Some(bridge) => info.binary_name.as_deref() != Some(bridge),
        None => false,
    }
}

fn is_internal_aion_cli_row(row: &aionui_db::AgentMetadataRow) -> bool {
    row.agent_type.eq_ignore_ascii_case("aionrs") && row.agent_source.eq_ignore_ascii_case("internal")
}
