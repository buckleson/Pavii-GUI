use super::*;
use reqwest::header::HeaderValue;

// -- parse_retry_after -------------------------------------------------------

fn headers_with_retry_after(value: &'static str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(RETRY_AFTER, HeaderValue::from_static(value));
    h
}

#[test]
fn retry_after_parses_seconds() {
    assert_eq!(
        parse_retry_after(&headers_with_retry_after("3")),
        Some(Duration::from_secs(3))
    );
}

#[test]
fn retry_after_caps_at_max() {
    // 99s is clamped to the 30s cap.
    assert_eq!(
        parse_retry_after(&headers_with_retry_after("99")),
        Some(Duration::from_secs(30))
    );
}

#[test]
fn retry_after_missing_is_none() {
    assert_eq!(parse_retry_after(&HeaderMap::new()), None);
}

#[test]
fn retry_after_non_numeric_is_none() {
    assert_eq!(parse_retry_after(&headers_with_retry_after("soon")), None);
}

#[test]
fn api_constructs_with_both_tokens() {
    let client = Client::new();
    let api = SlackApi::new(client, "xoxb-abc", "xapp-def");
    assert_eq!(api.bot_token, "xoxb-abc");
    assert_eq!(api.app_token, "xapp-def");
}

#[test]
fn slack_identity_holds_user_id() {
    let id = SlackIdentity {
        user_id: "U0BOT".into(),
        user: Some("aion".into()),
    };
    assert_eq!(id.user_id, "U0BOT");
    assert_eq!(id.user.as_deref(), Some("aion"));
}

// -- Block Kit rendering -----------------------------------------------------

fn test_button(label: &str, action: &str, id: &str) -> ActionButton {
    ActionButton {
        label: label.to_owned(),
        action: action.to_owned(),
        params: Some([("id".to_owned(), id.to_owned())].into_iter().collect()),
    }
}

#[test]
fn blocks_lead_with_the_text_so_it_is_never_lost() {
    let blocks = build_blocks("Pick a session", &[vec![test_button("One", "session.attach", "c1")]]);

    assert_eq!(blocks[0]["type"], "section");
    assert_eq!(blocks[0]["text"]["text"], "Pick a session");
}

#[test]
fn each_row_becomes_one_actions_block() {
    let rows = vec![
        vec![test_button("One", "session.attach", "c1")],
        vec![test_button("Two", "session.attach", "c2")],
    ];

    let blocks = build_blocks("Pick", &rows);

    // section + one actions block per row
    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[1]["type"], "actions");
    assert_eq!(blocks[2]["type"], "actions");
}

#[test]
fn a_button_carries_the_shared_encoding_as_its_value() {
    // Slack hands `value` back on a tap; it must be what `callback::decode`
    // understands or the press resolves to nothing.
    let button = test_button("Open", "session.attach", "c1");
    let blocks = build_blocks("Pick", &[vec![button.clone()]]);

    let value = blocks[1]["elements"][0]["value"].as_str().unwrap();
    assert_eq!(value, callback::encode(&button));
    assert!(callback::decode(value).is_some());
}

#[test]
fn an_over_long_row_is_split_rather_than_truncated() {
    // Slack allows 5 elements per actions block. Dropping the rest would
    // silently remove choices from a picker.
    let row: Vec<ActionButton> = (0..7)
        .map(|i| test_button(&format!("B{i}"), "session.attach", &format!("c{i}")))
        .collect();

    let blocks = build_blocks("Pick", &[row]);

    let rendered: usize = blocks
        .iter()
        .filter(|b| b["type"] == "actions")
        .map(|b| b["elements"].as_array().unwrap().len())
        .sum();
    assert_eq!(rendered, 7, "every button must survive the split");
    assert!(blocks.iter().filter(|b| b["type"] == "actions").count() >= 2);
}

#[test]
fn no_rows_render_no_action_blocks() {
    let blocks = build_blocks("Just text", &[]);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0]["type"], "section");
}
