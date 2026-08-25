//! Records token usage into the per-day ledger (`usage_ledger_days`).
//!
//! This sits at the point every turn passes through, whatever surface drove it
//! — desktop chat, scheduled task, channel message or WebUI — so the ledger
//! covers all of them rather than only conversations a desktop window happens
//! to have open.
//!
//! # Why backends cannot be summed naively
//!
//! Each backend reports usage in its own dialect, and two of them report a
//! RUNNING TOTAL rather than what a turn just consumed. Adding those totals up
//! counts the same tokens once per remaining turn of the session:
//!
//! * aionrs accumulates into `total_usage` and hands back the running total on
//!   every result (`aion-agent`'s `Engine::record_turn_usage` does
//!   `self.total_usage.input_tokens += …`, and the field is restored from the
//!   persisted session on resume).
//! * codex reports both: `tokenUsage.total.*` is session-cumulative while
//!   `.last` is the final request only (verified by the live two-turn probe
//!   recorded in `aionui-session/src/backend/codex_conn.rs` `map_usage` docs —
//!   turn 2 had `last.totalTokens: 11030` against `total.totalTokens: 22043`).
//!
//! [`UsageReport`] makes that distinction explicit so the caller states which
//! it has, and the recorder does the arithmetic.
//!
//! # Duplicate reports
//!
//! A single turn can be reported more than once: `broadcast_usage_frame`
//! deliberately emits a second frame for codex/ACP, and claude's non-blocking
//! Workflow turn produces several `result` frames. Recording is therefore keyed
//! by the envelope's `turn_gen`: within one turn the recorder writes only what
//! changed since its last report, and counts the turn once.

use std::collections::HashMap;
use std::sync::Arc;

use aionui_db::{IUsageLedgerRepository, TurnTokens, UsageEntry};
use tokio::sync::Mutex;

/// What a backend's numbers mean.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageReport {
    /// Absolute counts for the turn being reported. Re-reporting the same turn
    /// with larger figures records only the difference.
    Turn(TurnTokens),
    /// Running totals for the whole session. What this turn consumed is the
    /// increase since the previous report.
    SessionCumulative(TurnTokens),
}

/// Who produced the tokens.
#[derive(Debug, Clone, Copy)]
pub struct UsageIdentity<'a> {
    pub user_id: &'a str,
    pub conversation_id: &'a str,
    /// The CLI actually behind the conversation — `claude`, `codex`,
    /// `opencode`, `aionrs`… NOT the `AgentType`, which is `acp` for the whole
    /// ACP family and would collapse every agent into one bucket.
    pub agent_kind: &'a str,
    /// Model id when the backend reports one.
    pub model: Option<&'a str>,
}

/// Per-conversation memory of what has already been recorded.
#[derive(Debug, Default)]
struct ConversationUsage {
    /// Envelope turn generation the figures below belong to.
    turn_gen: u64,
    /// Absolute figures already written for `turn_gen` ([`UsageReport::Turn`]).
    turn_tokens: TurnTokens,
    /// Last session-cumulative totals seen
    /// ([`UsageReport::SessionCumulative`]).
    cumulative: TurnTokens,
    /// Whether `turn_gen` has already been counted in the `turns` column.
    counted: bool,
    /// False until the first cumulative report, so a session that resumes with
    /// a non-zero running total does not book that history as one huge turn.
    seen_cumulative: bool,
}

pub struct UsageRecorder {
    repo: Arc<dyn IUsageLedgerRepository>,
    state: Mutex<HashMap<String, ConversationUsage>>,
}

impl std::fmt::Debug for UsageRecorder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UsageRecorder").finish_non_exhaustive()
    }
}

impl UsageRecorder {
    pub fn new(repo: Arc<dyn IUsageLedgerRepository>) -> Self {
        Self {
            repo,
            state: Mutex::new(HashMap::new()),
        }
    }

    /// Record one usage report. Best-effort: a storage failure is logged, never
    /// propagated into the turn.
    pub async fn record(&self, identity: UsageIdentity<'_>, turn_gen: u64, report: UsageReport) {
        let (tokens, turns) = {
            let mut state = self.state.lock().await;
            let entry = state.entry(identity.conversation_id.to_string()).or_default();

            if entry.turn_gen != turn_gen {
                entry.turn_gen = turn_gen;
                entry.turn_tokens = TurnTokens::default();
                entry.counted = false;
            }

            let delta = match report {
                UsageReport::Turn(absolute) => {
                    let delta = absolute.diff(&entry.turn_tokens);
                    entry.turn_tokens = absolute;
                    delta
                }
                UsageReport::SessionCumulative(cumulative) => {
                    if !entry.seen_cumulative {
                        // First report of this session in this process. On a
                        // resume the running total already covers turns from
                        // previous runs, which were recorded when they
                        // happened; booking them again here would double them.
                        // Take the baseline and count nothing.
                        entry.seen_cumulative = true;
                        entry.cumulative = cumulative;
                        TurnTokens::default()
                    } else if cumulative.total() < entry.cumulative.total() {
                        // The counter went backwards, so it was re-based (a
                        // respawn restarts it). Treat the new value as the
                        // turn's own usage rather than recording a negative.
                        entry.cumulative = cumulative;
                        cumulative
                    } else {
                        let delta = cumulative.diff(&entry.cumulative);
                        entry.cumulative = cumulative;
                        delta
                    }
                }
            };

            let turns = i64::from(!entry.counted);
            entry.counted = true;
            (delta, turns)
        };

        if tokens.is_zero() && turns == 0 {
            return;
        }

        let day = local_day();
        let result = self
            .repo
            .add_usage(UsageEntry {
                user_id: identity.user_id,
                day: &day,
                agent_kind: identity.agent_kind,
                model: identity.model.unwrap_or_default(),
                tokens,
                turns,
            })
            .await;

        if let Err(err) = result {
            // Usage accounting must never take a turn down with it, but a
            // silent loss is undiagnosable — the number just reads low later.
            tracing::warn!(
                conversation_id = %identity.conversation_id,
                agent_kind = %identity.agent_kind,
                error = %err,
                "failed to record token usage"
            );
        }
    }

    /// Drop a conversation's accounting state once its session ends, so the map
    /// does not grow for the lifetime of the process.
    pub async fn forget(&self, conversation_id: &str) {
        self.state.lock().await.remove(conversation_id);
    }
}

/// Local calendar day. Local rather than UTC so the profile's activity heatmap
/// lines up with the days the user actually worked.
fn local_day() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aionui_db::{DbError, UsageDayTotals};
    use std::sync::Mutex as StdMutex;

    /// Captures what reached the repository. The SQLite implementation has its
    /// own tests; these pin the recorder's arithmetic in isolation.
    #[derive(Default)]
    struct FakeRepo {
        writes: StdMutex<Vec<(String, TurnTokens, i64)>>,
    }

    #[async_trait::async_trait]
    impl IUsageLedgerRepository for FakeRepo {
        async fn add_usage(&self, entry: UsageEntry<'_>) -> Result<(), DbError> {
            self.writes
                .lock()
                .unwrap()
                .push((entry.agent_kind.to_string(), entry.tokens, entry.turns));
            Ok(())
        }

        async fn list_days(&self, _user_id: &str) -> Result<Vec<UsageDayTotals>, DbError> {
            Ok(vec![])
        }
    }

    impl FakeRepo {
        fn totals(&self) -> (i64, i64) {
            let writes = self.writes.lock().unwrap();
            (
                writes.iter().map(|(_, t, _)| t.total()).sum(),
                writes.iter().map(|(_, _, n)| n).sum(),
            )
        }
    }

    fn tokens(input: i64, output: i64, cache_read: i64, cache_write: i64) -> TurnTokens {
        TurnTokens {
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            other_tokens: 0,
        }
    }

    fn identity<'a>(agent_kind: &'a str) -> UsageIdentity<'a> {
        UsageIdentity {
            user_id: "u1",
            conversation_id: "c1",
            agent_kind,
            model: Some("m1"),
        }
    }

    fn recorder() -> (UsageRecorder, Arc<FakeRepo>) {
        let repo = Arc::new(FakeRepo::default());
        (UsageRecorder::new(repo.clone()), repo)
    }

    #[tokio::test]
    async fn per_turn_report_counts_everything_including_cache() {
        let (rec, repo) = recorder();
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(10, 5, 1000, 200)))
            .await;

        assert_eq!(repo.totals(), (1215, 1));
    }

    #[tokio::test]
    async fn repeated_report_of_one_turn_records_only_the_increase() {
        let (rec, repo) = recorder();
        // claude's Workflow turn emits several `result` frames, and
        // `broadcast_usage_frame` deliberately duplicates for codex/ACP.
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(140, 10, 0, 0)))
            .await;

        // 150 total for the turn, counted once — not 100+100+150.
        assert_eq!(repo.totals(), (150, 1));
    }

    #[tokio::test]
    async fn separate_turns_each_count() {
        let (rec, repo) = recorder();
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;
        rec.record(identity("claude"), 2, UsageReport::Turn(tokens(70, 0, 0, 0)))
            .await;

        assert_eq!(repo.totals(), (170, 2));
    }

    #[tokio::test]
    async fn cumulative_totals_are_never_re_added() {
        let (rec, repo) = recorder();
        // A running total climbing 100 → 250 → 400 is 150 then 150 of new work,
        // not 750. This is the aionrs/codex inflation the recorder exists for.
        rec.record(
            identity("aionrs"),
            1,
            UsageReport::SessionCumulative(tokens(100, 0, 0, 0)),
        )
        .await;
        rec.record(
            identity("aionrs"),
            2,
            UsageReport::SessionCumulative(tokens(250, 0, 0, 0)),
        )
        .await;
        rec.record(
            identity("aionrs"),
            3,
            UsageReport::SessionCumulative(tokens(400, 0, 0, 0)),
        )
        .await;

        // The first report only establishes the baseline (it may carry history
        // from before this process), so 150 + 150 lands and three turns count.
        assert_eq!(repo.totals(), (300, 3));
    }

    #[tokio::test]
    async fn duplicate_cumulative_report_within_a_turn_adds_nothing() {
        let (rec, repo) = recorder();
        rec.record(
            identity("codex"),
            1,
            UsageReport::SessionCumulative(tokens(100, 0, 0, 0)),
        )
        .await;
        rec.record(
            identity("codex"),
            2,
            UsageReport::SessionCumulative(tokens(300, 0, 0, 0)),
        )
        .await;
        rec.record(
            identity("codex"),
            2,
            UsageReport::SessionCumulative(tokens(300, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (200, 2));
    }

    #[tokio::test]
    async fn several_cumulative_reports_in_one_turn_sum_but_count_one_turn() {
        let (rec, repo) = recorder();
        // codex emits `tokenUsage/updated` more than once across tool rounds.
        rec.record(
            identity("codex"),
            1,
            UsageReport::SessionCumulative(tokens(100, 0, 0, 0)),
        )
        .await;
        rec.record(
            identity("codex"),
            2,
            UsageReport::SessionCumulative(tokens(180, 0, 0, 0)),
        )
        .await;
        rec.record(
            identity("codex"),
            2,
            UsageReport::SessionCumulative(tokens(260, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (160, 2));
    }

    #[tokio::test]
    async fn a_rebased_counter_is_treated_as_this_turn_not_a_negative() {
        let (rec, repo) = recorder();
        rec.record(
            identity("codex"),
            1,
            UsageReport::SessionCumulative(tokens(500, 0, 0, 0)),
        )
        .await;
        // A `--resume` respawn restarts the counter.
        rec.record(
            identity("codex"),
            2,
            UsageReport::SessionCumulative(tokens(40, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (40, 2));
    }

    #[tokio::test]
    async fn a_turn_reporting_nothing_still_counts_as_a_turn() {
        let (rec, repo) = recorder();
        rec.record(identity("opencode"), 1, UsageReport::Turn(TurnTokens::default()))
            .await;

        assert_eq!(repo.totals(), (0, 1));
    }

    #[tokio::test]
    async fn conversations_are_tracked_independently() {
        let (rec, repo) = recorder();
        rec.record(
            UsageIdentity {
                conversation_id: "a",
                ..identity("claude")
            },
            1,
            UsageReport::Turn(tokens(100, 0, 0, 0)),
        )
        .await;
        rec.record(
            UsageIdentity {
                conversation_id: "b",
                ..identity("claude")
            },
            1,
            UsageReport::Turn(tokens(70, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (170, 2));
    }

    #[tokio::test]
    async fn forgetting_a_conversation_drops_its_baseline() {
        let (rec, repo) = recorder();
        rec.record(
            identity("aionrs"),
            1,
            UsageReport::SessionCumulative(tokens(100, 0, 0, 0)),
        )
        .await;
        rec.forget("c1").await;
        // A fresh session starts a fresh baseline rather than diffing against
        // a total that belongs to a process that has gone.
        rec.record(
            identity("aionrs"),
            1,
            UsageReport::SessionCumulative(tokens(60, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (0, 2));
    }
}
