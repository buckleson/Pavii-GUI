//! Delivering a chat channel's approval answers back to the agent.
//!
//! [`crate::approvals`] is the pure registry — what is pending, and the rules
//! about resolving exactly once and expiring as denied. This is the half that
//! talks to the agent, kept separate so the registry stays unit-testable
//! without a database or a live task.
//!
//! Two channels, not one: an ordinary tool approval goes through
//! `ConversationService::confirm`, an AskUserQuestion through `answer_ask`.
//! Sending one down the other silently drops the answer and leaves the agent
//! blocked, which is why [`ApprovalKind`] travels with every request.

use std::sync::Arc;

use aionui_ai_agent::IWorkerTaskManager;
use aionui_api_types::{AskQuestionAnswer, ConfirmRequest};
use aionui_common::{TimestampMs, now_ms};
use aionui_conversation::ConversationService;
use tracing::{info, warn};

use crate::approvals::{
    APPROVAL_TIMEOUT_MS, ApprovalChoice, ApprovalKind, ApprovalRegistry, Decision, PendingApproval,
};
use crate::error::ChannelError;

/// What happened to a button press.
#[derive(Debug, Clone, PartialEq)]
pub enum AnswerOutcome {
    /// The answer reached the agent.
    Delivered {
        approval: Box<PendingApproval>,
        choice: ApprovalChoice,
    },
    /// The ticket is unknown, already answered, or expired.
    ///
    /// Not an error: a stale button is a normal thing to tap, and the chat is
    /// told rather than the press being swallowed.
    AlreadyResolved,
    /// The button carried an index this request does not have.
    UnknownChoice,
}

/// Registers approvals and delivers their answers.
pub struct ApprovalService {
    registry: ApprovalRegistry,
    conversations: Arc<ConversationService>,
    tasks: Arc<dyn IWorkerTaskManager>,
}

impl ApprovalService {
    pub fn new(conversations: Arc<ConversationService>, tasks: Arc<dyn IWorkerTaskManager>) -> Self {
        Self {
            registry: ApprovalRegistry::new(),
            conversations,
            tasks,
        }
    }

    /// Park a request so its buttons have something to resolve against.
    pub fn register(&self, approval: PendingApproval) -> PendingApproval {
        self.registry.register(approval)
    }

    pub fn pending_count(&self) -> usize {
        self.registry.len()
    }

    pub fn get(&self, ticket: &str) -> Option<PendingApproval> {
        self.registry.get(ticket)
    }

    /// Answer a request from a button press.
    ///
    /// Resolves before delivering, so a double tap cannot send two decisions
    /// even if delivery is slow.
    pub async fn answer(
        &self,
        owner_user_id: &str,
        ticket: &str,
        choice_index: usize,
    ) -> Result<AnswerOutcome, ChannelError> {
        // Peek first: an out-of-range index must not consume the request, or a
        // malformed button would silently cancel a legitimate approval.
        let Some(peeked) = self.registry.get(ticket) else {
            return Ok(AnswerOutcome::AlreadyResolved);
        };
        let Some(choice) = peeked.choice(choice_index).cloned() else {
            return Ok(AnswerOutcome::UnknownChoice);
        };

        let decision = if choice.denies { Decision::Deny } else { Decision::Allow };
        let Some((approval, _resolution)) = self.registry.resolve(ticket, decision) else {
            // Someone answered between the peek and here.
            return Ok(AnswerOutcome::AlreadyResolved);
        };

        self.deliver(owner_user_id, &approval, &choice).await?;

        Ok(AnswerOutcome::Delivered {
            approval: Box::new(approval),
            choice,
        })
    }

    /// Deny everything that has been waiting too long.
    ///
    /// Returns what expired so the caller can tell the chat. A delivery failure
    /// is logged and the sweep continues: one wedged session must not stop the
    /// others being unblocked.
    pub async fn sweep_expired(&self, owner_user_id: &str, now: TimestampMs) -> Vec<PendingApproval> {
        let expired = self.registry.expire_older_than(now, APPROVAL_TIMEOUT_MS);
        let mut swept = Vec::with_capacity(expired.len());

        for (approval, _resolution) in expired {
            match approval.denying_choice().cloned() {
                Some(choice) => {
                    if let Err(error) = self.deliver(owner_user_id, &approval, &choice).await {
                        warn!(
                            ticket = %approval.ticket,
                            conversation_id = %approval.conversation_id,
                            error = %error,
                            "expired approval could not be delivered; the agent may still be waiting"
                        );
                    }
                }
                None => {
                    // An AskUserQuestion has no "refuse" among its answers.
                    // Answering `None` is the documented way to say the card was
                    // dismissed; inventing an answer would put words in the
                    // user's mouth.
                    if let Err(error) = self.dismiss(owner_user_id, &approval).await {
                        warn!(
                            ticket = %approval.ticket,
                            conversation_id = %approval.conversation_id,
                            error = %error,
                            "expired question could not be dismissed"
                        );
                    }
                }
            }
            swept.push(approval);
        }

        swept
    }

    /// Convenience for the timer: sweep against the current clock.
    pub async fn sweep_now(&self, owner_user_id: &str) -> Vec<PendingApproval> {
        self.sweep_expired(owner_user_id, now_ms()).await
    }

    /// Forget a session's requests without answering — the agent is gone.
    pub fn drop_session(&self, session_id: &str) -> Vec<PendingApproval> {
        self.registry.drop_session(session_id)
    }

    async fn deliver(
        &self,
        owner_user_id: &str,
        approval: &PendingApproval,
        choice: &ApprovalChoice,
    ) -> Result<(), ChannelError> {
        match approval.kind {
            ApprovalKind::Permission => {
                self.conversations
                    .confirm(
                        owner_user_id,
                        &approval.conversation_id,
                        &approval.agent_request_id,
                        ConfirmRequest {
                            // Ignored by the agent (`_msg_id`), but part of the
                            // request shape.
                            msg_id: approval.agent_request_id.clone(),
                            data: serde_json::Value::String(choice.value.clone()),
                            // The "always" option carries its own id; forcing
                            // this flag would override an explicit "just once".
                            always_allow: false,
                        },
                        &self.tasks,
                    )
                    .await
                    .map_err(|e| ChannelError::MessageSendFailed(e.to_string()))?;
            }
            ApprovalKind::Ask => {
                self.conversations
                    .answer_ask(
                        owner_user_id,
                        &approval.conversation_id,
                        &approval.agent_request_id,
                        Some(vec![AskQuestionAnswer {
                            question: approval.question.clone(),
                            labels: vec![choice.value.clone()],
                        }]),
                        &self.tasks,
                    )
                    .await
                    .map_err(|e| ChannelError::MessageSendFailed(e.to_string()))?;
            }
        }

        info!(
            ticket = %approval.ticket,
            conversation_id = %approval.conversation_id,
            kind = ?approval.kind,
            denied = choice.denies,
            "approval answer delivered"
        );
        Ok(())
    }

    /// Tell the agent a question card was dismissed.
    async fn dismiss(&self, owner_user_id: &str, approval: &PendingApproval) -> Result<(), ChannelError> {
        self.conversations
            .answer_ask(
                owner_user_id,
                &approval.conversation_id,
                &approval.agent_request_id,
                None,
                &self.tasks,
            )
            .await
            .map_err(|e| ChannelError::MessageSendFailed(e.to_string()))
    }
}
