//! Telling a chat that a session finished.
//!
//! Deliberately **not** built on `stream_relay`. A relay exists per
//! *(chat, session)* pair and only when a chat dispatched the work, so a
//! session started on the desktop has no relay at all — and that is precisely
//! the case worth notifying about. This subscribes to the engine's event bus
//! instead, which every turn completion passes through regardless of who
//! started it.
//!
//! The suppression rule matters as much as the notification: a chat already
//! attached to the conversation has been streaming the whole turn, so telling
//! it the turn ended is noise.

use std::sync::Arc;

use aionui_api_types::WebSocketMessage;
use aionui_db::{IChannelRepository, IConversationRepository};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::branding::brand_display_text;
use crate::error::ChannelError;
use crate::stream_relay::ChannelSender;
use crate::types::{ActionButton, OutgoingMessageType, UnifiedOutgoingMessage};

/// The event the engine emits when a turn ends.
const TURN_COMPLETED: &str = "turn.completed";

/// A chat to tell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotifyTarget {
    pub plugin_id: String,
    pub chat_id: String,
}

/// Extract the owner and conversation from a bus event, or `None` when it is
/// not a completion for this owner.
///
/// The bus carries every event for every user, so the owner check is a
/// correctness requirement rather than an optimisation: without it one owner's
/// chats would be told about another's sessions.
pub fn completed_conversation(event: &WebSocketMessage<serde_json::Value>, owner_user_id: &str) -> Option<String> {
    if event.name != TURN_COMPLETED {
        return None;
    }
    let data = &event.data;
    if data.get("user_id").and_then(|v| v.as_str())? != owner_user_id {
        return None;
    }
    data.get("conversation_id")
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
}

/// Build the message announcing a finished session.
pub fn finish_message(conversation_id: &str, title: &str) -> UnifiedOutgoingMessage {
    UnifiedOutgoingMessage {
        message_type: OutgoingMessageType::Text,
        text: Some(format!("\u{2705} \"{}\" finished.", brand_display_text(title))),
        parse_mode: None,
        // Straight into the session that just finished, so reading the result
        // is one tap rather than a trip through /sessions.
        buttons: Some(vec![vec![ActionButton {
            label: "Open".into(),
            action: "session.attach".into(),
            params: Some([("id".to_owned(), conversation_id.to_owned())].into_iter().collect()),
        }]]),
        keyboard: None,
        image_url: None,
        file_url: None,
        file_name: None,
        media_actions: None,
        reply_to_message_id: None,
        silent: None,
    }
}

/// Watches for finished sessions and tells the owner's paired chats.
pub struct FinishNotifier {
    owner_user_id: String,
    conversations: Arc<dyn IConversationRepository>,
    channels: Arc<dyn IChannelRepository>,
    sender: Arc<dyn ChannelSender>,
}

impl FinishNotifier {
    pub fn new(
        owner_user_id: String,
        conversations: Arc<dyn IConversationRepository>,
        channels: Arc<dyn IChannelRepository>,
        sender: Arc<dyn ChannelSender>,
    ) -> Self {
        Self {
            owner_user_id,
            conversations,
            channels,
            sender,
        }
    }

    /// Which chats should hear about `conversation_id` finishing.
    ///
    /// Every paired chat except one already attached to it — that chat streamed
    /// the whole turn and does not need telling it ended.
    pub async fn targets(&self, conversation_id: &str) -> Result<Vec<NotifyTarget>, ChannelError> {
        let sessions = self.channels.get_all_sessions(&self.owner_user_id).await?;
        let users = self.channels.get_all_users(&self.owner_user_id).await?;

        let mut targets = Vec::new();
        for session in sessions {
            let Some(chat_id) = session.chat_id.filter(|id| !id.is_empty()) else {
                continue;
            };
            if session.conversation_id.as_deref() == Some(conversation_id) {
                // Already watching it stream.
                continue;
            }
            // A session's user is a platform identity; that is the only place
            // the platform is recorded, and without it there is no way to know
            // which plugin can reach the chat.
            let Some(user) = users.iter().find(|user| user.id == session.user_id) else {
                warn!(
                    session_id = %session.id,
                    "channel session has no platform identity; cannot route a finish notification"
                );
                continue;
            };
            let target = NotifyTarget {
                plugin_id: user.platform_type.clone(),
                chat_id,
            };
            if !targets.contains(&target) {
                targets.push(target);
            }
        }

        Ok(targets)
    }

    /// Announce that a conversation finished. Returns how many chats were told.
    pub async fn notify(&self, conversation_id: &str) -> Result<usize, ChannelError> {
        // A conversation deleted between finishing and this running has no
        // name to announce, and pointing an Open button at it would dead-end.
        let Some(conversation) = self.conversations.get(&self.owner_user_id, conversation_id).await? else {
            debug!(conversation_id, "finished conversation is gone; nothing to announce");
            return Ok(0);
        };

        let targets = self.targets(conversation_id).await?;
        let message = finish_message(conversation_id, &conversation.name);

        let mut sent = 0;
        for target in &targets {
            match self
                .sender
                .send_message(&self.owner_user_id, &target.plugin_id, &target.chat_id, message.clone())
                .await
            {
                Ok(_) => sent += 1,
                // One unreachable platform must not stop the others hearing.
                Err(error) => warn!(
                    plugin_id = %target.plugin_id,
                    chat_id = %target.chat_id,
                    error = %error,
                    "failed to send finish notification"
                ),
            }
        }

        if sent > 0 {
            info!(conversation_id, chats = sent, "announced a finished session");
        }
        Ok(sent)
    }

    /// Run until the bus closes.
    pub async fn run(self, mut rx: broadcast::Receiver<WebSocketMessage<serde_json::Value>>) {
        info!(owner_user_id = %self.owner_user_id, "channel finish notifier started");
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Some(conversation_id) = completed_conversation(&event, &self.owner_user_id)
                        && let Err(error) = self.notify(&conversation_id).await
                    {
                        warn!(conversation_id, error = %error, "finish notification failed");
                    }
                }
                // A slow subscriber falls behind rather than deadlocking the
                // bus. Missing a notification is survivable; stopping is not.
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    warn!(missed, "finish notifier fell behind the event bus");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        info!("channel finish notifier stopped");
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn completion(user_id: &str, conversation_id: &str) -> WebSocketMessage<serde_json::Value> {
        WebSocketMessage::new(
            TURN_COMPLETED,
            json!({
                "user_id": user_id,
                "conversation_id": conversation_id,
                "status": "finished",
            }),
        )
    }

    #[test]
    fn reads_the_conversation_out_of_a_completion() {
        let event = completion("owner", "conv-1");
        assert_eq!(completed_conversation(&event, "owner").as_deref(), Some("conv-1"));
    }

    #[test]
    fn ignores_another_owners_completion() {
        // The bus carries every user's events; without this one owner's chats
        // would be told about another's sessions.
        let event = completion("someone_else", "conv-1");
        assert!(completed_conversation(&event, "owner").is_none());
    }

    #[test]
    fn ignores_events_that_are_not_completions() {
        let event = WebSocketMessage::new("conversation.listChanged", json!({ "user_id": "owner" }));
        assert!(completed_conversation(&event, "owner").is_none());
    }

    #[test]
    fn ignores_a_completion_with_nothing_to_point_at() {
        for data in [
            json!({ "user_id": "owner" }),
            json!({ "user_id": "owner", "conversation_id": "" }),
            json!({ "conversation_id": "conv-1" }),
            json!({}),
        ] {
            let event = WebSocketMessage::new(TURN_COMPLETED, data);
            assert!(completed_conversation(&event, "owner").is_none(), "{event:?}");
        }
    }

    #[test]
    fn the_message_names_the_session_and_offers_a_way_in() {
        let message = finish_message("conv-1", "Nightly digest");

        let text = message.text.expect("a notification needs text");
        assert!(text.contains("Nightly digest"), "unexpected text: {text}");
        let button = &message.buttons.expect("a notification needs a way in")[0][0];
        assert_eq!(button.action, "session.attach");
        assert_eq!(button.params.as_ref().unwrap().get("id").unwrap(), "conv-1");
    }

    #[test]
    fn the_message_brands_a_legacy_title() {
        // Conversations created before the rebrand are named `tg-aionrs-…`.
        let message = finish_message("conv-1", "tg-aionrs-123");
        assert!(message.text.unwrap().contains("tg-paviirs-123"));
    }

    #[test]
    fn the_open_button_fits_the_callback_budget() {
        let message = finish_message("0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000", "A session");
        let button = &message.buttons.as_ref().unwrap()[0][0];
        let params = button
            .params
            .as_ref()
            .map(|p| p.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(","))
            .unwrap_or_default();
        let encoded = format!("system:{}:{}", button.action, params);
        assert!(encoded.len() <= 64, "callback is {} bytes: {encoded}", encoded.len());
    }
}
