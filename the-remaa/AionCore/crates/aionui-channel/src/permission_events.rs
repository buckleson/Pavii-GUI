//! Turning agent permission events into something a chat can render.
//!
//! Only `AcpPermission` and `Ask` ever reach a channel as a question.
//! `AgentStreamEvent::Permission` exists in the enum but is never constructed
//! anywhere in the workspace, so it is not handled here — adding a branch for
//! it would be dead code that reads as coverage.
//!
//! `AcpPermission` arrives in two shapes and both are live:
//! `Confirmation` (built by `BackendProtocolSink` from a `ToolRequest`) and
//! `Request` (built by the ACP `permission_router`). They carry the same idea
//! with different field names.

use aionui_ai_agent::AgentStreamEvent;
use aionui_ai_agent::protocol::events::{AcpPermissionEventData, AcpPermissionOptionKind};

use crate::approvals::{ApprovalChoice, ApprovalKind};

/// A question the agent is blocked on, ready to be parked and rendered.
#[derive(Debug, Clone, PartialEq)]
pub struct ApprovalRequest {
    pub kind: ApprovalKind,
    /// The id the agent knows this request by.
    pub agent_request_id: String,
    /// The question text for an [`ApprovalKind::Ask`]; empty for a permission.
    pub question: String,
    /// What the agent wants to do, shown above the buttons.
    pub summary: String,
    pub choices: Vec<ApprovalChoice>,
}

/// Option ids and labels that mean "do not do this".
///
/// Matched case-insensitively because the two event shapes are produced by
/// different code paths and only one of them uses a typed option kind.
fn is_refusal(text: &str) -> bool {
    matches!(
        text.trim().to_ascii_lowercase().as_str(),
        "reject" | "reject_once" | "reject_always" | "deny" | "no" | "cancel"
    )
}

/// Extract an approval from a stream event, or `None` when the event is not a
/// question.
pub fn approval_from_event(event: &AgentStreamEvent) -> Option<ApprovalRequest> {
    match event {
        AgentStreamEvent::AcpPermission(data) => approval_from_permission(data),
        AgentStreamEvent::Ask(payload) => approval_from_ask(payload),
        _ => None,
    }
}

fn approval_from_permission(data: &AcpPermissionEventData) -> Option<ApprovalRequest> {
    match data {
        AcpPermissionEventData::Confirmation(confirmation) => {
            let choices: Vec<ApprovalChoice> = confirmation
                .options
                .iter()
                .map(|option| {
                    // `value` is untyped here; fall back to the label so an
                    // option is never rendered with nothing to send back.
                    let value = option
                        .value
                        .as_str()
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| option.label.clone());
                    ApprovalChoice {
                        denies: is_refusal(&value) || is_refusal(&option.label),
                        label: option.label.clone(),
                        value,
                    }
                })
                .collect();

            Some(ApprovalRequest {
                kind: ApprovalKind::Permission,
                agent_request_id: confirmation.call_id.clone(),
                question: String::new(),
                summary: permission_summary(
                    confirmation.title.as_deref(),
                    confirmation.action.as_deref(),
                    &confirmation.description,
                ),
                choices,
            })
        }
        AcpPermissionEventData::Request(request) => {
            let choices: Vec<ApprovalChoice> = request
                .options
                .iter()
                .map(|option| ApprovalChoice {
                    label: option.name.clone(),
                    value: option.option_id.clone(),
                    denies: matches!(
                        option.kind,
                        AcpPermissionOptionKind::RejectOnce | AcpPermissionOptionKind::RejectAlways
                    ),
                })
                .collect();

            Some(ApprovalRequest {
                kind: ApprovalKind::Permission,
                agent_request_id: request.tool_call.tool_call_id.clone(),
                question: String::new(),
                summary: permission_summary(request.tool_call.title.as_deref(), None, ""),
                choices,
            })
        }
    }
}

/// Best available description of what is about to happen.
///
/// Always returns something: an unlabelled Allow/Deny pair with no context is
/// the one prompt a user cannot answer safely.
fn permission_summary(title: Option<&str>, action: Option<&str>, description: &str) -> String {
    for candidate in [title.unwrap_or_default(), description, action.unwrap_or_default()] {
        let trimmed = candidate.trim();
        if !trimmed.is_empty() {
            return trimmed.to_owned();
        }
    }
    "The agent is asking for permission to continue.".to_owned()
}

/// Project an `Ask` payload into a single-select card.
///
/// Shape: `{session_id, request_id, questions: [{question, options: [{label,
/// description}], ...}]}`. Only the first question is rendered — the same
/// documented degradation the desktop card makes, since one message carries one
/// keyboard.
fn approval_from_ask(payload: &serde_json::Value) -> Option<ApprovalRequest> {
    let request_id = payload.get("request_id")?.as_str()?.to_owned();
    let first = payload.get("questions")?.as_array()?.first()?;

    let question = first
        .get("question")
        .and_then(|q| q.as_str())
        .unwrap_or_default()
        .trim()
        .to_owned();

    let choices: Vec<ApprovalChoice> = first
        .get("options")
        .and_then(|o| o.as_array())
        .map(|options| {
            options
                .iter()
                .filter_map(|option| {
                    let label = option.get("label").and_then(|l| l.as_str())?.trim();
                    (!label.is_empty()).then(|| ApprovalChoice {
                        label: label.to_owned(),
                        // The agent keys a question answer by its label.
                        value: label.to_owned(),
                        denies: false,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // A question with nothing to pick cannot be answered from a chat; leaving it
    // to the desktop card beats rendering a dead message.
    if choices.is_empty() {
        return None;
    }

    let summary = if question.is_empty() {
        "The agent has a question.".to_owned()
    } else {
        question.clone()
    };

    Some(ApprovalRequest {
        kind: ApprovalKind::Ask,
        agent_request_id: request_id,
        question,
        summary,
        choices,
    })
}

#[cfg(test)]
mod tests {
    use aionui_ai_agent::protocol::events::{AcpPermissionOptionData, AcpPermissionRequestData, AcpPermissionToolCall};
    use aionui_common::{Confirmation, ConfirmationOption};
    use serde_json::json;

    use super::*;

    fn confirmation(options: Vec<ConfirmationOption>) -> AgentStreamEvent {
        AgentStreamEvent::AcpPermission(AcpPermissionEventData::Confirmation(Confirmation {
            id: "conf-1".into(),
            call_id: "call-1".into(),
            title: Some("Run a command".into()),
            action: Some("execute".into()),
            description: "rm -rf /tmp/build".into(),
            command_type: Some("bash".into()),
            options,
            questions: None,
        }))
    }

    fn option(label: &str, value: &str) -> ConfirmationOption {
        ConfirmationOption {
            label: label.into(),
            value: json!(value),
            params: None,
        }
    }

    #[test]
    fn reads_a_confirmation_into_an_approval() {
        let event = confirmation(vec![option("Allow", "allow"), option("Reject", "reject")]);

        let approval = approval_from_event(&event).expect("a confirmation is a question");

        assert_eq!(approval.kind, ApprovalKind::Permission);
        assert_eq!(approval.agent_request_id, "call-1");
        assert_eq!(approval.choices.len(), 2);
        assert!(!approval.choices[0].denies);
        assert!(approval.choices[1].denies, "reject must be recognised as a refusal");
    }

    #[test]
    fn recognises_every_spelling_of_refusal() {
        for value in ["reject", "REJECT", "deny", "no", "reject_always", " cancel "] {
            let event = confirmation(vec![option("Allow", "allow"), option("No", value)]);
            let approval = approval_from_event(&event).unwrap();
            assert!(approval.choices[1].denies, "{value} should deny");
        }
    }

    #[test]
    fn falls_back_to_the_label_when_the_value_is_not_a_string() {
        // The value is untyped; an option with nothing to send back would
        // render a button that cannot be answered.
        let event = confirmation(vec![ConfirmationOption {
            label: "Allow".into(),
            value: json!({ "unexpected": true }),
            params: None,
        }]);

        let approval = approval_from_event(&event).unwrap();

        assert_eq!(approval.choices[0].value, "Allow");
    }

    #[test]
    fn a_confirmation_summary_prefers_the_title() {
        let event = confirmation(vec![option("Allow", "allow")]);
        assert_eq!(approval_from_event(&event).unwrap().summary, "Run a command");
    }

    #[test]
    fn a_confirmation_without_a_title_falls_back_to_the_description() {
        let AgentStreamEvent::AcpPermission(AcpPermissionEventData::Confirmation(mut conf)) =
            confirmation(vec![option("Allow", "allow")])
        else {
            unreachable!()
        };
        conf.title = None;
        let event = AgentStreamEvent::AcpPermission(AcpPermissionEventData::Confirmation(conf));

        assert_eq!(approval_from_event(&event).unwrap().summary, "rm -rf /tmp/build");
    }

    #[test]
    fn a_confirmation_with_no_text_still_says_something() {
        // An unlabelled Allow/Deny pair is the one prompt nobody can answer
        // safely.
        let AgentStreamEvent::AcpPermission(AcpPermissionEventData::Confirmation(mut conf)) =
            confirmation(vec![option("Allow", "allow")])
        else {
            unreachable!()
        };
        conf.title = None;
        conf.action = None;
        conf.description = "   ".into();
        let event = AgentStreamEvent::AcpPermission(AcpPermissionEventData::Confirmation(conf));

        assert!(!approval_from_event(&event).unwrap().summary.trim().is_empty());
    }

    #[test]
    fn reads_a_permission_request_into_an_approval() {
        let event = AgentStreamEvent::AcpPermission(AcpPermissionEventData::Request(AcpPermissionRequestData {
            session_id: "sess-1".into(),
            tool_call: AcpPermissionToolCall {
                tool_call_id: "tool-9".into(),
                status: None,
                title: Some("Edit main.rs".into()),
                kind: None,
                raw_input: None,
                raw_output: None,
                content: None,
                locations: None,
                meta: None,
            },
            options: vec![
                AcpPermissionOptionData {
                    option_id: "allow".into(),
                    name: "Allow".into(),
                    kind: AcpPermissionOptionKind::AllowOnce,
                    meta: None,
                },
                AcpPermissionOptionData {
                    option_id: "allow_always".into(),
                    name: "Allow Always".into(),
                    kind: AcpPermissionOptionKind::AllowAlways,
                    meta: None,
                },
                AcpPermissionOptionData {
                    option_id: "reject".into(),
                    name: "Reject".into(),
                    kind: AcpPermissionOptionKind::RejectOnce,
                    meta: None,
                },
            ],
            meta: None,
        }));

        let approval = approval_from_event(&event).expect("a request is a question");

        assert_eq!(approval.agent_request_id, "tool-9");
        assert_eq!(approval.summary, "Edit main.rs");
        assert_eq!(approval.choices.len(), 3);
        assert!(!approval.choices[0].denies);
        assert!(!approval.choices[1].denies, "allow-always is not a refusal");
        assert!(approval.choices[2].denies);
    }

    #[test]
    fn reads_an_ask_into_a_single_select_card() {
        let event = AgentStreamEvent::Ask(json!({
            "session_id": "conv-1",
            "request_id": "ask-7",
            "questions": [{
                "question": "Which database?",
                "header": "Database",
                "options": [{ "label": "Postgres" }, { "label": "SQLite" }],
                "multiSelect": false,
            }],
        }));

        let approval = approval_from_event(&event).expect("an ask is a question");

        assert_eq!(approval.kind, ApprovalKind::Ask);
        assert_eq!(approval.agent_request_id, "ask-7");
        assert_eq!(approval.question, "Which database?");
        assert_eq!(approval.choices.len(), 2);
        // The agent keys a question answer by label.
        assert_eq!(approval.choices[0].value, "Postgres");
        assert!(
            approval.choices.iter().all(|c| !c.denies),
            "a question has no refusal among its answers"
        );
    }

    #[test]
    fn an_ask_with_one_option_is_still_answerable() {
        let event = AgentStreamEvent::Ask(json!({
            "request_id": "ask-1",
            "questions": [{ "question": "Proceed?", "options": [{ "label": "Yes" }] }],
        }));

        let approval = approval_from_event(&event).unwrap();

        assert_eq!(approval.choices.len(), 1);
    }

    #[test]
    fn an_ask_renders_only_the_first_question() {
        // One message carries one keyboard; the desktop card degrades the same
        // way.
        let event = AgentStreamEvent::Ask(json!({
            "request_id": "ask-2",
            "questions": [
                { "question": "First?", "options": [{ "label": "A" }] },
                { "question": "Second?", "options": [{ "label": "B" }] },
            ],
        }));

        let approval = approval_from_event(&event).unwrap();

        assert_eq!(approval.question, "First?");
        assert_eq!(approval.choices.len(), 1);
        assert_eq!(approval.choices[0].label, "A");
    }

    #[test]
    fn an_ask_with_nothing_to_pick_is_left_to_the_desktop() {
        // Rendering a message with no buttons would block the session with no
        // way forward from the chat.
        for payload in [
            json!({ "request_id": "ask-3", "questions": [] }),
            json!({ "request_id": "ask-4", "questions": [{ "question": "?", "options": [] }] }),
            json!({ "request_id": "ask-5", "questions": [{ "question": "?" }] }),
        ] {
            assert!(approval_from_event(&AgentStreamEvent::Ask(payload)).is_none());
        }
    }

    #[test]
    fn an_ask_without_a_request_id_is_ignored() {
        // Without it there is nothing to answer against.
        let event = AgentStreamEvent::Ask(json!({
            "questions": [{ "question": "?", "options": [{ "label": "A" }] }],
        }));
        assert!(approval_from_event(&event).is_none());
    }

    #[test]
    fn an_ask_option_with_a_blank_label_is_dropped() {
        let event = AgentStreamEvent::Ask(json!({
            "request_id": "ask-6",
            "questions": [{ "question": "?", "options": [{ "label": "  " }, { "label": "Real" }] }],
        }));

        let approval = approval_from_event(&event).unwrap();

        assert_eq!(approval.choices.len(), 1);
        assert_eq!(approval.choices[0].label, "Real");
    }

    #[test]
    fn ordinary_stream_events_are_not_approvals() {
        assert!(approval_from_event(&AgentStreamEvent::SegmentBreak).is_none());
    }
}
