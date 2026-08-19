//! Pending tool approvals raised to a chat channel.
//!
//! Channel sessions run in `yolo` mode today (`message_service.rs`,
//! `orchestrator.rs`), so the agent acts unsupervised and nothing ever asks.
//! This registry is what lets a session pause instead: a permission request is
//! parked here, rendered as Allow/Deny buttons, and resolved when the answer
//! comes back.
//!
//! Two properties matter more than the happy path:
//!
//! - **An unanswered approval must expire.** Nobody watches their phone at
//!   03:00, and a session blocked forever is worse than one that stopped.
//!   Expiry resolves as *denied* — the safe direction.
//! - **An approval resolves exactly once.** A late button press, a double tap,
//!   or an answer racing the expiry sweep must not send a second decision to
//!   the agent.

use std::collections::HashMap;
use std::sync::Mutex;

use aionui_common::{TimestampMs, now_ms};

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

/// An approval awaiting an answer.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingApproval {
    pub request_id: String,
    pub session_id: String,
    pub chat_id: String,
    /// Short description of what the agent wants to do, shown to the user.
    pub summary: String,
    pub created_at: TimestampMs,
}

/// Registry of approvals awaiting an answer.
///
/// Keyed by request id because that is what the agent's confirm channel needs
/// back; a chat can legitimately have several in flight when parallel sessions
/// are attached to it.
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, PendingApproval>>,
}

impl ApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Park a request. Returns the entry as stored.
    ///
    /// Re-registering the same id replaces the entry rather than duplicating
    /// it: agents re-emit a request when a turn is retried.
    pub fn register(&self, approval: PendingApproval) -> PendingApproval {
        let mut pending = self.pending.lock().expect("approval registry poisoned");
        pending.insert(approval.request_id.clone(), approval.clone());
        approval
    }

    pub fn len(&self) -> usize {
        self.pending.lock().expect("approval registry poisoned").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn get(&self, request_id: &str) -> Option<PendingApproval> {
        self.pending
            .lock()
            .expect("approval registry poisoned")
            .get(request_id)
            .cloned()
    }

    /// Resolve a request with the user's answer.
    ///
    /// Returns `None` when the id is unknown or already resolved — a late tap
    /// on a stale button must not produce a second decision.
    pub fn resolve(&self, request_id: &str, decision: Decision) -> Option<(PendingApproval, Resolution)> {
        let mut pending = self.pending.lock().expect("approval registry poisoned");
        pending
            .remove(request_id)
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
            .map(|approval| approval.request_id.clone())
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
            .map(|approval| approval.request_id.clone())
            .collect();
        ids.into_iter().filter_map(|id| pending.remove(&id)).collect()
    }
}

/// Build a pending approval from the pieces the relay has to hand.
pub fn pending(request_id: &str, session_id: &str, chat_id: &str, summary: &str) -> PendingApproval {
    PendingApproval {
        request_id: request_id.to_owned(),
        session_id: session_id.to_owned(),
        chat_id: chat_id.to_owned(),
        summary: summary.trim().to_owned(),
        created_at: now_ms(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approval(id: &str, created_at: TimestampMs) -> PendingApproval {
        PendingApproval {
            request_id: id.to_owned(),
            session_id: "s1".to_owned(),
            chat_id: "c1".to_owned(),
            summary: "run rm -rf /tmp/build".to_owned(),
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
        assert_eq!(registry.get("r1").unwrap().request_id, "r1");
    }

    #[test]
    fn resolving_returns_the_approval_and_the_answer() {
        let registry = ApprovalRegistry::new();
        registry.register(approval("r1", now_ms()));

        let (parked, resolution) = registry.resolve("r1", Decision::Allow).unwrap();

        assert_eq!(parked.request_id, "r1");
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
        assert_eq!(expired[0].0.request_id, "exactly");
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
    fn re_registering_the_same_id_replaces_rather_than_duplicates() {
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
        assert_eq!(dropped[0].request_id, "r1");
        assert!(registry.get("r2").is_some(), "another session must be untouched");
    }

    #[test]
    fn dropping_a_session_with_nothing_pending_is_harmless() {
        let registry = ApprovalRegistry::new();
        assert!(registry.drop_session("s1").is_empty());
    }

    #[test]
    fn the_summary_is_trimmed_when_parked() {
        let parked = pending("r1", "s1", "c1", "  delete the build directory  ");
        assert_eq!(parked.summary, "delete the build directory");
    }

    #[test]
    fn wire_values_round_trip() {
        for decision in [Decision::Allow, Decision::Deny] {
            assert_eq!(Decision::from_wire(decision.as_wire()), Some(decision));
        }
    }
}
