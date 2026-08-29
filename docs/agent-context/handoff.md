# Handoff — v2.2.7 shipped and verified; installer diagnostics remain the open work

Repo state: branch `main`, clean, version `2.2.7`, head `9676e52`. Tag `v2.2.7`
is published and verified. Website repo `.workspaces/fluffy-lamp` is at
`1d9462c`, deployed.

Everything below the "Still open" line is unproven. Everything above it has a
cited commit or a recorded result.

## Current objective

The releases are done. The largest remaining item is the installer diagnostics
work that is still only partly built (see "Still open"). The user's standing
request is to be told when a release publishes.

## What shipped in 2.2.6 and 2.2.7

Details are in `CHANGELOG.md` and the decisions in `architecture-record.md`.

- **2.2.6** — MCP failures report the engine's real reason; the agent stops
  leaking pre-rebrand names; Kiro is probed by its cross-platform `kiro-cli`
  binary (migration 041).
- **2.2.7** — an install that cannot fit on disk is refused up front (E1020,
  which had been declared and never raised); the desktop shortcut survives an
  update; the Linux menu entry is filed under Office as well as Utility with its
  package dependencies declared.

Both verified after publishing: 27 assets on each repo, mirror `latest.yml`
serving the version, installer links returning 206.

**2.2.7 was additionally verified by installing it**, not just by CI going
green. The desktop-shortcut fix was exercised on the official artifact in both
directions — present and left untouched, deleted and restored — with the
installer's own log recording each decision. The app and engine were healthy
afterwards (`/health` 200).

## Website — three live fixes, one of them mine to begin with

- **I broke Google sign-in.** The CSP shipped in `b2d8e76` blocked
  `accounts.google.com/gsi/client`, taking sign-in down on the website _and_ the
  desktop app, which opens `/login` in a browser. Fixed in `1d9462c`. The cause
  was method: origins were enumerated on one page and the policy applied to all 48. See the CSP decision in the architecture record before touching that file.
- macOS install command: `ditto` instead of `cp -R`, icon-cache refresh, and
  `lsregister`/`mdimport` so the app actually appears in Launchpad and Spotlight.
- Layout: the command blocks and the hero animation no longer overflow on mobile.

## Process failures worth not repeating

These cost real time and, once, a production outage:

- **Auditing one page and generalising to the whole site.** That is what broke
  sign-in. A site-wide policy needs site-wide validation, behavioural not static
  — the Firebase SDK builds its endpoints at runtime, so grep cannot see them.
- **`cargo test -p <crate> --bins` does not build `tests/` integration targets.**
  CI runs `cargo test --workspace`. This failed three release cycles in a row.
- **`cargo test` stops at the first failing binary**, so one reported failure can
  hide others.
- **Piping a build or test into `grep`/`tail` discards its exit code.** A failed
  `just push` and a failed workspace compile both reported success this way.
- **Grep the whole workspace for call sites** when changing a shared signature.

## Environment traps

- **`cargo test --workspace` does not fit on D:.** Measured: 14.7 GB against
  ~12 GB free; it filled the disk and died at link. Run per-crate suites locally
  and let CI's engine preflight be the gate. `cargo clean` after any engine work.
- **A local Windows build ships a stale engine.** `resources/bundled-paviicore/`
  is staged, not built on demand; when it predates a migration the app hits the
  downgrade guard and will not start. Refresh it before packaging locally, and
  reinstall the official build afterwards.
- **NSIS installers re-launch themselves**, so `-Wait` returns early on the
  update path. Poll until no installer process remains before asserting anything.
- Six `aionui-extension` tests fail locally on Windows (one is
  `#[cfg(target_os = "windows")]`, the rest need `/bin/sh` or symlinks).
  Pre-existing; they pass in CI.
- Migration files are checksum-pinned — a new one needs an entry in
  `tests/fixtures/migration-checksums.json`; never edit an existing entry.
- **Never** `git add -A` in `.workspaces/fluffy-lamp`: `src/pages/privacy.astro`
  and the Privacy line in `src/utils/navigation.ts` are deliberately parked.

## Still open — nothing below is proven

1. **Installer diagnostics, partly built.** E1020 and the shortcut fix landed.
   Still missing: extraction-path JSONL logging, stop-between-retries, real
   diagnostics on failure, and restore-cleanup on the update path (the
   `${isUpdated}` skip). `docs/contributing/install-checklist.md` lists the
   remaining gaps.
2. **Four error codes are declared but never raised** — E1050, E1060, E1070,
   E1090. Same dead-code class as E1020, which sat unused for months.
3. **AppImage has no desktop integration at all** and its FUSE requirement is
   undocumented.
4. **macOS and Linux have no install-time failure detection** — no `.pkg`, no deb
   maintainer scripts. Everything surfaces at first launch instead.
5. **macOS signing/notarization** — needs a $99 Apple account. Until then the
   published builds are ad-hoc signed only, which is why the install command must
   re-sign.
6. **Kiro end-to-end** — detection and the ACP handshake are verified; no real
   conversation has been run through it.
7. **Memory integration** (OpenViking / TencentDB-Agent-Memory), Phase 1 planned.

## Suggested skills

- `testing` — before any runtime change; it carries the rule that a green result
  on inputs that do not exercise the behaviour proves nothing.
- `architecture-recorder` — after the installer diagnostics land.
- `bump-version` — for the next release.
- `i18n` — any user-facing string change; missing keys are a hard blocker.

## Related context documents

- `docs/agent-context/architecture-record.md` — decisions and durable traps
- `docs/contributing/install-checklist.md` — per-platform install coverage and
  the pre-release checks
- `docs/agent-context/privacy-audit.md` — every outbound call
- `AGENTS.md` — standing rules: never guess a CLI's behaviour, verify claims in
  code before asserting them, `just push` rather than `git push`
