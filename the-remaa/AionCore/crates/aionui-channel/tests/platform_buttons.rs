//! Slack and Discord button rendering and tap handling.
//!
//! Neither platform is configured on this machine, so these pin the payload
//! shapes and the decode path rather than proving the platforms accept them.
//! That distinction is deliberate: a shape regression is caught here, but
//! "Slack accepts this JSON" can only be proven by connecting an app.
//!
//! What these *do* prove and a live test would not: that a tap we did not issue
//! never becomes an action, and that one encoding stays valid on all three
//! platforms.

use aionui_channel::callback::{self, CALLBACK_BUDGET_BYTES};
use aionui_channel::session_directory::{ProjectEntry, SessionEntry, SessionPage, page_buttons, project_buttons};
use aionui_channel::types::{ActionButton, ActionCategory};

fn button(label: &str, action: &str, params: &[(&str, &str)]) -> ActionButton {
    ActionButton {
        label: label.into(),
        action: action.into(),
        params: (!params.is_empty()).then(|| params.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()),
    }
}

// ── one encoding, every platform ────────────────────────────────────────────

#[test]
fn every_session_picker_button_fits_the_shared_budget() {
    // Telegram's 64 bytes is the tightest of the three, so encoding to it keeps
    // one format valid on Slack (2000) and Discord (100) too. One over-budget
    // button makes Telegram reject the whole message.
    let page = SessionPage {
        entries: vec![SessionEntry {
            conversation_id: "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000".into(),
            title: "A long conversation title that will be truncated for display".into(),
            agent_type: "aionrs".into(),
            running: true,
            attached: false,
        }],
        next_cursor: Some("0199bbbb-cccc-7ddd-8eee-ffff00001111".into()),
    };

    for row in page_buttons(&page) {
        for button in row {
            let encoded = callback::encode(&button);
            assert!(
                encoded.len() <= CALLBACK_BUDGET_BYTES,
                "{} bytes: {encoded}",
                encoded.len()
            );
        }
    }
}

#[test]
fn every_project_picker_button_fits_the_shared_budget() {
    let projects = vec![ProjectEntry {
        project_id: "project_0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000".into(),
        name: "A project with a fairly long name".into(),
    }];

    for row in project_buttons(&projects) {
        for button in row {
            assert!(callback::fits_budget(&button), "{}", callback::encode(&button));
        }
    }
}

// ── round trip: what a platform hands back becomes the right action ─────────

#[test]
fn a_tap_decodes_to_the_action_that_was_rendered() {
    // Slack echoes `value`, Discord echoes `custom_id`, Telegram echoes
    // `callback_data` — all carry this same string.
    let rendered = button("Open", "session.attach", &[("id", "conv-1")]);
    let carried = callback::encode(&rendered);

    let decoded = callback::decode(&carried).expect("our own button must decode");

    assert_eq!(decoded.category, ActionCategory::System);
    assert_eq!(decoded.action, "session.attach");
    assert_eq!(decoded.params.unwrap().get("id").unwrap(), "conv-1");
}

#[test]
fn an_approval_tap_decodes_to_the_chat_handler() {
    // `system.confirm` is routed to the chat category; getting this wrong sends
    // the answer to a handler that ignores it and leaves the agent blocked.
    let rendered = button("Allow", "system.confirm", &[("t", "abc12345"), ("v", "0")]);
    let decoded = callback::decode(&callback::encode(&rendered)).unwrap();

    assert_eq!(decoded.category, ActionCategory::Chat);
    assert_eq!(decoded.action, "system.confirm");
    let params = decoded.params.unwrap();
    assert_eq!(params.get("t").unwrap(), "abc12345");
    assert_eq!(params.get("v").unwrap(), "0");
}

// ── taps that are not ours ─────────────────────────────────────────────────

#[test]
fn a_payload_from_another_app_is_not_treated_as_an_action() {
    // Slack and Discord both deliver interactions from other sources. Decoding
    // one of those as an action would run a command nobody asked for.
    for foreign in [
        "",
        "some_other_app_value",
        "actions_block_1",
        "modal:submit",
        "notacategory:session.list",
    ] {
        assert!(callback::decode(foreign).is_none(), "{foreign} should not decode");
    }
}

#[test]
fn a_truncated_callback_does_not_become_a_partial_action() {
    // A platform that truncates the value must not leave a half-decoded action
    // that still fires.
    let full = callback::encode(&button("Open", "session.attach", &[("id", "conv-1")]));
    let truncated = &full[..full.len() / 2];

    match callback::decode(truncated) {
        None => {}
        Some(parsed) => assert_ne!(
            parsed.action, "session.attach",
            "a truncated value must not resolve to the real action"
        ),
    }
}

#[test]
fn a_button_with_no_params_round_trips() {
    // The picker's "More" and the pairing buttons have none.
    let decoded = callback::decode(&callback::encode(&button("Help", "help.show", &[]))).unwrap();

    assert_eq!(decoded.action, "help.show");
    assert!(decoded.params.is_none());
}
