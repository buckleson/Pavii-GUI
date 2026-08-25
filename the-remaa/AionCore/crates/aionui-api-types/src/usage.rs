use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// One day's token usage, as rendered by the profile page.
///
/// `tokens` is everything the provider processed that day — input, output and
/// both cache buckets — so it is comparable with a provider's own billing view.
/// Cache is included deliberately: agent CLIs re-send conversation context every
/// turn and providers bill it, at a reduced rate for reads.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLedgerDay {
    pub tokens: i64,
    pub turns: i64,
    /// model id -> tokens. Absent for backends that report no model.
    #[serde(default)]
    pub by_model: HashMap<String, i64>,
    /// agent kind (`claude`, `codex`, `aionrs`…) -> tokens.
    #[serde(default)]
    pub by_backend: HashMap<String, i64>,
}

/// The whole per-day ledger for the calling user, keyed `YYYY-MM-DD`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLedgerResponse {
    pub days: HashMap<String, UsageLedgerDay>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn day_with_breakdowns() -> UsageLedgerDay {
        UsageLedgerDay {
            tokens: 175,
            turns: 3,
            by_model: HashMap::from([("sonnet".to_owned(), 150), ("gpt-5".to_owned(), 25)]),
            by_backend: HashMap::from([("claude".to_owned(), 150), ("codex".to_owned(), 25)]),
        }
    }

    // ── Wire casing ────────────────────────────────────────────────
    //
    // The desktop profile page reads `byModel` / `byBackend` off this payload
    // (packages/desktop/src/renderer/pages/profile/profileStats.ts:21,150-151).
    // snake_case here would not fail any request — it would silently render
    // every model and backend total as zero.

    #[test]
    fn a_day_exposes_its_breakdowns_under_camel_case_keys() {
        let value = serde_json::to_value(day_with_breakdowns()).unwrap();

        assert_eq!(value["byModel"]["sonnet"], json!(150));
        assert_eq!(value["byBackend"]["codex"], json!(25));
    }

    #[test]
    fn a_day_never_emits_snake_case_breakdown_keys() {
        let value = serde_json::to_value(day_with_breakdowns()).unwrap();
        let object = value.as_object().unwrap();

        assert!(!object.contains_key("by_model"), "serialised as {value}");
        assert!(!object.contains_key("by_backend"), "serialised as {value}");
    }

    #[test]
    fn a_day_keeps_its_scalar_totals_under_their_plain_names() {
        let value = serde_json::to_value(day_with_breakdowns()).unwrap();

        assert_eq!(value["tokens"], json!(175));
        assert_eq!(value["turns"], json!(3));
    }

    #[test]
    fn the_response_nests_every_day_under_a_days_object_keyed_by_date() {
        let response = UsageLedgerResponse {
            days: HashMap::from([("2026-08-20".to_owned(), day_with_breakdowns())]),
        };

        let value = serde_json::to_value(&response).unwrap();

        assert_eq!(value["days"]["2026-08-20"]["tokens"], json!(175));
    }

    // ── Empty and absent ───────────────────────────────────────────

    #[test]
    fn a_day_with_no_breakdowns_serialises_them_as_empty_objects_not_null() {
        let value = serde_json::to_value(UsageLedgerDay::default()).unwrap();

        assert_eq!(value["byModel"], json!({}));
        assert_eq!(value["byBackend"], json!({}));
    }

    #[test]
    fn a_ledger_with_no_days_serialises_as_an_empty_days_object() {
        let value = serde_json::to_value(UsageLedgerResponse::default()).unwrap();

        assert_eq!(value, json!({ "days": {} }));
    }

    #[test]
    fn absent_breakdown_fields_deserialise_to_empty_maps() {
        let day: UsageLedgerDay = serde_json::from_value(json!({ "tokens": 10, "turns": 1 })).unwrap();

        assert!(day.by_model.is_empty());
        assert!(day.by_backend.is_empty());
    }

    #[test]
    fn a_zero_token_day_survives_a_round_trip() {
        let day = UsageLedgerDay::default();

        let round_tripped: UsageLedgerDay = serde_json::from_value(serde_json::to_value(&day).unwrap()).unwrap();

        assert_eq!(round_tripped, day);
    }

    #[test]
    fn a_populated_ledger_survives_a_round_trip() {
        let response = UsageLedgerResponse {
            days: HashMap::from([
                ("2026-08-20".to_owned(), day_with_breakdowns()),
                ("2026-08-21".to_owned(), UsageLedgerDay::default()),
            ]),
        };

        let round_tripped: UsageLedgerResponse =
            serde_json::from_value(serde_json::to_value(&response).unwrap()).unwrap();

        assert_eq!(round_tripped, response);
    }

    #[test]
    fn a_negative_day_total_survives_a_round_trip() {
        // Ledger writes are signed, so a correction can drive a bucket negative
        // (crates/aionui-db/src/repository/usage_ledger.rs:52-60).
        let day = UsageLedgerDay {
            tokens: -40,
            turns: 0,
            by_model: HashMap::from([("sonnet".to_owned(), -40)]),
            by_backend: HashMap::from([("claude".to_owned(), -40)]),
        };

        let round_tripped: UsageLedgerDay = serde_json::from_value(serde_json::to_value(&day).unwrap()).unwrap();

        assert_eq!(round_tripped, day);
    }

    // ── Rejected payloads ──────────────────────────────────────────

    #[test]
    fn a_day_missing_its_token_total_is_rejected_by_name() {
        let error = serde_json::from_value::<UsageLedgerDay>(json!({ "turns": 1 })).unwrap_err();

        assert!(
            error.to_string().contains("missing field `tokens`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn a_day_whose_token_total_is_a_string_is_rejected_as_a_type_error() {
        let error = serde_json::from_value::<UsageLedgerDay>(json!({ "tokens": "175", "turns": 1 })).unwrap_err();

        assert!(
            error.to_string().contains("invalid type: string"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn a_snake_case_breakdown_payload_does_not_populate_the_camel_case_field() {
        // Guards the rename in the other direction: a producer that emitted
        // snake_case must not be silently accepted as a populated breakdown.
        let day: UsageLedgerDay =
            serde_json::from_value(json!({ "tokens": 10, "turns": 1, "by_model": { "sonnet": 10 } })).unwrap();

        assert!(day.by_model.is_empty());
    }

    #[test]
    fn a_ledger_without_a_days_field_is_rejected_by_name() {
        let error = serde_json::from_value::<UsageLedgerResponse>(json!({})).unwrap_err();

        assert!(
            error.to_string().contains("missing field `days`"),
            "unexpected error: {error}"
        );
    }
}
