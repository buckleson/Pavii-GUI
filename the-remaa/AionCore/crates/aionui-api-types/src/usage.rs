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
