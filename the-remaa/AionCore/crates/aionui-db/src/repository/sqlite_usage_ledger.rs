use sqlx::{Row, SqlitePool};

use crate::error::DbError;
use crate::repository::usage_ledger::{IUsageLedgerRepository, UsageDayTotals, UsageEntry};

/// SQLite-backed implementation of [`IUsageLedgerRepository`].
#[derive(Clone, Debug)]
pub struct SqliteUsageLedgerRepository {
    pool: SqlitePool,
}

impl SqliteUsageLedgerRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl IUsageLedgerRepository for SqliteUsageLedgerRepository {
    async fn add_usage(&self, entry: UsageEntry<'_>) -> Result<(), DbError> {
        // Nothing to record. Backends that report no usage at all (plain ACP
        // before its first snapshot) hit this on every turn.
        if entry.tokens.is_zero() && entry.turns == 0 {
            return Ok(());
        }

        let now = aionui_common::now_ms();

        // Signed adds: a correction to an already-counted turn arrives as the
        // difference with `turns: 0`, and lands on the same row.
        sqlx::query(
            "INSERT INTO usage_ledger_days (\
                user_id, day, agent_kind, model, \
                tokens, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, other_tokens, \
                turns, updated_at\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(user_id, day, agent_kind, model) DO UPDATE SET \
                tokens = tokens + excluded.tokens, \
                input_tokens = input_tokens + excluded.input_tokens, \
                output_tokens = output_tokens + excluded.output_tokens, \
                cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens, \
                cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens, \
                other_tokens = other_tokens + excluded.other_tokens, \
                turns = turns + excluded.turns, \
                updated_at = excluded.updated_at",
        )
        .bind(entry.user_id)
        .bind(entry.day)
        .bind(entry.agent_kind)
        .bind(entry.model)
        .bind(entry.tokens.total())
        .bind(entry.tokens.input_tokens)
        .bind(entry.tokens.output_tokens)
        .bind(entry.tokens.cache_read_tokens)
        .bind(entry.tokens.cache_write_tokens)
        .bind(entry.tokens.other_tokens)
        .bind(entry.turns)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn list_days(&self, user_id: &str) -> Result<Vec<UsageDayTotals>, DbError> {
        let rows = sqlx::query(
            "SELECT day, agent_kind, model, tokens, turns \
             FROM usage_ledger_days WHERE user_id = ? ORDER BY day, agent_kind, model",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        // Rows arrive grouped by day (ORDER BY), so fold them in one pass.
        let mut out: Vec<UsageDayTotals> = Vec::new();
        for row in rows {
            let day: String = row.try_get("day")?;
            let agent_kind: String = row.try_get("agent_kind")?;
            let model: String = row.try_get("model")?;
            let tokens: i64 = row.try_get("tokens")?;
            let turns: i64 = row.try_get("turns")?;

            let bucket = match out.last_mut() {
                Some(last) if last.day == day => last,
                _ => {
                    out.push(UsageDayTotals {
                        day: day.clone(),
                        ..Default::default()
                    });
                    out.last_mut().expect("just pushed")
                }
            };

            bucket.tokens += tokens;
            bucket.turns += turns;
            accumulate(&mut bucket.by_backend, &agent_kind, tokens);
            // An unknown model is stored as '' so the primary key behaves;
            // it must not surface as a real model in the breakdown.
            if !model.is_empty() {
                accumulate(&mut bucket.by_model, &model, tokens);
            }
        }

        Ok(out)
    }
}

fn accumulate(entries: &mut Vec<(String, i64)>, key: &str, tokens: i64) {
    if let Some(existing) = entries.iter_mut().find(|(name, _)| name == key) {
        existing.1 += tokens;
    } else {
        entries.push((key.to_string(), tokens));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_database_memory;
    use crate::repository::usage_ledger::TurnTokens;

    const USER_A: &str = "system_default_user";
    const USER_B: &str = "user_b";
    const DAY: &str = "2026-08-25";

    async fn setup() -> (SqliteUsageLedgerRepository, crate::Database) {
        let db = init_database_memory().await.unwrap();
        sqlx::query(
            "INSERT INTO users (id, user_type, username, password_hash, status, session_generation, created_at, updated_at) \
             VALUES (?, 'local', ?, 'hash', 'active', 0, 1, 1)",
        )
        .bind(USER_B)
        .bind(USER_B)
        .execute(db.pool())
        .await
        .unwrap();
        let repo = SqliteUsageLedgerRepository::new(db.pool().clone());
        (repo, db)
    }

    /// Breakdown order is an artifact of the SQL ORDER BY, not a contract —
    /// the consumer folds these into a JSON object. Compare as sets.
    fn sorted(entries: &[(String, i64)]) -> Vec<(&str, i64)> {
        let mut out: Vec<(&str, i64)> = entries.iter().map(|(k, v)| (k.as_str(), *v)).collect();
        out.sort_by(|a, b| a.0.cmp(b.0));
        out
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

    fn entry<'a>(day: &'a str, agent_kind: &'a str, model: &'a str, tokens: TurnTokens) -> UsageEntry<'a> {
        UsageEntry {
            user_id: USER_A,
            day,
            agent_kind,
            model,
            tokens,
            turns: 1,
        }
    }

    #[tokio::test]
    async fn empty_ledger_lists_nothing() {
        let (repo, _db) = setup().await;
        assert!(repo.list_days(USER_A).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn total_includes_cache_buckets() {
        let (repo, _db) = setup().await;
        repo.add_usage(entry(DAY, "claude", "claude-sonnet-5", tokens(10, 5, 1000, 200)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days.len(), 1);
        // The whole point of the schema: cache is billed, so it counts.
        assert_eq!(days[0].tokens, 1215);
        assert_eq!(days[0].turns, 1);
    }

    #[tokio::test]
    async fn same_bucket_accumulates() {
        let (repo, _db) = setup().await;
        for _ in 0..3 {
            repo.add_usage(entry(DAY, "codex", "gpt-x", tokens(100, 10, 0, 0)))
                .await
                .unwrap();
        }

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].tokens, 330);
        assert_eq!(days[0].turns, 3);
    }

    #[tokio::test]
    async fn signed_correction_adjusts_an_already_counted_turn() {
        let (repo, _db) = setup().await;
        repo.add_usage(entry(DAY, "claude", "m", tokens(100, 0, 0, 0)))
            .await
            .unwrap();
        // The turn was re-reported at 150: apply the difference, no new turn.
        repo.add_usage(UsageEntry {
            turns: 0,
            ..entry(DAY, "claude", "m", tokens(50, 0, 0, 0))
        })
        .await
        .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].tokens, 150);
        assert_eq!(days[0].turns, 1);
    }

    #[tokio::test]
    async fn splits_by_day_and_folds_agents_and_models() {
        let (repo, _db) = setup().await;
        repo.add_usage(entry("2026-08-24", "claude", "sonnet", tokens(10, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry(DAY, "claude", "sonnet", tokens(20, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry(DAY, "codex", "gpt-x", tokens(5, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].day, "2026-08-24");
        assert_eq!(days[1].day, DAY);
        assert_eq!(days[1].tokens, 25);
        assert_eq!(days[1].turns, 2);
        assert_eq!(sorted(&days[1].by_backend), vec![("claude", 20), ("codex", 5)]);
        assert_eq!(sorted(&days[1].by_model), vec![("gpt-x", 5), ("sonnet", 20)]);
    }

    #[tokio::test]
    async fn unknown_model_counts_but_is_not_a_model_bucket() {
        let (repo, _db) = setup().await;
        repo.add_usage(entry(DAY, "opencode", "", tokens(42, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].tokens, 42);
        assert_eq!(days[0].by_backend, vec![("opencode".to_string(), 42)]);
        // '' is a storage detail of the primary key, never a displayed model.
        assert!(days[0].by_model.is_empty());
    }

    #[tokio::test]
    async fn empty_entry_writes_nothing() {
        let (repo, _db) = setup().await;
        repo.add_usage(UsageEntry {
            turns: 0,
            ..entry(DAY, "acp", "", tokens(0, 0, 0, 0))
        })
        .await
        .unwrap();

        assert!(repo.list_days(USER_A).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_turn_reporting_no_tokens_is_still_a_turn() {
        let (repo, _db) = setup().await;
        repo.add_usage(entry(DAY, "acp", "", tokens(0, 0, 0, 0))).await.unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].turns, 1);
        assert_eq!(days[0].tokens, 0);
    }

    #[tokio::test]
    async fn usage_is_scoped_by_user() {
        let (repo, _db) = setup().await;
        repo.add_usage(entry(DAY, "claude", "m", tokens(100, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(UsageEntry {
            user_id: USER_B,
            ..entry(DAY, "claude", "m", tokens(7, 0, 0, 0))
        })
        .await
        .unwrap();

        assert_eq!(repo.list_days(USER_A).await.unwrap()[0].tokens, 100);
        assert_eq!(repo.list_days(USER_B).await.unwrap()[0].tokens, 7);
    }

    #[tokio::test]
    async fn a_user_with_no_rows_lists_nothing_while_another_user_has_usage() {
        let (repo, _db) = setup().await;
        repo.add_usage(UsageEntry {
            user_id: USER_B,
            ..entry(DAY, "claude", "m", tokens(500, 0, 0, 0))
        })
        .await
        .unwrap();

        // Guards a WHERE clause that stops filtering (or filters on the wrong
        // bind): a brand-new user would then be shown someone else's spend.
        assert!(repo.list_days(USER_A).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn each_component_accumulates_into_its_own_column() {
        let (repo, db) = setup().await;
        // A copy-paste slip in the ON CONFLICT SET list (e.g.
        // `cache_read_tokens = cache_read_tokens + excluded.cache_write_tokens`)
        // leaves `tokens` perfectly correct and corrupts only the breakdown, so
        // no assertion on the day total can catch it. Distinct values per
        // column, read back raw, can.
        let first = TurnTokens {
            input_tokens: 2,
            output_tokens: 3,
            cache_read_tokens: 5,
            cache_write_tokens: 7,
            other_tokens: 11,
        };
        let second = TurnTokens {
            input_tokens: 100,
            output_tokens: 200,
            cache_read_tokens: 400,
            cache_write_tokens: 800,
            other_tokens: 1600,
        };
        repo.add_usage(entry(DAY, "claude", "m", first)).await.unwrap();
        repo.add_usage(entry(DAY, "claude", "m", second)).await.unwrap();

        let row = sqlx::query(
            "SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, other_tokens, tokens \
             FROM usage_ledger_days WHERE user_id = ? AND day = ?",
        )
        .bind(USER_A)
        .bind(DAY)
        .fetch_one(db.pool())
        .await
        .unwrap();

        let stored: (i64, i64, i64, i64, i64, i64) = (
            row.get("input_tokens"),
            row.get("output_tokens"),
            row.get("cache_read_tokens"),
            row.get("cache_write_tokens"),
            row.get("other_tokens"),
            row.get("tokens"),
        );
        assert_eq!(stored, (102, 203, 405, 807, 1611, 3128));
    }

    #[tokio::test]
    async fn other_tokens_count_toward_the_stored_total() {
        let (repo, _db) = setup().await;
        // ACP reports a turn total with no breakdown. If `other_tokens` were
        // left out of `total()`, every ACP turn would read as zero spend while
        // still counting as a turn.
        repo.add_usage(entry(DAY, "acp", "", TurnTokens::unattributed(777)))
            .await
            .unwrap();

        assert_eq!(repo.list_days(USER_A).await.unwrap()[0].tokens, 777);
    }

    #[tokio::test]
    async fn a_correction_bigger_than_the_recorded_total_drives_the_day_negative() {
        let (repo, _db) = setup().await;
        repo.add_usage(entry(DAY, "claude", "m", tokens(100, 0, 0, 0)))
            .await
            .unwrap();
        // The backend revised the turn down from 100 to -50 worth of work
        // (an over-report being undone). A clamp, an unsigned column, or a
        // `MAX(0, …)` in the upsert would swallow the credit and leave the
        // user's day permanently inflated.
        repo.add_usage(UsageEntry {
            turns: 0,
            ..entry(DAY, "claude", "m", tokens(-150, 0, 0, 0))
        })
        .await
        .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].tokens, -50);
        assert_eq!(days[0].turns, 1);
    }

    #[tokio::test]
    async fn a_token_count_beyond_32_bits_survives_the_round_trip() {
        let (repo, _db) = setup().await;
        // Guards a narrowing bind or a column read as i32: cache-heavy usage
        // passes 4 billion tokens within a day, and truncation would show a
        // nonsense (often negative) figure rather than an obvious failure.
        repo.add_usage(entry(DAY, "claude", "m", TurnTokens::unattributed(i64::MAX)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].tokens, i64::MAX);
        assert_eq!(sorted(&days[0].by_model), vec![("m", i64::MAX)]);
    }

    #[tokio::test]
    async fn days_come_back_ascending_regardless_of_write_order() {
        let (repo, _db) = setup().await;
        // Writes arrive in whatever order turns happen — including a late
        // correction to yesterday. The fold only merges into the LAST bucket,
        // so if the ORDER BY were dropped the same day would split into two
        // entries and the heatmap would double-plot it. The year boundary also
        // checks the sort is on the date string, not on insertion order.
        repo.add_usage(entry("2026-01-02", "claude", "m", tokens(5, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry("2025-12-31", "claude", "m", tokens(7, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry("2026-01-02", "codex", "m2", tokens(3, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!(
            days.iter().map(|d| (d.day.as_str(), d.tokens)).collect::<Vec<_>>(),
            vec![("2025-12-31", 7), ("2026-01-02", 8)]
        );
    }

    #[tokio::test]
    async fn one_model_shared_by_two_agents_is_a_single_model_bucket() {
        let (repo, _db) = setup().await;
        // Two rows, one model. `accumulate` must find and add to the existing
        // entry; pushing blindly would emit a duplicate key that the consumer's
        // object fold silently collapses to whichever came last, losing tokens.
        repo.add_usage(entry(DAY, "claude", "shared-m", tokens(10, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry(DAY, "codex", "shared-m", tokens(4, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(sorted(&days[0].by_model), vec![("shared-m", 14)]);
        assert_eq!(sorted(&days[0].by_backend), vec![("claude", 10), ("codex", 4)]);
    }

    #[tokio::test]
    async fn one_agent_using_two_models_is_a_single_backend_bucket() {
        let (repo, _db) = setup().await;
        // The mirror image: switching model mid-day must not split the agent.
        repo.add_usage(entry(DAY, "claude", "sonnet", tokens(10, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry(DAY, "claude", "opus", tokens(4, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(sorted(&days[0].by_backend), vec![("claude", 14)]);
        assert_eq!(sorted(&days[0].by_model), vec![("opus", 4), ("sonnet", 10)]);
    }

    #[tokio::test]
    async fn a_day_with_many_agent_model_rows_folds_into_one_entry() {
        let (repo, _db) = setup().await;
        // A real day mixes several agents and models. Six rows must still fold
        // into one day, or the profile page renders the same date repeatedly.
        for agent in ["claude", "codex", "opencode"] {
            for model in ["a", "b"] {
                repo.add_usage(entry(DAY, agent, model, tokens(10, 0, 0, 0)))
                    .await
                    .unwrap();
            }
        }

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!((days[0].tokens, days[0].turns), (60, 6));
        assert_eq!(days[0].by_backend.len(), 3);
        assert_eq!(days[0].by_model.len(), 2);
    }

    #[tokio::test]
    async fn an_unknown_model_and_a_named_one_share_the_day_but_not_the_bucket() {
        let (repo, _db) = setup().await;
        // '' is the placeholder that keeps the primary key working. Its tokens
        // must still reach the day total and the agent breakdown while staying
        // out of the model breakdown — dropping them from the total instead
        // would under-report every backend that omits its model id.
        repo.add_usage(entry(DAY, "acp", "", tokens(42, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry(DAY, "acp", "m", tokens(8, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].tokens, 50);
        assert_eq!(sorted(&days[0].by_backend), vec![("acp", 50)]);
        assert_eq!(sorted(&days[0].by_model), vec![("m", 8)]);
    }

    #[tokio::test]
    async fn non_ascii_agent_and_model_ids_round_trip_intact() {
        let (repo, _db) = setup().await;
        // Model ids come straight from a provider and are not guaranteed
        // ASCII. A byte-truncating bind would either corrupt the id shown in
        // the breakdown or make the primary key stop matching, so every turn
        // would insert a fresh row instead of accumulating.
        repo.add_usage(entry(DAY, "克劳德", "модель-α🚀", tokens(3, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry(DAY, "克劳德", "модель-α🚀", tokens(4, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(days[0].turns, 2);
        assert_eq!(sorted(&days[0].by_model), vec![("модель-α🚀", 7)]);
    }

    #[tokio::test]
    async fn model_ids_differing_only_in_case_stay_separate() {
        let (repo, _db) = setup().await;
        // Model ids are case-sensitive identifiers. A COLLATE NOCASE creeping
        // into the primary key would merge two genuinely different deployments
        // into one line of the breakdown.
        repo.add_usage(entry(DAY, "claude", "Model-X", tokens(10, 0, 0, 0)))
            .await
            .unwrap();
        repo.add_usage(entry(DAY, "claude", "model-x", tokens(1, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(sorted(&days[0].by_model), vec![("Model-X", 10), ("model-x", 1)]);
    }

    #[tokio::test]
    async fn a_very_long_agent_id_is_stored_whole() {
        let (repo, _db) = setup().await;
        // TEXT has no declared length here, but a future column type change
        // (or a bind that pre-truncates) would silently merge distinct custom
        // agent ids that share a long prefix.
        let long_kind = "custom-agent-".repeat(80);
        repo.add_usage(entry(DAY, &long_kind, "m", tokens(9, 0, 0, 0)))
            .await
            .unwrap();

        let days = repo.list_days(USER_A).await.unwrap();
        assert_eq!(sorted(&days[0].by_backend), vec![(long_kind.as_str(), 9)]);
    }
}
