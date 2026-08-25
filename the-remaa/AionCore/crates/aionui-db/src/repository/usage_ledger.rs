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
    ///
    /// Saturating, like `total()`: this runs inside the recorder BEFORE the
    /// storage call, so a plain `-` would panic on overflow in debug and wrap
    /// in release — either way defeating the recorder's contract that token
    /// accounting never takes a turn down with it.
    pub fn diff(&self, previous: &Self) -> Self {
        Self {
            input_tokens: self.input_tokens.saturating_sub(previous.input_tokens),
            output_tokens: self.output_tokens.saturating_sub(previous.output_tokens),
            cache_read_tokens: self.cache_read_tokens.saturating_sub(previous.cache_read_tokens),
            cache_write_tokens: self.cache_write_tokens.saturating_sub(previous.cache_write_tokens),
            other_tokens: self.other_tokens.saturating_sub(previous.other_tokens),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(input: i64, output: i64, cache_read: i64, cache_write: i64, other: i64) -> TurnTokens {
        TurnTokens {
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            other_tokens: other,
        }
    }

    #[test]
    fn total_saturates_instead_of_overflowing() {
        // A backend that reports a garbage or hostile figure must not abort the
        // turn: plain `+` panics on overflow in debug builds and silently wraps
        // to a large negative in release, which would then be written to the
        // ledger and make a user's day total go backwards.
        assert_eq!(
            parts(i64::MAX, i64::MAX, i64::MAX, i64::MAX, i64::MAX).total(),
            i64::MAX
        );
    }

    #[test]
    fn total_saturates_at_the_negative_bound_too() {
        // Corrections are signed, so the sum can be driven downward as well;
        // the same wrap would flip a huge subtraction into a huge credit.
        assert_eq!(parts(i64::MIN, i64::MIN, 0, 0, 0).total(), i64::MIN);
    }

    #[test]
    fn a_large_total_keeps_full_precision_when_it_does_not_overflow() {
        // Guards a "clamp everything to i32/u32" style regression: values well
        // past 4 billion are ordinary for a cache-heavy month of usage.
        assert_eq!(parts(5_000_000_000, 0, 8_000_000_000, 0, 0).total(), 13_000_000_000);
    }

    #[test]
    fn unattributed_totals_without_inventing_a_breakdown() {
        // ACP reports an authoritative turn total but not its composition.
        // Attributing it to `input_tokens` would make the future breakdown
        // consumer report input tokens that were never measured.
        let t = TurnTokens::unattributed(4242);
        assert_eq!(t.total(), 4242);
        assert_eq!(t, parts(0, 0, 0, 0, 4242));
    }

    #[test]
    fn an_unattributed_zero_is_still_nothing_to_write() {
        // A backend that reports a turn total of 0 must not force a write; the
        // repository and recorder both skip on `is_zero`.
        assert!(TurnTokens::unattributed(0).is_zero());
    }

    #[test]
    fn is_zero_is_component_wise_not_total_wise() {
        // A pure re-attribution correction (tokens moved from input to output)
        // nets to a total of zero but still has to be written, or the component
        // columns drift permanently apart from reality. Implementing `is_zero`
        // as `total() == 0` would make the recorder drop it silently.
        let reattribution = parts(5, -5, 0, 0, 0);
        assert_eq!(reattribution.total(), 0);
        assert!(!reattribution.is_zero());
    }

    #[test]
    fn a_default_turn_is_zero() {
        assert!(TurnTokens::default().is_zero());
    }

    #[test]
    fn re_reporting_identical_figures_diffs_to_nothing() {
        // The duplicate usage frame that `broadcast_usage_frame` emits for
        // codex/ACP arrives with the exact same numbers; if this were not
        // exactly zero the turn would be booked twice.
        let t = parts(10, 5, 1000, 200, 3);
        assert!(t.diff(&t).is_zero());
    }

    #[test]
    fn diff_against_a_larger_previous_report_is_negative() {
        // A backend that revises a turn DOWN must produce a credit, not a
        // saturated zero — otherwise the over-report can never be undone.
        assert_eq!(parts(40, 0, 0, 0, 0).diff(&parts(100, 0, 0, 0, 0)).input_tokens, -60);
    }

    #[test]
    fn diff_is_per_component_not_driven_by_the_total() {
        // Figures can move between buckets while the total grows. Each column
        // must be corrected on its own, or the breakdown silently rots even
        // though the headline total stays right.
        let delta = parts(50, 200, 0, 0, 0).diff(&parts(100, 0, 0, 0, 0));
        assert_eq!(delta, parts(-50, 200, 0, 0, 0));
        assert_eq!(delta.total(), 150);
    }

    #[test]
    fn applying_a_diff_to_the_previous_report_reconstructs_the_new_one() {
        // The ledger stores sums of diffs, so `previous + diff == latest` is
        // the invariant that keeps a re-reported turn's stored row equal to the
        // backend's final figures.
        let previous = parts(10, 20, 30, 40, 50);
        let latest = parts(11, 19, 300, 40, 55);
        let delta = latest.diff(&previous);
        let rebuilt = parts(
            previous.input_tokens + delta.input_tokens,
            previous.output_tokens + delta.output_tokens,
            previous.cache_read_tokens + delta.cache_read_tokens,
            previous.cache_write_tokens + delta.cache_write_tokens,
            previous.other_tokens + delta.other_tokens,
        );
        assert_eq!(rebuilt, latest);
    }

    #[test]
    fn diff_keeps_full_precision_near_the_upper_bound() {
        // Guards a narrowing regression in `diff`: a long-lived cumulative
        // counter can legitimately sit in the billions, and the increment must
        // not be computed in a narrower type.
        assert_eq!(
            parts(i64::MAX, 0, 0, 0, 0).diff(&parts(1, 0, 0, 0, 0)).input_tokens,
            i64::MAX - 1
        );
    }
}
