//! Encoding a button press so it survives a round trip through a chat platform.
//!
//! Every platform gives a button one opaque string to carry and hands it back
//! on a tap: Telegram calls it `callback_data`, Slack `value`, Discord
//! `custom_id`. The shape is the same everywhere, so it lives here rather than
//! being reimplemented per plugin — three encoders would drift, and the
//! encoding is what the whole button UI depends on.
//!
//! Format: `category:action` or `category:action:k=v,k=v`.
//!
//! **Budget: 64 bytes.** That is Telegram's limit, the tightest of the three
//! (Slack allows 2000, Discord 100), and exceeding it makes Telegram reject the
//! entire message rather than the one button. Encoding to the tightest limit
//! keeps one format valid on all three.

use std::collections::HashMap;

use crate::types::{ActionButton, ActionCategory};

/// The tightest callback budget across supported platforms (Telegram's).
pub const CALLBACK_BUDGET_BYTES: usize = 64;

/// A decoded button press.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedCallback {
    pub category: ActionCategory,
    pub action: String,
    pub params: Option<HashMap<String, String>>,
}

/// Which category prefix an action belongs to.
///
/// The prefix decides which handler the action reaches, so it has to match what
/// `ActionExecutor::route_action` expects.
pub fn action_category_prefix(action: &str) -> &'static str {
    // Full-name override: `system.confirm` is handled by `handle_chat_action`
    // despite the "system." prefix.
    if action == "system.confirm" {
        return "chat";
    }
    match action.split('.').next().unwrap_or("") {
        "pairing" => "platform",
        "chat" | "action" => "chat",
        _ => "system",
    }
}

/// Encode a button into the string a platform will hand back on a tap.
pub fn encode(button: &ActionButton) -> String {
    let category = action_category_prefix(&button.action);
    match &button.params {
        Some(params) if !params.is_empty() => {
            let encoded: Vec<String> = params.iter().map(|(k, v)| format!("{k}={v}")).collect();
            format!("{category}:{}:{}", button.action, encoded.join(","))
        }
        _ => format!("{category}:{}", button.action),
    }
}

/// Decode a tap. `None` when the string is not one of ours.
pub fn decode(data: &str) -> Option<ParsedCallback> {
    let parts: Vec<&str> = data.splitn(3, ':').collect();
    if parts.len() < 2 {
        return None;
    }

    let category = match parts[0] {
        "platform" => ActionCategory::Platform,
        "system" => ActionCategory::System,
        "chat" => ActionCategory::Chat,
        _ => return None,
    };

    let params = if parts.len() == 3 && !parts[2].is_empty() {
        let mut map = HashMap::new();
        for pair in parts[2].split(',') {
            if let Some((k, v)) = pair.split_once('=') {
                map.insert(k.to_string(), v.to_string());
            }
        }
        if map.is_empty() { None } else { Some(map) }
    } else {
        None
    };

    Some(ParsedCallback {
        category,
        action: parts[1].to_string(),
        params,
    })
}

/// True when a button's encoded form fits the tightest platform budget.
///
/// Callers render buttons for platforms with different limits; checking against
/// the tightest keeps one encoding valid everywhere.
pub fn fits_budget(button: &ActionButton) -> bool {
    encode(button).len() <= CALLBACK_BUDGET_BYTES
}

#[cfg(test)]
mod tests {
    use super::*;

    fn button(action: &str, params: &[(&str, &str)]) -> ActionButton {
        ActionButton {
            label: "Button".into(),
            action: action.into(),
            params: (!params.is_empty())
                .then(|| params.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()),
        }
    }

    #[test]
    fn encodes_an_action_without_params() {
        assert_eq!(encode(&button("session.list", &[])), "system:session.list");
    }

    #[test]
    fn encodes_an_action_with_params() {
        assert_eq!(
            encode(&button("session.attach", &[("id", "conv-1")])),
            "system:session.attach:id=conv-1"
        );
    }

    #[test]
    fn routes_each_category_to_its_handler() {
        assert_eq!(action_category_prefix("pairing.show"), "platform");
        assert_eq!(action_category_prefix("chat.send"), "chat");
        assert_eq!(action_category_prefix("action.copy"), "chat");
        assert_eq!(action_category_prefix("session.list"), "system");
    }

    #[test]
    fn system_confirm_is_routed_to_the_chat_handler() {
        // The one full-name override; approvals are answered there.
        assert_eq!(action_category_prefix("system.confirm"), "chat");
        assert_eq!(
            encode(&button("system.confirm", &[("t", "abc")])),
            "chat:system.confirm:t=abc"
        );
    }

    #[test]
    fn a_button_round_trips() {
        let original = button("session.attach", &[("id", "conv-1")]);
        let decoded = decode(&encode(&original)).expect("our own encoding must decode");

        assert_eq!(decoded.category, ActionCategory::System);
        assert_eq!(decoded.action, "session.attach");
        assert_eq!(decoded.params.unwrap().get("id").unwrap(), "conv-1");
    }

    #[test]
    fn a_multi_param_button_round_trips() {
        let original = button("system.confirm", &[("t", "abc123"), ("v", "2")]);
        let params = decode(&encode(&original)).unwrap().params.unwrap();

        assert_eq!(params.get("t").unwrap(), "abc123");
        assert_eq!(params.get("v").unwrap(), "2");
    }

    #[test]
    fn refuses_data_that_is_not_ours() {
        // Platforms deliver other apps' payloads and their own; decoding one as
        // an action would fire a command nobody asked for.
        assert!(decode("").is_none());
        assert!(decode("nonsense").is_none());
        assert!(decode("unknown_category:session.list").is_none());
    }

    #[test]
    fn tolerates_an_empty_param_section() {
        let decoded = decode("system:session.list:").expect("trailing colon is still ours");
        assert_eq!(decoded.action, "session.list");
        assert!(decoded.params.is_none());
    }

    #[test]
    fn ignores_a_param_pair_with_no_equals() {
        let decoded = decode("system:session.attach:garbage").unwrap();
        assert!(decoded.params.is_none(), "a malformed pair must not become a param");
    }

    #[test]
    fn the_budget_is_the_tightest_platform_limit() {
        // Telegram 64, Discord 100, Slack 2000. Encoding to the smallest keeps
        // one format valid on all three.
        assert_eq!(CALLBACK_BUDGET_BYTES, 64);
    }

    #[test]
    fn a_realistic_attach_button_fits() {
        // A conversation id is a bare 36-char UUID; this is the longest button
        // the session picker emits.
        let attach = button("session.attach", &[("id", "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000")]);
        assert!(fits_budget(&attach), "{} bytes", encode(&attach).len());
    }

    #[test]
    fn an_over_long_button_is_reported_rather_than_silently_sent() {
        // One over-budget button makes Telegram reject the whole message, so
        // callers need to be able to check before sending.
        let huge = button("session.attach", &[("id", &"x".repeat(80))]);
        assert!(!fits_budget(&huge));
    }
}
