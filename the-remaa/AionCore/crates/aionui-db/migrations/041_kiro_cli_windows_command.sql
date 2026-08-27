-- Migration 041: probe Kiro by its cross-platform `kiro-cli` binary.
--
-- Migration 003 moved Kiro (e044000d) from the never-existent `kiro` to
-- `kiro-cli-chat`, reading the Unix installer (`curl -fsSL
-- https://cli.kiro.dev/install | bash`), which lays down `kiro-cli`,
-- `kiro-cli-chat` and `kiro-cli-term`. That name does not exist on Windows.
--
-- The Windows install directory (`%LOCALAPPDATA%\Kiro-Cli\`) contains exactly
-- one CLI executable, `kiro-cli.exe`, and it *is* the chat binary: running
-- `kiro-cli.exe --version` prints `kiro-cli-chat 2.20.0`. Availability
-- detection resolves a single name against PATH with no alias fallback
-- (`aionui-runtime/src/resolver.rs` -> `resolve_command_path`), so every
-- Windows install reported Kiro as not installed even with a working CLI.
--
-- `kiro-cli` is the name that exists on both platforms, so it replaces
-- `kiro-cli-chat` rather than being added beside it. `acp` stays the entry
-- point: `kiro-cli acp --help` reports "Start Agent Client Protocol (ACP)
-- agent" (the subcommand is hidden from the top-level help but present), and
-- kiro.dev/docs/cli/acp documents `kiro-cli acp` as the command every ACP
-- client spawns. The 003 rationale for choosing the chat binary -- that it
-- serves ACP without a prior `kiro-cli login`, so an unauthenticated user
-- still gets a proper `initialize` with the login `authMethod` -- is
-- preserved, because on Windows this is the same executable.
--
-- `command_override` is a separate column and is left untouched, so anyone who
-- already pointed Kiro at a path through the repair panel keeps it. Idempotent:
-- only rewrites rows still carrying a superseded name. Matched by backend
-- rather than id, following 039: 030 split the surrogate `id` from the logical
-- `agent_id`, and backend is the identity that survives that split.
UPDATE agent_metadata SET
    command           = 'kiro-cli',
    agent_source_info = json_set(COALESCE(agent_source_info, '{}'), '$.binary_name', 'kiro-cli'),
    updated_at        = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE agent_source = 'builtin'
  AND backend = 'kiro'
  AND command IN ('kiro', 'kiro-cli-chat');

-- Drop the availability verdict this rename invalidates.
--
-- Without this the rename has no visible effect on an install that already
-- checked Kiro. The agent list reads the cached projection, where
-- `cached_snapshot_indicates_missing` treats a stored `command_not_found` as
-- still-missing, and `overlay_hydrated_availability` refuses to overlay the
-- fresh startup probe onto a row that carries any snapshot at all -- so the
-- row stays "not installed" no matter what is on PATH. Only a manual health
-- check clears it, which is exactly the button that appeared broken.
--
-- Every snapshot column is cleared because `has_availability_snapshot` ORs all
-- six, including `last_success_at`/`last_failure_at`; leaving one set would
-- keep the row pinned. Scoped to the one verdict this migration proves wrong:
-- a row whose last check failed for any other reason (auth, ACP handshake)
-- keeps its diagnosis, and Kiro simply returns to unchecked until probed.
UPDATE agent_metadata SET
    last_check_status        = NULL,
    last_check_kind          = NULL,
    last_check_error_code    = NULL,
    last_check_error_message = NULL,
    last_check_guidance      = NULL,
    last_check_latency_ms    = NULL,
    last_check_at            = NULL,
    last_success_at          = NULL,
    last_failure_at          = NULL,
    updated_at               = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE agent_source = 'builtin'
  AND backend = 'kiro'
  AND last_check_error_code = 'command_not_found';
