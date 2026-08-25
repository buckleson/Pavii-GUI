//! Repository trait for the `usage_ledger_days` table.
//!
//! One row per (user, local day, agent kind, model), holding the tokens that
//! passed through this application on that day. See migration 040 for why the
//! grain is a day aggregate and why cache buckets are part of the total.
//!
//! Writes are additive and signed: [`IUsageLedgerRepository::add_usage`] adds
//! whatever it is given, so a caller correcting a turn it already reported
//! passes the difference rather than the new absolute value.

use crate::error::DbError;

/// Token counts for one turn, already resolved to a uniform meaning by the
/// caller (see `aionui-ai-agent`'s usage recorder, which normalises each
/// backend's dialect before it reaches this layer).
///
/// Fields are signed so a correction can subtract. `total()` is the
/// billing-comparable figure: everything the provider processed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TurnTokens {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    /// Counted in the total, but with no reported breakdown. See migration 040.
    pub other_tokens: i64,
}

impl TurnTokens {
    /// A backend-authoritative turn total whose composition it did not report.
    pub fn unattributed(total: i64) -> Self {
        Self {
            other_tokens: total,
            ..Self::default()
        }
    }

    pub fn total(&self) -> i64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens)
            .saturating_add(self.other_tokens)
    }

    /// True when every component is zero — nothing worth a write.
    pub fn is_zero(&self) -> bool {
        *self == Self::default()
    }

    /// Component-wise difference, for re-reporting a turn whose figures grew.
    pub fn diff(&self, previous: &Self) -> Self {
        Self {
            input_tokens: self.input_tokens - previous.input_tokens,
            output_tokens: self.output_tokens - previous.output_tokens,
            cache_read_tokens: self.cache_read_tokens - previous.cache_read_tokens,
            cache_write_tokens: self.cache_write_tokens - previous.cache_write_tokens,
            other_tokens: self.other_tokens - previous.other_tokens,
        }
    }
}

/// Identity of the work that produced a set of tokens.
#[derive(Debug, Clone)]
pub struct UsageEntry<'a> {
    pub user_id: &'a str,
    /// Local calendar day, `YYYY-MM-DD`.
    pub day: &'a str,
    /// Conversation `agent_type`, e.g. `claude` / `codex` / `aionrs`.
    pub agent_kind: &'a str,
    /// Model id if known; `""` when the backend did not report one.
    pub model: &'a str,
    pub tokens: TurnTokens,
    /// How many turns this call represents. `0` for a correction to a turn
    /// that was already counted.
    pub turns: i64,
}

/// One day's totals for one user, summed across agents and models.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UsageDayTotals {
    pub day: String,
    pub tokens: i64,
    pub turns: i64,
    /// model id -> tokens. Models the backend never reported are omitted
    /// rather than bucketed under an empty key.
    pub by_model: Vec<(String, i64)>,
    /// agent kind -> tokens.
    pub by_backend: Vec<(String, i64)>,
}

#[async_trait::async_trait]
pub trait IUsageLedgerRepository: Send + Sync {
    /// Add one turn's tokens (or a signed correction) to its day bucket.
    ///
    /// A zero-token entry with no turns to add is a no-op, so callers need not
    /// pre-filter backends that report nothing.
    async fn add_usage(&self, entry: UsageEntry<'_>) -> Result<(), DbError>;

    /// Every recorded day for the user, ascending by day.
    async fn list_days(&self, user_id: &str) -> Result<Vec<UsageDayTotals>, DbError>;
}
