//! Request/response types for importing external CLI sessions into a
//! conversation: binding the CLI resume anchor, importing transcript
//! messages, and listing the per-user sessions index.

use aionui_common::TimestampMs;
use serde::{Deserialize, Serialize};

/// Body for `PUT /api/conversations/{id}/backend-session`.
///
/// Binds the agent CLI's own session id (the resume anchor) to the
/// conversation's `acp_session` row.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SetBackendSessionRequest {
    pub session_id: String,
}

/// One transcript message for `POST /api/conversations/{id}/messages/import`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ImportMessageItem {
    /// `"user"` or `"assistant"`; validated by the service so an unknown role
    /// gets a specific 400 instead of a generic deserialization error.
    pub role: String,
    pub text: String,
    /// Epoch milliseconds; kept verbatim on the stored row.
    pub created_at: TimestampMs,
}

/// Body for `POST /api/conversations/{id}/messages/import`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ImportMessagesRequest {
    pub messages: Vec<ImportMessageItem>,
}

/// Response for `POST /api/conversations/{id}/messages/import`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ImportMessagesResponse {
    pub imported: u64,
}

/// One entry of `GET /api/conversations/sessions-index`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SessionIndexEntry {
    pub conversation_id: String,
    pub title: String,
    pub agent_id: Option<String>,
    pub backend: Option<String>,
    /// The agent CLI's own session id (resume anchor), once bound.
    pub backend_session_id: Option<String>,
    pub workspace: Option<String>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}
