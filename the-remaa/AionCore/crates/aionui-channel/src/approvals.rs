//! Pending tool approvals raised to a chat channel.
//!
//! Channel sessions ran in `yolo` mode, so the agent acted unsupervised and
//! nothing ever asked. This is what lets a session pause instead: a permission
//! request is parked here, rendered as buttons, and resolved when the answer
//! comes back.
//!
//! Three properties matter more than the happy path:
//!
//! - **An unanswered approval must expire.** Nobody watches their phone at
//!   03:00, and a session blocked forever is worse than one that stopped.
//!   Expiry resolves as *denied* — the safe direction.
//! - **An approval resolves exactly once.** A late button press, a double tap,
//!   or an answer racing the expiry sweep must not send the agent two
//!   decisions.
//! - **A button must fit the callback budget.** Telegram allows 64 bytes, and
//!   one over-long button makes it reject the whole message. Requests are
//!   therefore keyed by a short *ticket* we mint, not by the agent's own
//!   request id (an ACP tool-call id has no length bound we control), and the
//!   answer travels as an option *index* rather than an option value (an
//!   AskUserQuestion option value is a whole answer label).

use std::collections::HashMap;
use std::sync::Mutex;

use aionui_common::{TimestampMs, generate_short_id, now_ms};

/// How long a request waits before it is treated as denied.
pub const APPROVAL_TIMEOUT_MS: i64 = 10 * 60 * 1000;

/// The answer sent back to the agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny,
}

impl Decision {
    /// Wire value understood by the agent's confirm channel.
    pub fn as_wire(self) -> &'static str {
        match self {
            Decision::Allow => "allow",
            Decision::Deny => "deny",
        }
    }

    /// Parse a decision from button callback data.
    pub fn from_wire(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "allow" | "approve" | "yes" => Some(Decision::Allow),
            "deny" | "reject" | "no" => Some(Decision::Deny),
            _ => None,
        }
    }
}

/// Why an approval stopped being pending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    /// The user pressed a button.
    Answered(Decision),
    /// Nobody answered in time; treated as denied.
    Expired,
}

impl Resolution {
    pub fn decision(&self) -> Decision {
        match self {
            Resolution::Answered(decision) => *decision,
            Resolution::Expired => Decision::Deny,
        }
    }
}

/// How the answer must be delivered back to the agent.
///
/// The two travel different channels: a permission goes through
/// `ConversationService::confirm`, a question through `answer_ask`. Mixing them
/// silently drops the answer, so the kind is carried with the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalKind {
    /// An ordinary tool approval.
    Permission,
    /// An AskUserQuestion card.
    Ask,
}

/// One answer the user can pick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalChoice {
    /// Button text.
    pub label: String,
    /// What the agent is told — an option id, or an answer label for a question.
    pub value: String,
    /// True for the option that denies. Used to render the deny button last and
    /// to pick the right answer when a request expires.
    pub denies: bool,
}

/// An approval awaiting an answer.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingApproval {
    /// Short key we mint, so callback data stays inside the 64-byte budget.
    pub ticket: String,
    /// The id the agent knows this request by.
    pub agent_request_id: String,
    pub conversation_id: String,
    pub session_id: String,
    pub chat_id: String,
    /// Which platform to reach the chat on, needed when the expiry sweep has
    /// to speak without an incoming message to reply to.
    pub plugin_id: String,
    pub kind: ApprovalKind,
    /// The question text, for an [`ApprovalKind::Ask`]; empty otherwise.
    pub question: String,
    /// Short description of what the agent wants to do, shown to the user.
    pub summary: String,
    pub choices: Vec<ApprovalChoice>,
    pub created_at: TimestampMs,
}

impl PendingApproval {
    /// The choice at `index`, if it exists.
    pub fn choice(&self, index: usize) -> Option<&ApprovalChoice> {
        self.choices.get(index)
    }

    /// The choice to use when nobody answers.
    ///
    /// Prefers an explicit deny option so the agent gets a decision it
    /// understands; falls back to `None` when the request offered no way to
    /// refuse, which the caller reports rather than guessing.
    pub fn denying_choice(&self) -> Option<&ApprovalChoice> {
        self.choices.iter().find(|choice| choice.denies)
    }
}

/// Registry of approvals awaiting an answer.
///
/// Keyed by ticket because that is what a button can carry; a chat can
/// legitimately have several in flight when parallel sessions are attached.
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, PendingApproval>>,
}

impl ApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mint a ticket short enough to survive the callback budget.
    pub fn new_ticket() -> String {
        generate_short_id()
    }

    /// Park a request. Returns the entry as stored.
    ///
    /// Re-registering the same ticket replaces the entry rather than
    /// duplicating it: agents re-emit a request when a turn is retried.
    pub fn register(&self, approval: PendingApproval) -> PendingApproval {
        let mut pending = self.pending.lock().expect("approval registry poisoned");
        pending.insert(approval.ticket.clone(), approval.clone());
        approval
    }

    pub fn len(&self) -> usize {
        self.pending.lock().expect("approval registry poisoned").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn get(&self, ticket: &str) -> Option<PendingApproval> {
        self.pending
            .lock()
            .expect("approval registry poisoned")
            .get(ticket)
            .cloned()
    }

    /// Resolve a request with the user's answer.
    ///
    /// Returns `None` when the ticket is unknown or already resolved — a late
    /// tap on a stale button must not produce a second decision.
    pub fn resolve(&self, ticket: &str, decision: Decision) -> Option<(PendingApproval, Resolution)> {
        let mut pending = self.pending.lock().expect("approval registry poisoned");
        pending
            .remove(ticket)
            .map(|approval| (approval, Resolution::Answered(decision)))
    }

    /// Drop everything older than `timeout_ms`, resolving each as denied.
    ///
    /// Returns what expired so the caller can tell the chat and unblock the
    /// agent.
    pub fn expire_older_than(&self, now: TimestampMs, timeout_ms: i64) -> Vec<(PendingApproval, Resolution)> {
        let mut pending = self.pending.lock().expect("approval registry poisoned");
        let expired_ids: Vec<String> = pending
            .values()
            .filter(|approval| now.saturating_sub(approval.created_at) >= timeout_ms)
            .map(|approval| approval.ticket.clone())
            .collect();

        expired_ids
            .into_iter()
            .filter_map(|id| pending.remove(&id).map(|approval| (approval, Resolution::Expired)))
            .collect()
    }

    /// Drop every approval belonging to a session, without answering.
    ///
    /// Used when a session ends while requests are outstanding: the agent is
    /// gone, so there is nobody left to answer.
    pub fn drop_session(&self, session_id: &str) -> Vec<PendingApproval> {
        let mut pending = self.pending.lock().expect("approval registry poisoned");
        let ids: Vec<String> = pending
            .values()
            .filter(|approval| approval.session_id == session_id)
            .map(|approval| approval.ticket.clone())
            .collect();
        ids.into_iter().filter_map(|id| pending.remove(&id)).collect()
    }
}

/// Build a pending approval from the pieces the relay has to hand.
#[allow(clippy::too_many_arguments)]
pub fn pending(
    agent_request_id: &str,
    conversation_id: &str,
    session_id: &str,
    chat_id: &str,
    plugin_id: &str,
    kind: ApprovalKind,
    question: &str,
    summary: &str,
    choices: Vec<ApprovalChoice>,
) -> PendingApproval {
    PendingApproval {
        ticket: ApprovalRegistry::new_ticket(),
        agent_request_id: agent_request_id.to_owned(),
        conversation_id: conversation_id.to_owned(),
        session_id: session_id.to_owned(),
        chat_id: chat_id.to_owned(),
        plugin_id: plugin_id.to_owned(),
        kind,
        question: question.trim().to_owned(),
        summary: summary.trim().to_owned(),
        choices,
        created_at: now_ms(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choices() -> Vec<ApprovalChoice> {
        vec![
            ApprovalChoice {
                label: "Allow".into(),
                value: "allow".into(),
                denies: false,
            },
            ApprovalChoice {
                label: "Reject".into(),
                value: "reject".into(),
                denies: true,
            },
        ]
    }

    fn approval(ticket: &str, created_at: TimestampMs) -> PendingApproval {
        PendingApproval {
            ticket: ticket.to_owned(),
            agent_request_id: format!("call-{ticket}"),
            conversation_id: "conv1".to_owned(),
            session_id: "s1".to_owned(),
            chat_id: "c1".to_owned(),
            plugin_id: "telegram".to_owned(),
            kind: ApprovalKind::Permission,
            question: String::new(),
            summary: "run rm -rf /tmp/build".to_owned(),
            choices: choices(),
            created_at,
        }
    }

    #[test]
    fn parses_the_decisions_buttons_can_send() {
        assert_eq!(Decision::from_wire("allow"), Some(Decision::Allow));
        assert_eq!(Decision::from_wire("Deny"), Some(Decision::Deny));
        assert_eq!(Decision::from_wire("  APPROVE "), Some(Decision::Allow));
        assert_eq!(Decision::from_wire("reject"), Some(Decision::Deny));
    }

    #[test]
    fn refuses_to_guess_at_an_unknown_answer() {
        // Guessing here would mean authorizing something on a typo.
        assert_eq!(Decision::from_wire("maybe"), None);
        assert_eq!(Decision::from_wire(""), None);
    }

    #[test]
    fn registers_and_finds_a_pending_approval() {
        let registry = ApprovalRegistry::new();
        registry.register(approval("r1", now_ms()));

        assert_eq!(registry.len(), 1);
        assert_eq!(registry.get("r1").unwrap().ticket, "r1");
    }

    #[test]
    fn resolving_returns_the_approval_and_the_answer() {
        let registry = ApprovalRegistry::new();
        registry.register(approval("r1", now_ms()));

        let (parked, resolution) = registry.resolve("r1", Decision::Allow).unwrap();

        assert_eq!(parked.ticket, "r1");
        assert_eq!(resolution, Resolution::Answered(Decision::Allow));
        assert!(registry.is_empty(), "a resolved approval must not stay pending");
    }

    #[test]
    fn a_second_answer_is_ignored() {
        // A double tap, or a tap racing the expiry sweep, must not send the
        // agent two decisions for one request.
        let registry = ApprovalRegistry::new();
        registry.register(approval("r1", now_ms()));

        assert!(registry.resolve("r1", Decision::Allow).is_some());
        assert!(registry.resolve("r1", Decision::Deny).is_none());
    }

    #[test]
    fn answering_an_unknown_request_is_ignored() {
        let registry = ApprovalRegistry::new();
        assert!(registry.resolve("never-seen", Decision::Allow).is_none());
    }

    #[test]
    fn expiry_resolves_as_denied() {
        // The safe direction: an unattended request must not become an
        // authorization.
        let registry = ApprovalRegistry::new();
        let now = now_ms();
        registry.register(approval("r1", now - APPROVAL_TIMEOUT_MS));

        let expired = registry.expire_older_than(now, APPROVAL_TIMEOUT_MS);

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].1, Resolution::Expired);
        assert_eq!(expired[0].1.decision(), Decision::Deny);
        assert!(registry.is_empty());
    }

    #[test]
    fn a_fresh_approval_is_left_alone_by_the_sweep() {
        let registry = ApprovalRegistry::new();
        let now = now_ms();
        registry.register(approval("r1", now));

        assert!(registry.expire_older_than(now, APPROVAL_TIMEOUT_MS).is_empty());
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn expiry_is_inclusive_at_the_boundary() {
        let registry = ApprovalRegistry::new();
        let now = now_ms();
        registry.register(approval("exactly", now - APPROVAL_TIMEOUT_MS));
        registry.register(approval("just_under", now - APPROVAL_TIMEOUT_MS + 1));

        let expired = registry.expire_older_than(now, APPROVAL_TIMEOUT_MS);

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].0.ticket, "exactly");
    }

    #[test]
    fn an_expired_approval_cannot_then_be_answered() {
        let registry = ApprovalRegistry::new();
        let now = now_ms();
        registry.register(approval("r1", now - APPROVAL_TIMEOUT_MS));

        registry.expire_older_than(now, APPROVAL_TIMEOUT_MS);

        assert!(
            registry.resolve("r1", Decision::Allow).is_none(),
            "a button press after expiry must not authorize anything"
        );
    }

    #[test]
    fn re_registering_the_same_ticket_replaces_rather_than_duplicates() {
        // Agents re-emit a request when a turn is retried.
        let registry = ApprovalRegistry::new();
        registry.register(approval("r1", now_ms()));
        registry.register(approval("r1", now_ms()));

        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn several_approvals_can_be_pending_at_once() {
        // Parallel sessions attached to one chat each raise their own.
        let registry = ApprovalRegistry::new();
        registry.register(approval("r1", now_ms()));
        let mut second = approval("r2", now_ms());
        second.session_id = "s2".to_owned();
        registry.register(second);

        assert_eq!(registry.len(), 2);
        assert!(registry.resolve("r1", Decision::Allow).is_some());
        assert_eq!(registry.len(), 1, "answering one must not clear the other");
    }

    #[test]
    fn dropping_a_session_clears_only_its_approvals() {
        let registry = ApprovalRegistry::new();
        registry.register(approval("r1", now_ms()));
        let mut other = approval("r2", now_ms());
        other.session_id = "s2".to_owned();
        registry.register(other);

        let dropped = registry.drop_session("s1");

        assert_eq!(dropped.len(), 1);
        assert_eq!(dropped[0].ticket, "r1");
        assert!(registry.get("r2").is_some(), "another session must be untouched");
    }

    #[test]
    fn dropping_a_session_with_nothing_pending_is_harmless() {
        let registry = ApprovalRegistry::new();
        assert!(registry.drop_session("s1").is_empty());
    }

    #[test]
    fn the_summary_is_trimmed_when_parked() {
        let parked = pending(
            "call-1",
            "conv1",
            "s1",
            "c1",
            "telegram",
            ApprovalKind::Permission,
            "",
            "  delete the build directory  ",
            choices(),
        );
        assert_eq!(parked.summary, "delete the build directory");
    }

    #[test]
    fn a_minted_ticket_is_short_enough_for_a_callback() {
        // The whole reason tickets exist. 64 bytes total, and the rest of the
        // callback (`chat:system.confirm:t=,v=`) already costs 25.
        let parked = pending(
            "an-agent-request-id-of-unbounded-length",
            "conv1",
            "s1",
            "c1",
            "telegram",
            ApprovalKind::Permission,
            "",
            "do a thing",
            choices(),
        );
        assert!(
            parked.ticket.len() <= 16,
            "ticket {} is too long for callback data",
            parked.ticket
        );
        assert_ne!(
            parked.ticket, parked.agent_request_id,
            "the ticket must not be the agent id, which has no length bound"
        );
    }

    #[test]
    fn tickets_are_distinct_between_requests() {
        // Two in flight in one chat must not collide onto one button.
        let a = pending(
            "c1",
            "conv",
            "s",
            "chat",
            "telegram",
            ApprovalKind::Permission,
            "",
            "a",
            choices(),
        );
        let b = pending(
            "c2",
            "conv",
            "s",
            "chat",
            "telegram",
            ApprovalKind::Permission,
            "",
            "b",
            choices(),
        );
        assert_ne!(a.ticket, b.ticket);
    }

    #[test]
    fn a_choice_is_addressed_by_index() {
        // Buttons carry the index, not the value: an AskUserQuestion option
        // value is a whole answer label and would blow the callback budget.
        let parked = approval("r1", now_ms());
        assert_eq!(parked.choice(0).unwrap().value, "allow");
        assert_eq!(parked.choice(1).unwrap().value, "reject");
        assert!(parked.choice(2).is_none(), "an out-of-range tap must not pick a choice");
    }

    #[test]
    fn the_denying_choice_is_found_for_expiry() {
        let parked = approval("r1", now_ms());
        assert_eq!(parked.denying_choice().unwrap().value, "reject");
    }

    #[test]
    fn a_request_with_no_deny_option_reports_rather_than_guessing() {
        // An AskUserQuestion has no "reject" among its answers; expiry must not
        // invent one and pass it off as the user's choice.
        let mut parked = approval("r1", now_ms());
        parked.choices.retain(|choice| !choice.denies);
        assert!(parked.denying_choice().is_none());
    }

    #[test]
    fn wire_values_round_trip() {
        for decision in [Decision::Allow, Decision::Deny] {
            assert_eq!(Decision::from_wire(decision.as_wire()), Some(decision));
        }
    }
}
