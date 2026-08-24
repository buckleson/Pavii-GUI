//! Integration tests for `cached_slash_command_items` — the read side of the
//! persisted `agent_metadata.available_commands` snapshot.
//!
//! The stored value is what `CatalogForwarder` writes: a JSON array of ACP
//! `AvailableCommand`s run through `normalize_keys_to_snake_case` (which
//! preserves `_meta` verbatim). These tests pin the contract of reading that
//! blob back: valid arrays convert, metadata survives, and every malformed
//! shape degrades to `None` (a cache miss), never a panic or an error.

use aionui_ai_agent::manager::acp::cached_slash_command_items;
use aionui_api_types::SlashCommandCompletionBehavior;

#[test]
fn valid_array_round_trips_names_and_descriptions() {
    let raw = r#"[
        { "name": "init", "description": "Set up the project" },
        { "name": "review", "description": "Review the current diff" }
    ]"#;

    let items = cached_slash_command_items(raw).expect("valid command array should parse");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].command, "init");
    assert_eq!(items[0].description, "Set up the project");
    assert_eq!(items[1].command, "review");
    assert_eq!(items[1].description, "Review the current diff");
    // No `_meta` on either command → all metadata-derived fields stay unset.
    assert!(items[0].completion_behavior.is_none());
    assert!(items[0].empty_turn_tip_code.is_none());
    assert!(items[0].empty_turn_tip_params.is_none());
}

#[test]
fn meta_completion_behavior_and_tip_fields_survive() {
    // `_meta` is the serde-renamed `meta` field on the SDK's AvailableCommand;
    // this test proves the rename round-trips through a plain deserialize and
    // that the completion-behavior / empty-turn-tip metadata reaches the item.
    let raw = r#"[
        {
            "name": "compact",
            "description": "Compact the conversation history",
            "_meta": {
                "completion_behavior": "normal"
            }
        },
        {
            "name": "clear",
            "description": "Clear the conversation",
            "_meta": {
                "completion_behavior": "neutral_tip_on_empty",
                "empty_turn_tip_code": "conversation.cleared",
                "empty_turn_tip_params": { "scope": "session" }
            }
        }
    ]"#;

    let items = cached_slash_command_items(raw).expect("commands with _meta should parse");
    assert_eq!(items.len(), 2);

    assert_eq!(items[0].command, "compact");
    assert_eq!(
        items[0].completion_behavior,
        Some(SlashCommandCompletionBehavior::Normal)
    );
    assert!(items[0].empty_turn_tip_code.is_none());

    assert_eq!(items[1].command, "clear");
    assert_eq!(
        items[1].completion_behavior,
        Some(SlashCommandCompletionBehavior::NeutralTipOnEmpty)
    );
    assert_eq!(items[1].empty_turn_tip_code.as_deref(), Some("conversation.cleared"));
    assert_eq!(
        items[1].empty_turn_tip_params,
        Some(serde_json::json!({ "scope": "session" }))
    );
}

#[test]
fn empty_array_is_some_empty() {
    // An agent that advertised zero commands is a valid (empty) cache hit,
    // distinct from "no cache at all".
    let items = cached_slash_command_items("[]").expect("empty array is a valid catalog");
    assert!(items.is_empty());
}

#[test]
fn malformed_json_is_none() {
    assert!(cached_slash_command_items("not json at all").is_none());
    assert!(cached_slash_command_items("[{\"name\": ").is_none());
    assert!(cached_slash_command_items("").is_none());
}

#[test]
fn wrapped_object_shape_is_none() {
    // The `{"available_commands":[...]}` wrapped shape (seen in a
    // registry_tests fixture) is not what CatalogForwarder persists — the
    // cache reader must treat it as a miss, not unwrap it.
    let raw = r#"{"available_commands":[{"name":"review","description":"Review the current diff"}]}"#;
    assert!(cached_slash_command_items(raw).is_none());
}

#[test]
fn array_with_non_object_entry_is_none() {
    // `Vec<AvailableCommand>` deserialization is all-or-nothing: the SDK's
    // item-skipping leniency (VecSkipError) lives on AvailableCommandsUpdate,
    // not on a bare Vec, so one bad entry invalidates the whole cache read.
    let raw = r#"[
        { "name": "init", "description": "Set up the project" },
        42
    ]"#;
    assert!(cached_slash_command_items(raw).is_none());
}
