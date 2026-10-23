#![allow(clippy::disallowed_types)]

use crate::state::ConversationRouterState;
use aionui_api_types::{
    ApiResponse, ImportMessagesRequest, ImportMessagesResponse, SessionIndexEntry, SetBackendSessionRequest,
    SetConfigOptionRequest, SetConfigOptionResponse, SideQuestionRequest, SideQuestionResponse, SlashCommandItem,
    UsageLedgerDay, UsageLedgerResponse, WorkspaceBrowseQuery, WorkspaceEntry,
};
use aionui_auth::CurrentUser;
use aionui_common::ApiError;
use axum::Router;
use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, Extension, Json, Path, Query, State};
use axum::routing::{get, post, put};

/// Build the conversation-ops router (no auth layer applied — the caller is
/// responsible for wrapping this with the auth middleware).
pub fn conversation_ops_routes(state: ConversationRouterState) -> Router {
    Router::new()
        .route("/api/conversations/{id}/side-question", post(side_question))
        .route("/api/conversations/{id}/slash-commands", get(get_slash_commands))
        .route("/api/conversations/{id}/usage", get(get_usage))
        .route("/api/usage/ledger", get(get_usage_ledger))
        .route(
            "/api/conversations/{id}/config-options/{option_id}",
            put(set_config_option),
        )
        .route("/api/conversations/{id}/workspace", get(browse_workspace))
        .route("/api/conversations/{id}/backend-session", put(set_backend_session))
        // Import bodies may carry up to 20 MB of text plus JSON framing, above
        // the global 10 MB body limit, so this route widens it for itself.
        .route(
            "/api/conversations/{id}/messages/import",
            post(import_messages).layer(DefaultBodyLimit::max(IMPORT_BODY_LIMIT)),
        )
        .route("/api/conversations/sessions-index", get(sessions_index))
        .with_state(state)
}

/// Body cap for message import: the 20 MB text limit plus JSON framing.
const IMPORT_BODY_LIMIT: usize = 32 * 1024 * 1024;

// ── Route handlers ─────────────────────────────────────────────────

async fn set_config_option(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path((id, option_id)): Path<(String, String)>,
    body: Result<Json<SetConfigOptionRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<SetConfigOptionResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    Ok(Json(ApiResponse::ok(
        state
            .service
            .set_config_option(&user.id, &id, &option_id, req)
            .await
            .map_err(ApiError::from)?,
    )))
}

async fn get_usage(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<Option<serde_json::Value>>>, ApiError> {
    Ok(Json(ApiResponse::ok(
        state.service.get_usage(&user.id, &id).await.map_err(ApiError::from)?,
    )))
}

/// The calling user's per-day token ledger.
///
/// User-scoped rather than conversation-scoped: this is what the profile
/// page totals, and it counts every surface — desktop chats, scheduled
/// tasks, channel turns and WebUI — because all of them run their turns
/// through the engine that writes it.
async fn get_usage_ledger(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<UsageLedgerResponse>>, ApiError> {
    let rows = state
        .usage_ledger
        .list_days(&user.id)
        .await
        .map_err(crate::error::ConversationError::from)
        .map_err(ApiError::from)?;

    let days = rows
        .into_iter()
        .map(|day| {
            (
                day.day,
                UsageLedgerDay {
                    tokens: day.tokens,
                    turns: day.turns,
                    by_model: day.by_model.into_iter().collect(),
                    by_backend: day.by_backend.into_iter().collect(),
                },
            )
        })
        .collect();

    Ok(Json(ApiResponse::ok(UsageLedgerResponse { days })))
}

async fn side_question(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(req): Json<SideQuestionRequest>,
) -> Result<Json<ApiResponse<SideQuestionResponse>>, ApiError> {
    Ok(Json(ApiResponse::ok(
        state
            .service
            .handle_side_question(&user.id, &id, req)
            .await
            .map_err(ApiError::from)?,
    )))
}

async fn get_slash_commands(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<Vec<SlashCommandItem>>>, ApiError> {
    Ok(Json(ApiResponse::ok(
        state
            .service
            .get_slash_commands(&user.id, &id)
            .await
            .map_err(ApiError::from)?,
    )))
}

async fn browse_workspace(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<String>,
    Query(query): Query<WorkspaceBrowseQuery>,
) -> Result<Json<ApiResponse<Vec<WorkspaceEntry>>>, ApiError> {
    Ok(Json(ApiResponse::ok(
        state
            .service
            .browse_workspace(&user.id, &id, query)
            .await
            .map_err(ApiError::from)?,
    )))
}

async fn set_backend_session(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<String>,
    body: Result<Json<SetBackendSessionRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<()>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    state
        .service
        .set_backend_session(&user.id, &id, req)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(ApiResponse::ok(())))
}

async fn import_messages(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<String>,
    body: Result<Json<ImportMessagesRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ImportMessagesResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    Ok(Json(ApiResponse::ok(
        state
            .service
            .import_messages(&user.id, &id, req)
            .await
            .map_err(ApiError::from)?,
    )))
}

async fn sessions_index(
    State(state): State<ConversationRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<SessionIndexEntry>>>, ApiError> {
    Ok(Json(ApiResponse::ok(
        state.service.sessions_index(&user.id).await.map_err(ApiError::from)?,
    )))
}
