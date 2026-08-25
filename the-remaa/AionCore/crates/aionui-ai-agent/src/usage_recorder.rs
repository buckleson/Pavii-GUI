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

    /// One `add_usage` call as it reached the repository.
    #[derive(Debug, Clone)]
    struct Write {
        agent_kind: String,
        model: String,
        tokens: TurnTokens,
        turns: i64,
    }

    /// Captures what reached the repository. The SQLite implementation has its
    /// own tests; these pin the recorder's arithmetic in isolation.
    #[derive(Default)]
    struct FakeRepo {
        writes: StdMutex<Vec<Write>>,
    }

    #[async_trait::async_trait]
    impl IUsageLedgerRepository for FakeRepo {
        async fn add_usage(&self, entry: UsageEntry<'_>) -> Result<(), DbError> {
            self.writes.lock().unwrap().push(Write {
                agent_kind: entry.agent_kind.to_string(),
                model: entry.model.to_string(),
                tokens: entry.tokens,
                turns: entry.turns,
            });
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
                writes.iter().map(|w| w.tokens.total()).sum(),
                writes.iter().map(|w| w.turns).sum(),
            )
        }

        fn writes(&self) -> Vec<Write> {
            self.writes.lock().unwrap().clone()
        }
    }

    /// Storage that always fails, to prove a ledger outage cannot break a turn.
    #[derive(Default)]
    struct FailingRepo {
        calls: StdMutex<usize>,
    }

    #[async_trait::async_trait]
    impl IUsageLedgerRepository for FailingRepo {
        async fn add_usage(&self, _entry: UsageEntry<'_>) -> Result<(), DbError> {
            *self.calls.lock().unwrap() += 1;
            // The realistic failure: the pool is gone because the app is
            // shutting down while a turn is still finishing.
            Err(DbError::Query(sqlx::Error::PoolClosed))
        }

        async fn list_days(&self, _user_id: &str) -> Result<Vec<UsageDayTotals>, DbError> {
            Ok(vec![])
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

    #[tokio::test]
    async fn forgetting_a_conversation_drops_its_per_turn_figures_too() {
        let (rec, repo) = recorder();
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;
        rec.forget("c1").await;
        // If `forget` cleared only the cumulative half of the state, the
        // re-report below would diff 100 against a stale 100, record nothing,
        // and the turn's tokens would vanish from the ledger.
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;

        assert_eq!(repo.totals(), (200, 2));
    }

    #[tokio::test]
    async fn forgetting_an_unknown_conversation_is_harmless() {
        let (rec, repo) = recorder();
        // `forget` is called from session teardown, which also runs for
        // sessions that never produced a usage report. A lookup that assumed
        // the key exists would panic on the shutdown path.
        rec.forget("never-seen").await;
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(10, 0, 0, 0)))
            .await;

        assert_eq!(repo.totals(), (10, 1));
    }

    #[tokio::test]
    async fn turn_generation_zero_is_a_real_generation_not_an_unset_marker() {
        let (rec, repo) = recorder();
        // `ConversationUsage::default()` starts at turn_gen 0, so the very
        // first turn of a conversation collides with the sentinel. Treating 0
        // as "no turn recorded yet" would re-add the duplicate frame below.
        rec.record(identity("claude"), 0, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;
        rec.record(identity("claude"), 0, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;

        assert_eq!(repo.totals(), (100, 1));
    }

    #[tokio::test]
    async fn a_turn_generation_that_moves_backwards_starts_a_fresh_turn() {
        let (rec, repo) = recorder();
        rec.record(identity("claude"), 5, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;
        // Frames can be reordered or a backend can restart its counter. A
        // `turn_gen > current` guard instead of `!=` would leave turn 5's
        // figures in place and diff 30 against 100, writing -70 to the ledger.
        rec.record(identity("claude"), 4, UsageReport::Turn(tokens(30, 0, 0, 0)))
            .await;

        assert_eq!(repo.totals(), (130, 2));
    }

    #[tokio::test]
    async fn a_generation_that_repeats_after_moving_on_is_never_booked_as_a_credit() {
        let (rec, repo) = recorder();
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;
        rec.record(identity("claude"), 2, UsageReport::Turn(tokens(50, 0, 0, 0)))
            .await;
        // Only the current generation's figures are retained, so a late frame
        // for generation 1 is booked as new work. The failure this guards is
        // the alternative: diffing 100 against generation 2's 50 and writing a
        // negative that would erase real usage from the day.
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(100, 0, 0, 0)))
            .await;

        assert_eq!(repo.totals(), (250, 3));
        assert!(repo.writes().iter().all(|w| w.tokens.total() >= 0));
    }

    #[tokio::test]
    async fn per_turn_and_cumulative_baselines_do_not_overwrite_each_other() {
        let (rec, repo) = recorder();
        // A conversation can emit both dialects: codex sends cumulative
        // `tokenUsage` frames while a per-turn `result` frame also arrives.
        rec.record(
            identity("codex"),
            1,
            UsageReport::SessionCumulative(tokens(500, 0, 0, 0)),
        )
        .await;
        rec.record(identity("codex"), 2, UsageReport::Turn(tokens(80, 0, 0, 0)))
            .await;
        // If both dialects shared one field, the per-turn 80 would have
        // replaced the 500 baseline and this would record 480 instead of 60.
        rec.record(
            identity("codex"),
            3,
            UsageReport::SessionCumulative(tokens(560, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (140, 3));
    }

    #[tokio::test]
    async fn a_new_turn_whose_running_total_did_not_move_still_counts() {
        let (rec, repo) = recorder();
        rec.record(
            identity("aionrs"),
            1,
            UsageReport::SessionCumulative(tokens(100, 0, 0, 0)),
        )
        .await;
        // A rejected or cached turn can leave the counter untouched. Skipping
        // the write on zero tokens alone (rather than zero tokens AND zero
        // turns) would make the turn disappear from the day's turn count.
        rec.record(
            identity("aionrs"),
            2,
            UsageReport::SessionCumulative(tokens(100, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (0, 2));
    }

    #[tokio::test]
    async fn a_counter_rebased_to_zero_rebaselines_instead_of_diffing_forever() {
        let (rec, repo) = recorder();
        rec.record(
            identity("codex"),
            1,
            UsageReport::SessionCumulative(tokens(500, 0, 0, 0)),
        )
        .await;
        // A respawn can hand back a total of exactly 0 before its first
        // request completes.
        rec.record(
            identity("codex"),
            2,
            UsageReport::SessionCumulative(TurnTokens::default()),
        )
        .await;
        // The real hazard is here: if the rebase branch had not replaced the
        // stored baseline, this would diff 70 against 500 and record nothing
        // for the rest of the session.
        rec.record(
            identity("codex"),
            3,
            UsageReport::SessionCumulative(tokens(70, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (70, 3));
    }

    #[tokio::test]
    async fn tokens_moving_between_buckets_record_only_the_net_increase() {
        let (rec, repo) = recorder();
        rec.record(
            identity("codex"),
            1,
            UsageReport::SessionCumulative(tokens(100, 0, 0, 0)),
        )
        .await;
        // The running total grew 100 -> 250, but input shrank as tokens were
        // reclassified into output. Clamping each component at zero would book
        // 200 of new work instead of the 150 that actually happened.
        rec.record(
            identity("codex"),
            2,
            UsageReport::SessionCumulative(tokens(50, 200, 0, 0)),
        )
        .await;

        assert_eq!(repo.totals(), (150, 2));
        assert_eq!(repo.writes()[1].tokens.input_tokens, -50);
    }

    #[tokio::test]
    async fn a_saturated_running_total_is_not_mistaken_for_a_rebase() {
        let (rec, repo) = recorder();
        // `total()` saturates, so two absurd-but-growing totals both read as
        // i64::MAX. The rebase branch triggers on "went backwards"; if that
        // comparison were fooled here it would book the entire saturated total
        // as one turn's usage instead of the 5 tokens actually added.
        let huge = TurnTokens {
            input_tokens: i64::MAX,
            ..TurnTokens::default()
        };
        rec.record(identity("aionrs"), 1, UsageReport::SessionCumulative(huge))
            .await;
        rec.record(
            identity("aionrs"),
            2,
            UsageReport::SessionCumulative(TurnTokens {
                output_tokens: 5,
                ..huge
            }),
        )
        .await;

        assert_eq!(repo.totals(), (5, 2));
    }

    #[tokio::test]
    async fn interleaved_conversations_keep_separate_cumulative_baselines() {
        let (rec, repo) = recorder();
        let a = UsageIdentity {
            conversation_id: "a",
            ..identity("aionrs")
        };
        let b = UsageIdentity {
            conversation_id: "b",
            ..identity("aionrs")
        };
        // Two sessions running at once report alternately. Keying the state on
        // anything shared (user, agent kind) would make b's 100 diff against
        // a's baseline and turn independent sessions into nonsense deltas.
        rec.record(a, 1, UsageReport::SessionCumulative(tokens(100, 0, 0, 0)))
            .await;
        rec.record(b, 1, UsageReport::SessionCumulative(tokens(100, 0, 0, 0)))
            .await;
        rec.record(a, 2, UsageReport::SessionCumulative(tokens(250, 0, 0, 0)))
            .await;
        rec.record(b, 2, UsageReport::SessionCumulative(tokens(180, 0, 0, 0)))
            .await;

        // a contributed 150, b contributed 80; both baselines counted nothing.
        assert_eq!(repo.totals(), (230, 4));
    }

    #[tokio::test]
    async fn an_unreported_model_reaches_the_ledger_as_the_empty_string() {
        let (rec, repo) = recorder();
        // '' is the ledger's placeholder, deliberately filtered out of the
        // model breakdown. Substituting "unknown" (or leaving it NULL) would
        // either show a fake model to the user or break the primary key so
        // every turn inserted a new row.
        rec.record(
            UsageIdentity {
                model: None,
                ..identity("opencode")
            },
            1,
            UsageReport::Turn(tokens(10, 0, 0, 0)),
        )
        .await;

        assert_eq!(repo.writes()[0].model, "");
    }

    #[tokio::test]
    async fn the_backend_cli_is_recorded_not_the_acp_umbrella_type() {
        let (rec, repo) = recorder();
        // Every ACP-family agent shares AgentType `acp`; passing that through
        // would collapse gemini, opencode and qwen into one indistinguishable
        // bucket on the profile breakdown.
        rec.record(identity("opencode"), 1, UsageReport::Turn(tokens(10, 0, 0, 0)))
            .await;

        assert_eq!(repo.writes()[0].agent_kind, "opencode");
    }

    #[tokio::test]
    async fn a_ledger_write_failure_does_not_take_the_turn_down() {
        let repo = Arc::new(FailingRepo::default());
        let rec = UsageRecorder::new(repo.clone());
        // Usage accounting is best-effort: a closed pool during shutdown must
        // be logged and swallowed, never unwrapped into a panic that kills the
        // turn the user is waiting on.
        rec.record(identity("claude"), 1, UsageReport::Turn(tokens(10, 0, 0, 0)))
            .await;
        rec.record(identity("claude"), 2, UsageReport::Turn(tokens(20, 0, 0, 0)))
            .await;

        assert_eq!(*repo.calls.lock().unwrap(), 2);
    }
}
