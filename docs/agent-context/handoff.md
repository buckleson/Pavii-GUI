# Handoff — PostHog analytics, categorised skills, and a broken local build

Shipped in `v2.1.59` (merged as `8efc67c`); the repo has since moved to `v2.1.64`
on top of it. Read
[`docs/agent-context/architecture-record.md`](architecture-record.md) — the two
new decisions are "PostHog analytics is always on…" and "Skills page is one
categorised page…" — and
[`docs/agent-context/privacy-audit.md`](privacy-audit.md), which now records the
reversal of this project's telemetry-free posture.

## Where things stand

**PostHog product analytics**, renderer (`posthog-js`) + main (`posthog-node`),
sharing the per-install UUID from `getOrCreateAnalyticsId()` via a new
`ipcBridge.application.analyticsId` channel. Always on, no user-facing toggle —
an explicit product-owner decision, made after being shown the GDPR and
privacy-audit tension. `POSTHOG_DISABLED=1` is a build-time control only.

Eight events, all with real call sites: `app_opened`, `app_closed`,
`backend_start_failed`, `provider_configured`, `conversation_started`,
`message_sent`, `turn_completed`, `mcp_connected`, plus a manual `$pageview`.

**`scrubEvent` (`common/analytics/scrub.ts`) is the whole privacy guarantee.**
Everything else is defence in depth. It rewrites the URL keys in `properties`,
`$set` **and** `$set_once`, drops non-allowlisted property keys, and redacts
API-key shapes, absolute paths, emails and over-long values. It fails **closed** —
any throw returns `null` and the event is dropped.
`tests/unit/analytics/scrub.test.ts` is the proof: a hostile event carrying a
`file://` install path, an `sk-ant-` key, a Windows path, a 3000-char prompt and
an email must survive with none of those substrings in the JSON.

**Skills page** is now one categorised page (Official → Extension →
Auto-injected → user imports), grouped by a curated name→category map in
`renderer/pages/settings/SkillsSettings/skillCategories.ts`. Plus 62 curated
MIT-licensed ECC skills under `resources/bundled-skills/ecc/`, tagged official
through `BUNDLED_SKILL_NAMES`.

## Traps worth knowing

- **`ph-no-capture` on an ancestor kills the whole autocapture event**, not just
  its text. The marker on `SettingsPageWrapper` therefore makes every settings
  screen invisible to autocapture by design — instrument those with `track()`,
  never `data-ph-capture`.
- **Autocapture is an allowlist** (`css_selector_allowlist: ['[data-ph-capture]']`)
  with `mask_all_text` + `mask_all_element_attributes`. Do not relax that to a
  denylist: this DOM is the user's prompts, file paths and API keys, and a
  denylist fails open the first time someone adds a screen and forgets a marker.
- **A declared-but-unwired event is worse than a missing one** — the chart
  renders empty and reads as "nobody uses this feature".
  `tests/unit/analytics/eventCoverage.test.ts` fails the build on either
  direction of drift. Six of thirteen events were unwired before it existed.
- **Verify posthog-js option names against the installed
  `@posthog/types`, not the docs.** The docs pages were repeatedly truncated and
  incomplete; the package types are authoritative. `sanitize_properties` is
  `@deprecated` and logs an error — use `before_send`.
- **Do not write these context docs with `node -e "…"` in double quotes.** Bash
  expands `$current_url`, `$set_once` etc. to empty and silently corrupts the
  prose. That happened to the architecture record in this session and had to be
  repaired. Use the Edit/Write tools.

## Open, in priority order

### 0. OpenCode now ships in the installer — untested as a real installer

`d102583` + `0ab601a` + `d0efbb6` are on `main`, **untagged on purpose**: no
release build exists yet and the user tests locally first.

- The binary is staged at build time by
  `packages/shared-scripts/src/prepare-opencode.js` (version pinned there;
  bumping OpenCode means editing `OPENCODE_VERSION` and cutting a release) and
  put on PATH by `registerOpencodeOnPath` in the **pre-spawn** block of
  `packages/desktop/src/index.ts`. Pre-spawn is the whole point — the engine
  snapshots PATH when it starts, so registering later only works next launch.
- Proven by A/B with the developer's own OpenCode hidden from PATH:
  `available=5` and no OpenCode row in `/api/assistants` without the bundle;
  `available=6` with the row present with it.
- Installer grows ~50-80 MB compressed per platform. The **actual** installer
  size has never been measured — only the staged payload (172 MB). Run
  `bun run build-win:x64` before promising anyone a number.
- Gap: `packages/web-host/src/backend-launcher.ts` has no managed-tools or
  OpenCode handling at all, so the web-cli/web-host distribution still only
  gets OpenCode if the user already has it. Untouched by this work.
- Live telemetry baseline for judging the change: `message_sent` by
  `agent_kind` currently shows only `aionrs`. If bundling worked, `opencode`
  should appear after the first release.

### 1. CRLF migrations — PREVENTED in `7886917`; only the cure is left

Prevention is done and verified. Remaining optional work is the **self-heal**
described at the end of this section, which is the only thing that helps a
database that is _already_ broken. No released user is in that state — every
release was CI-built, so every shipped database carries LF checksums — so this
is defence, not a live incident.

Landed in `7886917`:

- `.gitattributes` pins `*.sql -text`, so no checkout can diverge again
- `tests/unit/bootstrap/migrationChecksums.test.ts` pins all 39 SHA-384s and
  asserts no CRLF plus byte-equality with `HEAD`
- `scripts/build-with-builder.js` refuses to package a divergent working tree

Both guards were verified by injecting CRLF into a migration and confirming each
failed by filename. The dev machine's working tree was renormalised to LF and
the local engine rebuilt (`c21a9773`), so local and CI builds now agree.

The original symptom, for recognition:

```
BOOTSTRAP_DATA_INIT_FAILED stage="database.migration"
error=Migration failed: migration 1 was previously applied but has been modified
error=Migration failed: migration 38 was previously applied but is missing in the resolved migrations
```

**Root cause: line endings, not the engine and not data corruption.**
`sqlx::migrate!()` checksums the raw bytes of each `.sql` file. The working tree
on the dev machine has **CRLF**; git stores **LF** (`.gitattributes:2` —
`* text=auto eol=lf`). So the same SQL compiles to two different checksum sets:

```
001_initial_schema.sql
  working tree : 24850 bytes, 574 CRLF, sha384 d4dd4415…
  git blob     : 24276 bytes,   0 CRLF, sha384 e18a4394…
```

Measured against a real user DB: **39/39 stored checksums matched the CRLF
working tree, 0/39 matched the git blob.** A DB created by a local build is
therefore rejected by every CI release, and vice versa. This is not specific to
any version.

Immediate repair for an affected DB (verified: the failing CI engine reached
`AIONCORE_READY` on a repaired copy) — back up first, then rewrite
`_sqlx_migrations.checksum` for each version to the SHA-384 of
`git show HEAD:<migration path>`. The SQL is byte-identical apart from line
endings, so this corrects a fingerprint rather than asserting false history.

The real fix has a trap: renormalising the working tree to LF makes local builds
agree with CI, but instantly breaks every existing DB created by a local build.
Better is a startup path that detects a **line-ending-only** checksum mismatch —
same content once `\r\n` is normalised — and self-heals the stored checksum
instead of refusing to boot. Consider `.gitattributes` marking
`*.sql binary`/`-text` so the bytes can never diverge again.

**Superseded theory, recorded so nobody re-runs it:** this was first diagnosed as
`preparePaviicore` packaging the wrong engine. That was wrong. The engine in
`resources/` (sha256 `c5bacd5e…`) and the CI engine (`D3FE704C…`) are both
legitimately built from vendored source; they simply compiled different bytes of
the same migrations. Do not start in
`packages/shared-scripts/src/prepare-paviicore.js`.

### 2. `ci.yml` is red and has been for every recent run

Fixed this session: gitignored brand icons (`resources/app.png` is the Linux icon
_and_ asserted by tests), stale `officecli` expectations in `office_e2e.rs`, and
Windows drive letters in `ensureOpencode` PATH fixtures (`:` is the PATH
delimiter on Linux).

**Still failing: 9 `check_update` tests in `crates/aionui-system/tests/system_info_routes.rs`,
all returning 502 instead of 200** against a local wiremock. Not investigated.
Until that is fixed, do **not** enable "require status checks" in branch
protection — it would block every merge.

### 3. Branch protection is not set

`main` has none. Requires the `buckleson` account; `vjk7989` has push but not
admin. Enable force-push and deletion protection now; add required checks only
after #2.

### 4. Analytics — DONE live; one attribution gap left

Superseded by an audit against real production data. Events **are** flowing
(project 249810, EU). 400 live events were scanned across every property for
`file://` URLs, Windows paths, home directories, emails, and credential-shaped
strings: **zero hits**. `$current_url` arrives already normalised
(`app://pavii/conversation/:id`), so `normaliseRoute` demonstrably runs before
send. `token` and `distinct_id` show up in stored properties only because
PostHog's ingestion echoes them back; `token` is the public `phc_` write key.

Dashboards exist: "Pavii.Ai — Product Health" (912262, 7 tiles) and
"Pavii.Ai — Activation & Usage" (912263, 7 tiles). Creating more needs a
personal API key (`phx_…`); the `phc_` key is write-only.

Still open: `backend_start_failed` arrives with `app_version`, `version`, and
`platform` **null**, because the main-process client registers no super
properties. A start failure therefore cannot be pinned to a release — worth
fixing before the next incident. All five recorded failures are
`backend_data_migration_failed` on 21-22 Aug 2026, before the CRLF fix shipped;
none since.

Still worth doing by hand once installed: send a message containing a
distinctive string and type a fake key into Models settings, then confirm
neither reaches PostHog. Alert on `$scrub_secret_hit` / `$scrub_path_hit` — if
either fires, something upstream is handing the scrub sensitive data and should
be fixed at the source.

### 5. No privacy policy

The marketing site (`.workspaces/fluffy-lamp`) has none, and there is no in-app
disclosure. Always-on capture to an EU endpoint without either is the gap a user
or regulator would point at first.

## Standing constraints

- Installer size is dominated by bundled agent CLIs (`codex.exe` 325 MB,
  `claude.exe` 244 MB). `resources/bundled-paviicore/win32-x64/data/` (105 MB,
  mostly a duplicate Node runtime) is declared in neither `manifest.json` nor the
  afterPack verifier but ships anyway, because `electron-builder.yml:111` copies
  the whole directory.
- `just` is **not installed** on this machine. The `push` recipe is
  `lint-strict fmt-check typecheck encoding-check language-check test` then
  `git push` — run those by hand.
- `bun run lint:fix` sweeps unrelated files repo-wide (`.sort()`→`.toSorted()`,
  array→`Set`, error `cause`). Revert them before committing, or the diff stops
  being about your change.
