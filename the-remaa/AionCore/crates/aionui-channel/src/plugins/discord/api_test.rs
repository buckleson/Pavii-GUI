use super::*;

#[test]
fn api_uses_bot_auth_header() {
    let api = DiscordApi::new(Client::new(), "abc.def.ghi");
    assert_eq!(api.auth_header(), "Bot abc.def.ghi");
    assert_eq!(api.token, "abc.def.ghi");
}

#[test]
fn retry_after_uses_body_seconds() {
    let body = RateLimitBody {
        retry_after: Some(1.5),
        global: Some(false),
    };
    assert_eq!(retry_after_delay(Some(body)), Duration::from_secs_f64(1.5));
}

#[test]
fn retry_after_defaults_when_absent() {
    assert_eq!(retry_after_delay(None), Duration::from_secs_f64(1.0));
    let body = RateLimitBody {
        retry_after: None,
        global: None,
    };
    assert_eq!(retry_after_delay(Some(body)), Duration::from_secs_f64(1.0));
}

#[test]
fn retry_after_is_capped() {
    let body = RateLimitBody {
        retry_after: Some(999.0),
        global: Some(true),
    };
    assert_eq!(retry_after_delay(Some(body)), Duration::from_secs(30));
}

#[test]
fn discord_identity_holds_id() {
    let id = DiscordIdentity {
        id: "BOT1".into(),
        display_name: Some("aion".into()),
    };
    assert_eq!(id.id, "BOT1");
    assert_eq!(id.display_name.as_deref(), Some("aion"));
}

// -- message components ------------------------------------------------------

fn test_button(label: &str, id: &str) -> ActionButton {
    ActionButton {
        label: label.to_owned(),
        action: "session.attach".to_owned(),
        params: Some([("id".to_owned(), id.to_owned())].into_iter().collect()),
    }
}

#[test]
fn each_row_becomes_an_action_row_of_buttons() {
    let (rows, dropped) = build_components(&[vec![test_button("One", "c1")], vec![test_button("Two", "c2")]]);

    assert_eq!(dropped, 0);
    assert_eq!(rows.len(), 2);
    // 1 = ACTION_ROW, 2 = BUTTON.
    assert_eq!(rows[0]["type"], 1);
    assert_eq!(rows[0]["components"][0]["type"], 2);
    assert_eq!(rows[0]["components"][0]["label"], "One");
}

#[test]
fn a_button_carries_the_shared_encoding_as_its_custom_id() {
    // Discord hands `custom_id` back on a press; it must be what
    // `callback::decode` understands.
    let button = test_button("Open", "c1");
    let (rows, _) = build_components(&[vec![button.clone()]]);

    let custom_id = rows[0]["components"][0]["custom_id"].as_str().unwrap();
    assert_eq!(custom_id, callback::encode(&button));
    assert!(callback::decode(custom_id).is_some());
}

#[test]
fn an_over_long_row_is_split_rather_than_truncated() {
    // Discord allows 5 buttons per row; dropping the rest would silently
    // remove choices.
    let row: Vec<ActionButton> = (0..8)
        .map(|i| test_button(&format!("B{i}"), &format!("c{i}")))
        .collect();

    let (rows, dropped) = build_components(&[row]);

    let rendered: usize = rows.iter().map(|r| r["components"].as_array().unwrap().len()).sum();
    assert_eq!(rendered, 8, "every button must survive the split");
    assert_eq!(dropped, 0);
}

#[test]
fn rows_beyond_the_message_limit_are_reported_not_hidden() {
    // Discord allows 5 action rows. Silently dropping the rest would make a
    // truncated picker look complete.
    let rows: Vec<Vec<ActionButton>> = (0..8)
        .map(|i| vec![test_button(&format!("B{i}"), &format!("c{i}"))])
        .collect();

    let (rendered, dropped) = build_components(&rows);

    assert_eq!(rendered.len(), 5);
    assert_eq!(dropped, 3, "the caller must be able to say what was omitted");
}

#[test]
fn no_rows_render_no_components() {
    let (rows, dropped) = build_components(&[]);
    assert!(rows.is_empty());
    assert_eq!(dropped, 0);
}
