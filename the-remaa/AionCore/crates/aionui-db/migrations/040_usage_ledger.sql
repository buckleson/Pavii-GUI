-- Migration 040: per-day token usage ledger.
--
-- Before this table there was no durable record of token spend anywhere in the
-- engine. `acp_session.session_config.runtime.context_usage` holds only a
-- last-snapshot per conversation (replace semantics, see 001), which is the
-- current context occupancy — not a total — so lifetime or per-day figures
-- could not be reconstructed from it.
--
-- The desktop app therefore kept its own JSON ledger and accumulated the usage
-- frames the renderer happened to receive. That was wrong three ways, all of
-- which this table exists to fix:
--
--   * it only saw conversations the user had OPEN in the desktop window, so
--     scheduled tasks, channel (Telegram/Slack/Discord) turns and WebUI turns
--     were never counted at all;
--   * it summed values whose meaning differs per backend — codex and gemini-cli
--     report the whole context re-sent each turn, aionrs reports a
--     session-cumulative running total — so long sessions inflated superlinearly;
--   * usage frames are deliberately broadcast twice per turn (one relay
--     catch-all, one conversation-scoped), which is harmless for an indicator
--     that replaces but doubled a ledger that adds.
--
-- Recording here instead puts the write at the single point every surface
-- passes through, upstream of that duplicate broadcast.
--
-- Grain: one row per (user, local day, agent kind, model). Aggregated on write
-- rather than storing per-turn rows — the product need is "tokens per day",
-- and per-turn history would grow without bound for no current consumer.
--
-- `tokens` is the billing-comparable total: input + output + cache read +
-- cache write. Cache buckets are included deliberately; providers process and
-- bill them (at a reduced rate for reads), and excluding them under-reported
-- cache-heavy agent turns by orders of magnitude. The four component columns
-- are kept alongside so a future consumer can break the total down without a
-- schema change or a backfill.
--
-- `model` is '' rather than NULL when unknown, so it participates in the
-- primary key normally: SQLite treats every NULL as distinct in a UNIQUE
-- index, which would make the upsert insert a new row on every turn.
--
-- Counters are updated with signed adds (`tokens = tokens + excluded.tokens`),
-- which lets the recorder correct a turn it has already reported: a backend
-- that re-reports a turn with a larger figure is applied as the difference.
CREATE TABLE IF NOT EXISTS usage_ledger_days (
    user_id            TEXT    NOT NULL,
    -- Local calendar day, 'YYYY-MM-DD'. Local, not UTC, so the activity
    -- heatmap lines up with the days the user actually worked.
    day                TEXT    NOT NULL,
    -- Conversation `agent_type` (e.g. 'claude', 'codex', 'aionrs'), so usage
    -- joins against conversations without a translation table.
    agent_kind         TEXT    NOT NULL,
    model              TEXT    NOT NULL DEFAULT '',
    tokens             INTEGER NOT NULL DEFAULT 0,
    input_tokens       INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    -- Tokens a backend totalled for us without saying how they split. The ACP
    -- protocol reports an authoritative per-turn `total_tokens`, but does not
    -- specify whether its `input_tokens` already contains the cache buckets,
    -- and assuming either way would over- or under-count. The total is exact;
    -- only the breakdown is unknown, so it is booked here rather than
    -- attributed to a column that would then be wrong.
    other_tokens       INTEGER NOT NULL DEFAULT 0,
    turns              INTEGER NOT NULL DEFAULT 0,
    updated_at         INTEGER NOT NULL,
    PRIMARY KEY (user_id, day, agent_kind, model)
);

-- The only read pattern is "all days for one user", newest first.
CREATE INDEX IF NOT EXISTS idx_usage_ledger_days_user_day ON usage_ledger_days (user_id, day);
