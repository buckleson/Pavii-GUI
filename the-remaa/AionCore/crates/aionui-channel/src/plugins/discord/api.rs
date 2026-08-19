use std::time::Duration;

use reqwest::{Client, RequestBuilder, Response};
use tracing::{debug, warn};

use crate::callback;
use crate::error::ChannelError;
use crate::types::ActionButton;

use super::types::{
    AllowedMentions, CurrentUser, GatewayBotResponse, MessageReference, MessageResponse, RateLimitBody,
    SendMessageRequest,
};

const DISCORD_API_BASE: &str = "https://discord.com/api/v10";

/// Cap on how long we honor a Discord 429 `retry_after` before giving up.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(30);

/// Bot identity from `GET /users/@me`.
#[derive(Debug, Clone)]
pub(super) struct DiscordIdentity {
    /// Bot user id (snowflake) — used to filter self-echoes and strip mentions.
    pub id: String,
    pub display_name: Option<String>,
}

/// HTTP client for the Discord REST API (v10).
///
/// A single Bot Token authorizes every call via `Authorization: Bot <token>`.
pub(super) struct DiscordApi {
    client: Client,
    token: String,
}

/// Discord allows at most 5 buttons per action row and 5 rows per message.
const DISCORD_BUTTONS_PER_ROW: usize = 5;
const DISCORD_ROWS_PER_MESSAGE: usize = 5;

/// Render buttons as Discord message components.
///
/// Over-long rows are split rather than truncated: dropping a button would
/// silently remove a choice. Rows beyond the message limit are dropped, and the
/// caller is told how many so it can say so rather than imply the list is whole.
fn build_components(rows: &[Vec<ActionButton>]) -> (Vec<serde_json::Value>, usize) {
    let mut action_rows: Vec<serde_json::Value> = Vec::new();

    for row in rows {
        for chunk in row.chunks(DISCORD_BUTTONS_PER_ROW) {
            let buttons: Vec<serde_json::Value> = chunk
                .iter()
                .map(|button| {
                    serde_json::json!({
                        // 2 = BUTTON, 1 = PRIMARY style.
                        "type": 2,
                        "style": 1,
                        "label": button.label,
                        "custom_id": callback::encode(button),
                    })
                })
                .collect();
            if !buttons.is_empty() {
                // 1 = ACTION_ROW.
                action_rows.push(serde_json::json!({ "type": 1, "components": buttons }));
            }
        }
    }

    let dropped = action_rows.len().saturating_sub(DISCORD_ROWS_PER_MESSAGE);
    action_rows.truncate(DISCORD_ROWS_PER_MESSAGE);
    (action_rows, dropped)
}

impl DiscordApi {
    pub fn new(client: Client, token: &str) -> Self {
        Self {
            client,
            token: token.to_string(),
        }
    }

    fn auth_header(&self) -> String {
        format!("Bot {}", self.token)
    }

    /// Fetch the Gateway WSS URL (`GET /gateway/bot`, validates the token too).
    pub async fn get_gateway_bot(&self) -> Result<String, ChannelError> {
        let url = format!("{DISCORD_API_BASE}/gateway/bot");
        let resp = self
            .send_with_retry(|| self.client.get(&url).header("Authorization", self.auth_header()))
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            return Err(ChannelError::ConnectionFailed(format!(
                "Discord GET /gateway/bot failed: {status}"
            )));
        }
        let data: GatewayBotResponse = resp
            .json()
            .await
            .map_err(|e| ChannelError::ConnectionFailed(format!("Discord gateway/bot parse failed: {e}")))?;
        Ok(data.url)
    }

    /// Validate the bot token and fetch identity (`GET /users/@me`).
    pub async fn get_current_user(&self) -> Result<DiscordIdentity, ChannelError> {
        let url = format!("{DISCORD_API_BASE}/users/@me");
        let resp = self
            .send_with_retry(|| self.client.get(&url).header("Authorization", self.auth_header()))
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            return Err(ChannelError::InvalidConfig(format!(
                "Discord token validation failed: {status}"
            )));
        }
        let user: CurrentUser = resp
            .json()
            .await
            .map_err(|e| ChannelError::InvalidConfig(format!("Discord users/@me parse failed: {e}")))?;
        Ok(DiscordIdentity {
            id: user.id,
            display_name: user.global_name.or(user.username),
        })
    }

    /// Post a message to a channel. Returns the message id (for later edits).
    /// Acknowledge a component interaction.
    ///
    /// Discord shows the user an error unless an interaction is answered within
    /// three seconds, so this is sent before the press is processed; the real
    /// reply follows as an ordinary message, exactly as Telegram's does.
    ///
    /// Type 6 = DEFERRED_UPDATE_MESSAGE: acknowledges without editing the
    /// message the button lives on, so the picker stays on screen.
    pub async fn ack_interaction(&self, interaction_id: &str, token: &str) -> Result<(), ChannelError> {
        let url = format!("{DISCORD_API_BASE}/interactions/{interaction_id}/{token}/callback");
        let body = serde_json::json!({ "type": 6 });

        let resp = self.send_with_retry(|| self.client.post(&url).json(&body)).await?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(ChannelError::PlatformApi(format!(
                "Discord interaction ack failed: {status}"
            )));
        }
        Ok(())
    }

    pub async fn create_message(
        &self,
        channel_id: &str,
        content: &str,
        reply_to: Option<&str>,
        buttons: Option<&[Vec<ActionButton>]>,
    ) -> Result<String, ChannelError> {
        let url = format!("{DISCORD_API_BASE}/channels/{channel_id}/messages");
        let components = buttons.map(build_components).and_then(|(rows, dropped)| {
            if dropped > 0 {
                warn!(
                    dropped,
                    "Discord message exceeded the action-row limit; some buttons omitted"
                );
            }
            (!rows.is_empty()).then_some(rows)
        });
        let body = SendMessageRequest {
            content: content.to_string(),
            allowed_mentions: AllowedMentions::none(),
            message_reference: reply_to.map(|id| MessageReference {
                message_id: id.to_string(),
            }),
            components,
        };

        debug!(channel_id, "Discord create message");

        let resp = self
            .send_with_retry(|| {
                self.client
                    .post(&url)
                    .header("Authorization", self.auth_header())
                    .json(&body)
            })
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            return Err(ChannelError::MessageSendFailed(format!(
                "Discord create message failed: {status}"
            )));
        }
        let data: MessageResponse = resp
            .json()
            .await
            .map_err(|e| ChannelError::MessageSendFailed(format!("Discord create message parse failed: {e}")))?;
        Ok(data.id)
    }

    /// Edit an existing message (`PATCH /channels/{id}/messages/{msg_id}`).
    pub async fn edit_message(&self, channel_id: &str, message_id: &str, content: &str) -> Result<(), ChannelError> {
        let url = format!("{DISCORD_API_BASE}/channels/{channel_id}/messages/{message_id}");
        let body = SendMessageRequest {
            content: content.to_string(),
            allowed_mentions: AllowedMentions::none(),
            message_reference: None,
            // An edit never re-renders buttons; the picker keeps the ones it
            // was posted with.
            components: None,
        };

        debug!(channel_id, message_id, "Discord edit message");

        let resp = self
            .send_with_retry(|| {
                self.client
                    .patch(&url)
                    .header("Authorization", self.auth_header())
                    .json(&body)
            })
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            return Err(ChannelError::MessageSendFailed(format!(
                "Discord edit message failed: {status}"
            )));
        }
        Ok(())
    }

    /// Send a request, retrying once on HTTP 429 after honoring the body's
    /// `retry_after` (float seconds). The builder closure produces a fresh
    /// request for each attempt.
    async fn send_with_retry(&self, build: impl Fn() -> RequestBuilder) -> Result<Response, ChannelError> {
        let resp = build()
            .send()
            .await
            .map_err(|e| ChannelError::ConnectionFailed(format!("Discord request failed: {e}")))?;
        if resp.status().as_u16() != 429 {
            return Ok(resp);
        }

        let body = resp.json::<RateLimitBody>().await.ok();
        let is_global = body.as_ref().and_then(|b| b.global).unwrap_or(false);
        let delay = retry_after_delay(body);
        warn!(
            delay_ms = delay.as_millis(),
            global = is_global,
            "Discord rate limited (429); retrying after retry_after"
        );
        tokio::time::sleep(delay).await;
        build()
            .send()
            .await
            .map_err(|e| ChannelError::ConnectionFailed(format!("Discord request failed: {e}")))
    }
}

/// Turn a 429 body's `retry_after` (float seconds) into a capped delay.
fn retry_after_delay(body: Option<RateLimitBody>) -> Duration {
    let secs = body
        .and_then(|b| b.retry_after)
        .unwrap_or(1.0)
        .clamp(0.0, MAX_RETRY_AFTER.as_secs_f64());
    Duration::from_secs_f64(secs)
}

#[cfg(test)]
#[path = "api_test.rs"]
mod api_test;
