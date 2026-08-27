# Handoff — v2.2.5 is in the release pipeline; installer diagnostics are the next real work

Repo state at handoff: branch `main`, clean, version `2.2.5`
(`package.json`), head `ec2c4d3`. Tag `v2.2.5` points at `ec2c4d3` and run
[33110027724](https://github.com/buckleson/Pavii-GUI/actions/runs/33110027724)
is building it. Releases v2.2.0 through v2.2.4 are published and verified.

Everything below the "Still open" line is unproven. Everything above it has a
cited commit or a recorded test result.

## Current objective

Ship v2.2.5, then implement the installer diagnostics that were planned but
never built (see "Still open"). The user's standing request is to be told when
a release publishes.

## What shipped in 2.2.0 – 2.2.5

Details live in `CHANGELOG.md` and in the decisions added to
`docs/agent-context/architecture-record.md`; this is only the map.

**Features.** Per-day token usage ledger recorded by the engine, once per turn,
whatever drove it, served from `/api/usage/ledger`. Profile page with activity
heatmap and a canvas share card. Provider logos and a free-model catalogue.
Inline media in chat: images render without a click, files get an
electric-violet "Click here" that opens Explorer with the file selected, and
both carry a copy-path button with a toast. Issue reporting files into Supabase.
`token-optimizer` auto-injects into every CLI. New chats default to OpenCode.
About page carries real brand marks and the analytics disclosure.

**The recurring problem areas** — these are where time actually went, and where
the next agent should expect trouble:

1. **Release pipeline.** Quota exhaustion on workflow artifacts forced a move to
   draft-release assets. Publish gates then failed because they keyed on the tag
   rather than the built version (`ARTIFACT_V`, read from `latest.yml`). The
   mirror upload needed a retry loop with a count check. All fixed and proven by
   an rc dry-run.
2. **Updater.** The feed pointed at a private repo, so every check 404'd — now
   reads the public mirror (`4330784`).
3. **Installer.** A user's machine ended up with three broken installs and a
   registry entry pointing at nothing (E1003 → E1010). Updates are now
   transactional with rollback and a foreign-install guard (`2c636e4`).
4. **The rebrand's long tail.** The display-layer choke point brands what the UI
   renders but not prose the agent writes. Fixed at source with `PAVII_*` env
   aliases, rewritten skill instructions, and a guard (`282b3b6`, `bd9d24e`).
5. **Agent/CLI detection.** Kiro was probed under a Unix-only binary name, so it
   read "not installed" on every Windows machine (`b0ee834`).
6. **Encoding.** Two shipped regressions came from PowerShell text cmdlets.
   `bun run check:encoding` now gates it. **Never** use `Set-Content`,
   `Out-File`, or `>` on repo files.

## Process failures worth not repeating

These cost three release cycles this week and are all preventable:

- **v2.2.4 failed twice, v2.2.5 once, all from too-narrow local test runs.**
  `cargo test -p aionui-app --bins` does not build the integration targets under
  `tests/`. CI runs `cargo test --workspace`. A change to shared output or
  shipped asset text must be checked against the workspace suite before tagging.
- **`cargo test` stops at the first failing binary**, so CI reporting one failure
  can be hiding a dozen. After the capabilities test failed, four more targets
  had stale assertions that had never run.
- **Piping a command into `grep`/`tail` discards its exit code.** A failed
  `just push` and a failed workspace compile both reported success this way.
  Redirect to a file and check `$?`.
- **When changing a shared function signature, grep the whole workspace for call
  sites.** A missed one in `aionui-team` broke a release build.

## Environment traps

- **Disk is the top cause of engine build failures on this machine, and
  `cargo test --workspace` no longer fits on D: at all.** Measured 2026-08-28: it
  grew `target/` to 14.7 GB, took the drive to 0 bytes free, and still died with
  `fatal error LNK1180: insufficient disk space to complete link`. The other two
  faces of the same cause are `E0786 found invalid metadata files` (truncated
  `.rmeta`) and a rustc crash (`STATUS_STACK_BUFFER_OVERRUN` / `0xc0000409`).
  None is a source defect; `cargo clean` clears all three. **Run per-crate suites
  locally (`cargo test -p <crate>` — these fit) and treat CI's engine preflight as
  the authoritative workspace gate;** it runs the same command with adequate disk.
  Check free space before starting any engine build, and `cargo clean` after.
- Any engine build in the foreground will time out — background it.
- Six `aionui-extension` tests fail locally on Windows (one is
  `#[cfg(target_os = "windows")]`, the rest need `/bin/sh` or symlink privileges).
  Pre-existing; they pass in CI.
- Migration files are checksum-pinned. A new one needs an entry in
  `tests/fixtures/migration-checksums.json`. Never edit an existing entry.
  Do not edit a migration while `cargo test` is compiling — you get a confusing
  `VersionMismatch(N)` that is your own edit, not a defect.

## Still open — nothing below is proven

1. **Installer diagnostics (planned, not implemented).** Extraction-path JSONL
   logging, stop-between-retries, real diagnostics on failure, a free-space gate
   (`E1020` is defined but unused; needs ~3.6 GB), truthful message text, and
   restore-cleanup on the update path — the `${isUpdated}` skip currently removes
   cleanup entirely. Plus regression smokes.
2. **Triage the friend's failed install.** Need `%TEMP%\aionui-installer-2.2.3-*-log.jsonl`
   and their free disk space. Not yet requested from them.
3. **macOS signing/notarization.** Offered; needs a $99 Apple Developer account
   the user has not set up. Unsigned installs currently need a manual override.
4. **Memory integration** (OpenViking / TencentDB-Agent-Memory). Phase 1 planned,
   deferred behind the releases.
5. **Kiro end-to-end.** The detection fix is unit-tested and the binary was probed
   directly, but Kiro has not been run through a real conversation. It also needs
   `kiro-cli login` — detection and auth are separate.

## Next steps, in dependency order

1. Watch run 33110027724. On success verify exactly as for 2.2.4:
   `gh release view` on both `buckleson/Pavii-GUI` and `buckleson/Pavii-Gui-Releases`
   (expect tag `v2.2.5`, 27 assets each), `curl` the mirror's `latest.yml` for
   `version: 2.2.5`, HTTP-check the stable installer links. Then tell the user.
2. Have the user update and confirm Kiro shows as detected.
3. Implement the installer diagnostics (item 1 above) — the largest open item.
4. Request the friend's installer log and triage.

## Suggested skills

- `testing` — before any runtime change; it carries the boundary/failure-case
  checklist and the rule that a green result on inputs that don't exercise the
  behaviour proves nothing.
- `architecture-recorder` — after the installer diagnostics land.
- `bump-version` — for the next release.
- `i18n` — if any user-facing string changes; new text without keys is a
  hard blocker.

## Related context documents

- `docs/agent-context/architecture-record.md` — decisions and the traps above in
  durable form
- `docs/agent-context/privacy-audit.md` — every outbound call
- `CHANGELOG.md` — user-facing history per version
- `AGENTS.md` — the standing rules (never guess a CLI's behaviour; verify claims
  in code before asserting them; `just push`, never `git push`)
