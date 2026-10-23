//! External-session import operations on ConversationService: binding an
//! agent CLI's session id as the resume anchor, importing transcript
//! messages into an empty conversation, and the per-user sessions index.

use aionui_api_types::{ImportMessagesRequest, ImportMessagesResponse, SessionIndexEntry, SetBackendSessionRequest};
use aionui_db::NewMessageParams;
use tracing::info;

use crate::ConversationError;
use crate::service::ConversationService;

/// Most messages one import request may carry.
pub const MAX_IMPORT_MESSAGES: usize = 5000;
/// Most total message text (UTF-8 bytes) one import request may carry.
pub const MAX_IMPORT_TEXT_BYTES: usize = 20 * 1024 * 1024;
/// Most conversations the sessions index returns (newest first).
pub const SESSION_INDEX_LIMIT: u32 = 2000;

/// Whether `value` is a bare hyphenated UUID (`8-4-4-4-12` hex digits).
///
/// claude's `--resume` only accepts a valid UUID (see `claude_session_id_for`
/// in `aionui-session/src/backend/claude_conn.rs`); the bare hyphenated form is
/// the one claude itself echoes in `system/init`, so only that form is accepted.
fn is_bare_uuid(value: &str) -> bool {
    value.len() == 36
        && value.char_indices().all(|(index, ch)| match index {
            8 | 13 | 18 | 23 => ch == '-',
            _ => ch.is_ascii_hexdigit(),
        })
}

fn extra_str(extra: &serde_json::Value, key: &str) -> Option<String> {
    extra
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

impl ConversationService {
    /// Bind an agent CLI's own session id as the conversation's resume anchor.
    pub async fn set_backend_session(
        &self,
        user_id: &str,
        conversation_id: &str,
        req: SetBackendSessionRequest,
    ) -> Result<(), ConversationError> {
        let row = self
            .conversation_repo()
            .get(user_id, conversation_id)
            .await?
            .ok_or_else(|| ConversationError::NotFound {
                id: conversation_id.to_owned(),
            })?;

        let session_id = req.session_id.trim();
        if session_id.is_empty() {
            return Err(ConversationError::BadRequest {
                reason: "session_id must not be empty".into(),
            });
        }

        let acp_row = self
            .acp_session_repo()
            .get_for_user(user_id, conversation_id)
            .await
            .map_err(|e| ConversationError::internal(format!("acp_session lookup: {e}")))?;
        if acp_row.is_none() {
            return Err(ConversationError::BadRequest {
                reason: "this conversation type has no backend session to bind".into(),
            });
        }

        let extra: serde_json::Value = serde_json::from_str(&row.extra).unwrap_or(serde_json::Value::Null);
        if extra_str(&extra, "backend").as_deref() == Some("claude") && !is_bare_uuid(session_id) {
            return Err(ConversationError::BadRequest {
                reason: "session_id must be a UUID for claude conversations".into(),
            });
        }

        let updated = self
            .acp_session_repo()
            .update_session_id_for_user(user_id, conversation_id, session_id)
            .await
            .map_err(|e| ConversationError::internal(format!("Failed to bind backend session: {e}")))?;
        if !updated {
            return Err(ConversationError::NotFound {
                id: conversation_id.to_owned(),
            });
        }
        info!(conversation_id, "Bound imported backend session id");

        crate::pavii_index::sync_conversation_entry(
            self.conversation_repo().as_ref(),
            self.acp_session_repo().as_ref(),
            self.workspace_root(),
            user_id,
            conversation_id,
            Some(session_id),
        )
        .await;
        Ok(())
    }

    /// Import transcript messages into an empty conversation in one transaction.
    pub async fn import_messages(
        &self,
        user_id: &str,
        conversation_id: &str,
        req: ImportMessagesRequest,
    ) -> Result<ImportMessagesResponse, ConversationError> {
        self.conversation_repo()
            .get(user_id, conversation_id)
            .await?
            .ok_or_else(|| ConversationError::NotFound {
                id: conversation_id.to_owned(),
            })?;

        if req.messages.is_empty() {
            return Err(ConversationError::BadRequest {
                reason: "messages must not be empty".into(),
            });
        }
        if req.messages.len() > MAX_IMPORT_MESSAGES {
            return Err(ConversationError::BadRequest {
                reason: format!("too many messages: at most {MAX_IMPORT_MESSAGES} can be imported at once"),
            });
        }
        let total_text_bytes: usize = req.messages.iter().map(|message| message.text.len()).sum();
        if total_text_bytes > MAX_IMPORT_TEXT_BYTES {
            return Err(ConversationError::BadRequest {
                reason: "messages exceed the 20 MB total text limit".into(),
            });
        }

        let mut contents = Vec::with_capacity(req.messages.len());
        for (index, message) in req.messages.iter().enumerate() {
            let position = match message.role.as_str() {
                "user" => "right",
                "assistant" => "left",
                _ => {
                    return Err(ConversationError::BadRequest {
                        reason: format!("messages[{index}].role must be \"user\" or \"assistant\""),
                    });
                }
            };
            // Same row shape as a live plain-text message.
            let content = serde_json::json!({ "content": message.text }).to_string();
            contents.push((position, content, message.created_at));
        }
        let params: Vec<NewMessageParams<'_>> = contents
            .iter()
            .map(|(position, content, created_at)| NewMessageParams {
                message_type: "text",
                content,
                position,
                status: "finish",
                created_at: *created_at,
            })
            .collect();

        let imported = self
            .conversation_repo()
            .insert_messages(user_id, conversation_id, &params)
            .await?;
        info!(conversation_id, imported, "Imported conversation messages");
        Ok(ImportMessagesResponse { imported })
    }

    /// The user's conversations (newest first, capped) with their backend
    /// session identity and workspace, for matching external CLI sessions.
    pub async fn sessions_index(&self, user_id: &str) -> Result<Vec<SessionIndexEntry>, ConversationError> {
        let rows = self
            .conversation_repo()
            .list_session_index(user_id, SESSION_INDEX_LIMIT)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let extra: serde_json::Value = serde_json::from_str(&row.extra).unwrap_or(serde_json::Value::Null);
                let agent_id = row
                    .acp_agent_id
                    .filter(|id| !id.trim().is_empty())
                    .or_else(|| extra_str(&extra, "agent_id"));
                SessionIndexEntry {
                    conversation_id: row.id,
                    title: row.name,
                    agent_id,
                    backend: extra_str(&extra, "backend"),
                    backend_session_id: row.backend_session_id,
                    workspace: extra_str(&extra, "workspace"),
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                }
            })
            .collect())
    }
}
