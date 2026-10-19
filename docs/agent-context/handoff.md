# Handoff — v2.2.9 shipped; awaiting the user's next objective

Repo state: branch `main`, version `2.2.9`, head `fa1a8c4`. Tag `v2.2.9` is
published as Latest (Release, CI and Engine (Windows) workflows all green).
Website repo `.workspaces/fluffy-lamp` is at `8e1b92f`, deployed.

Everything below the "Still open" line is unproven. Everything above it has a
cited commit or a recorded result.

## Current objective

None in progress. The user will set the next task. Their standing request is to
be told when a release publishes.

## What shipped in 2.2.8 and 2.2.9

Details are in `CHANGELOG.md`; the decisions are in `architecture-record.md`.

- **2.2.8** (`e5d38ed`) — the builtin image-gen MCP server is no longer injected
  when no image provider resolves; Codex then uses its native image generation.
  The 2.2.8 windows-arm64 build failed on a transient prebuilt fetch, fixed in
  2.2.9.
- **2.2.9** (`fa1a8c4`, PR #3) — `pavii-context` auto-inject skill (the agent
  keeps `pavii-ard.md` / `pavii-hoff.md` per project); a language change now
  reaches the tray and main process; the native-module prebuilt fetch retries,
  and its fallback uses pinned `@electron/rebuild` 4.2.0.
- **Website** (`8e1b92f`) — the CSP now allows `apis.google.com`, which
  GitHub and SSO sign-in need. Verified on the live site for both GitHub/SSO
  and Google, with zero CSP violations.

The previous session was cut off by an account error ("organization has
disabled Claude subscription access") before it reported 2.2.9's asset
check. The release itself was confirmed published afterwards via
`gh release list`; the 27-asset and mirror `latest.yml` checks were **not**
re-run for 2.2.9.

## Process failures worth not repeating

- **Auditing one page or one provider and generalising.** The CSP broke sign-in
  twice that way: first Google, then GitHub/SSO. Validate every page type and
  every sign-in provider behaviourally.
- **`cargo test -p <crate> --bins` does not build `tests/` integration targets**;
  CI runs `cargo test --workspace`. `cargo test` also stops at the first failing
  binary.
- **Piping a build or test into `grep`/`tail` discards its exit code.**
- **Grep the whole workspace for call sites** when changing a shared signature.
- **Registering a handler on an HTTP-backed bridge method is silently inert**
  (see the IPC decision in the architecture record).

## Environment traps

- **`cargo test --workspace` does not fit on D:.** Run per-crate suites and let
  CI's engine preflight be the gate. `cargo clean` after engine work.
- **A local Windows build ships a stale engine** from
  `resources/bundled-paviicore/`; refresh it with `node scripts/build-paviicore.js`
  before packaging locally.
- **NSIS installers re-launch themselves**; poll until no installer process
  remains before asserting anything.
- Six `aionui-extension` tests fail locally on Windows; they pass in CI.
- Migration files are checksum-pinned (`tests/fixtures/migration-checksums.json`).
- **Never** `git add -A` in `.workspaces/fluffy-lamp`: `src/pages/privacy.astro`
  and the Privacy line in `src/utils/navigation.ts` are deliberately parked
  (still uncommitted).

## Still open — nothing below is proven

1. **2.2.9 post-publish asset check** — 27 assets on both repos, mirror
   `latest.yml` serving 2.2.9, windows-arm64 installer present.
2. **Installer diagnostics, partly built** — extraction-path JSONL logging,
   stop-between-retries, real diagnostics on failure, restore-cleanup on the
   update path. See `docs/contributing/install-checklist.md`.
3. **Four error codes declared but never raised** — E1050, E1060, E1070, E1090.
4. **AppImage has no desktop integration**; its FUSE requirement is undocumented.
5. **macOS and Linux have no install-time failure detection.**
6. **macOS signing/notarization** needs a paid Apple developer account; builds
   are ad-hoc signed, so the install command must re-sign.
7. **Kiro end-to-end** — no real conversation has been run through it.
8. **Gemini image generation** — requested; no Gemini-specific commit exists.
   Whether the existing image-provider config already covers it is Unknown.
9. **Memory integration** (OpenViking / TencentDB-Agent-Memory), Phase 1 planned.

## Suggested skills

- `testing` — before any runtime change.
- `architecture-recorder` — after material changes land.
- `bump-version` — for the next release.
- `i18n` — any user-facing string change.

## Related context documents

- `docs/agent-context/architecture-record.md` — decisions and durable traps
- `docs/contributing/install-checklist.md` — per-platform install coverage
- `docs/agent-context/privacy-audit.md` — every outbound call
- `AGENTS.md` — standing rules
