# Handoff — install and hand-test the Windows build, then cut the release

Next session's focus: **the user installs the packaged Windows x64 build of
`v2.1.66` and hand-tests it — slash commands and OpenCode bundling above all —
then the release is cut via version bump + tag.** Everything the release
depends on is merged to `main`; nothing is on a feature branch.

Repo state at handoff: branch `main`, working tree clean, version `2.1.66`
(`package.json`). Head is `83734d0`.

## Fact correction — the engine tree IS tracked in this repo

Earlier handoffs (and the `83734d0` commit message itself, which says "not
tracked here") state that the vendored engine tree is untracked. **That is
wrong.** `.gitignore:270-273` ignores `the-remaa/*` but re-includes
`!the-remaa/AionCore/`, excluding only its `target/` and `node_modules/`.
Verified: `git ls-files the-remaa/AionCore` lists 1293 files, and the
`83734d0` diffstat itself contains the engine source changes
(`the-remaa/AionCore/crates/aionui-ai-agent/...`, `aionui-conversation/...`).
Consequence that matters for the release: **CI release builds compile the
engine from this tree, so the tagged release ships the slash-command fix on
all platforms automatically** — no separate engine release step.

## Read this first — the trap that cost a build cycle

**Never edit any file in the working tree while a packaging build is running.**

`electron-builder` stats and hashes every file to build the asar header, then
streams contents in a _second_ pass. A file edited between the two passes
displaces every later entry in `app.asar`. The result packages and code-signs
cleanly and is completely dead: Electron exits 1 during bootstrap with no
stdout, no stderr, nothing in userData. The
`EnableEmbeddedAsarIntegrityValidation` fuse is deliberately **off** (comment
at `scripts/afterPack.js:45`), so nothing catches this at runtime.
`verifyAsarIntegrity` in `scripts/afterPack.js` (defined ~line 165, invoked
~line 316) catches it at _pack_ time. Regression coverage:
`tests/unit/bootstrap/asarIntegrityGuard.test.ts`. Full diagnosis: commit
`87fff2b`.

**A fresh installer build is in flight as this handoff is written** (verified
running: `node scripts/build-with-builder.js x64 --win --x64` plus its
`electron-builder` child; log at `build4.log` in the session scratchpad, last
line mid-NSIS-prep; no `.exe` in `out/` yet). **Its outcome is unknown — this
document asserts nothing about that artifact.** Do not edit the tree until it
lands. The previous healthy installer measured **437.2 MB** (vs 316.5 MB
`v2.1.58` baseline — the delta is bundled OpenCode); expect similar.

## What is done and merged

Reference the commits; do not re-read the diffs unless something fails.

| Commit    | What it settled                                                             |
| --------- | --------------------------------------------------------------------------- |
| `83734d0` | slash commands survive idle sessions; `/new` and `/agents` builtins added   |
| `119f07f` | architecture record updated for the slash work (owned by another agent)     |
| `33a5c54` | the "/" menu lists the assistant's real skills and actually loads them      |
| `87fff2b` | asar integrity guard at pack time (`scripts/afterPack.js`)                  |
| `af28486` | web-host tests that were silently never running                             |
| `e4f8e1a` | OpenCode ships in the web-cli tarball too                                   |
| `8dd55c3` | multi-arch build invocations refused instead of shipping the wrong binaries |
| `789da7f` | every main-process analytics event carries `app_version`/`platform`/`arch`  |

On `83734d0` — the newest change. Two halves:

1. **Engine**: `GET /api/conversations/{id}/slash-commands` only served live
   sessions; an idle conversation got 404 and the renderer cleared the menu.
   The engine now falls back to the cached `agent_metadata.available_commands`
   catalog when no task is live. **Verified LIVE against production data**
   during the session: the exact conversation that 404'd (id `bbf7d12b...`)
   returned 200 with all 18 OpenCode commands. The renderer
   (`packages/desktop/src/renderer/hooks/chat/useSlashCommands.ts`) keeps its
   last-known list on fetch error; a genuinely empty catalog still clears via
   the success path.
2. **Builtins**: `/new` (navigates to a new conversation) and `/agents` (opens
   the assistants page) added in
   `packages/desktop/src/renderer/components/chat/SendBox/index.tsx`
   (names at lines 455-485). The other six commands in OpenCode's TUI
   (`/exit` `/move` `/variants` `/status` etc.) are **not exposed over ACP at
   all — recorded as impossible, not pending.** No fake entries were added.

On `33a5c54` — skills in the "/" menu: assistant's enabled skills are listed
(from `capabilities.default_*`, auto-inject excluded), a pick sends the
structured `inject_skills` field, display order is agent commands → builtins →
skills. Ordering (`orderSlashCommandsForDisplay`) is deliberately separate
from collision precedence (`mergeSlashCommands`), which runs the opposite way
so a skill cannot shadow `/copy`. Key files:
`packages/desktop/src/common/chat/slash/injectSkills.ts`,
`.../slash/mergeSlashCommands.ts`, `.../slash/availability.ts`,
`packages/desktop/src/renderer/hooks/chat/useAssistantSlashSkills.ts`.

Also in place (`d102583`, `0ab601a`, `d0efbb6`): OpenCode ships inside the
desktop installer; `verifyBundledOpencode` (`scripts/afterPack.js:247`) fails
the pack if the bundle for the target runtime key is missing or its version
mismatches `OPENCODE_VERSION`.

**Test suite:** last full run reported **4613 passed / 6 skipped / 2 todo**
(was 4603 before `83734d0`, which added 19 app tests). Engine: 6 new cargo
integration tests plus e2e updates reported green (session-reported figures —
_not re-run while writing this handoff_; the packaging build owns the
machine).

## Dev-profile trap — `bun start` currently fails, by design

`bun start` uses the dev profile **`Pavii.Ai-Dev`**
(`packages/desktop/src/common/platform/index.ts:13`), whose database was
migrated to **v40** by a `wip/tools-mcp-directory` engine on Aug 21. Main's
engine has **39** migrations (verified: 39 files in
`the-remaa/AionCore/crates/aionui-db/migrations`, last is
`039_omp_direct_cli_launch.sql`), so the downgrade guard refuses the DB and
the app shows "Startup didn't complete". **The production profile is at 39
and unaffected.** If dev-profile work is needed: point at a fresh data dir
via the E2E override (`AIONUI_E2E_TEST=1` +
`AIONUI_E2E_USER_DATA_DIR=<path>`, read in
`packages/desktop/src/process/utils/configureChromium.ts:22-25`), or accept
that the dev profile stays broken until the wip branch's migration lands.

## Still open — nothing below is proven

- **The in-flight build's outcome is unknown.** Check the two afterPack guard
  lines (`app.asar integrity verified ...`, `Bundled OpenCode ... verified`)
  and re-measure size before trusting it.
- **Nothing in `83734d0`/`33a5c54` has been verified in the installed app.**
  The engine fix was verified live against the dev-served engine; the
  installed-build check is the user's to perform (Browser pane cannot drive
  an Electron window).
- **No release has been cut.**
- **The afterPack OpenCode guard has never run on macOS or Linux.** Only a
  tagged CI build proves it; `verifyBundledOpencode` intentionally passes
  when no published binary exists for a runtime key.
- **`scripts/pack-web-cli.js` has never been run end to end** (unit-tested
  only: `tests/unit/assets/prepareOpencode.test.ts`).
- **Branch protection on `main` is still off** — needs the user's `buckleson`
  admin account and is **explicitly out of scope**; do not attempt it.
- **No runtime analytics opt-out** — build-time flag only
  (`packages/desktop/src/common/analytics/config.ts:42`; Vite defines in
  `packages/desktop/electron.vite.config.ts` lines 158, 316). Product-owner
  decision, documented in `readme.md` and the About modal.
- **The privacy policy page is written but PARKED by the user.** Lives in the
  separate `fluffy-lamp` repo (`.workspaces/fluffy-lamp/src/pages/privacy.astro`,
  footer link in `.../src/utils/navigation.ts:27`), uncommitted there.
  Login-accepts-policy wording does not exist yet. **Do not ship it unasked.**

## Two pinned-but-undecided behaviours (web-host)

Neither is a bug today; both were noticed and deliberately left alone.

1. `registerOpencodeOnPath` is called unconditionally in `startWebHost`
   (`packages/web-host/src/index.ts`); for `useExistingBackend` the PATH
   mutation is ineffective. The desktop main process also calls it
   (`packages/desktop/src/index.ts:914`); registration is idempotent.
2. That call is not wrapped in `try`, so a PATH-registration failure would
   abort the web host. `registerOpencodeOnPath`
   (`packages/web-host/src/ensure-opencode.ts:107`) has no explicit throw
   path today — latent, not observed.

## Environment traps

- **Disk pressure is chronic.** D: hovered at 92-100% all session (96% used /
  4.7 GB free at handoff). Regenerable relief valves: the engine's cargo
  `target/` (`the-remaa/AionCore/target/`) and electron `out/`. Two agents
  had to delete artifacts mid-run to survive. Big NON-repo consumers observed
  (`D:\CodexData`, `D:\our-cliss`, `D:\WUDownloadCache`, `D:\.pnpm-store` —
  roughly 9-12 GB each, sizes unverified): user-owned cleanup candidates,
  **outside agent scope**.
- **`just` is NOT on `PATH`.** A binary exists at
  `.cache/tools/just/just.exe` (`just 1.58.0`); invoke by absolute path or
  run the `just push` recipe steps by hand: `bun run lint:fix` →
  `bun run format` → `bunx tsc --noEmit` → `bun run test` → `git push`.
  Judge lint by exit code — the repo has many pre-existing _warnings_.
- **vitest scopes web-host to `src/` only.** The root `vitest.config.ts`
  matches `packages/web-host/src` tests and nothing else (what `af28486`
  fixed). The divergence is still live: `packages/web-host/vitest.config.ts`
  also includes `tests/**/*.test.ts`, which sits outside the `bun run test`
  gate. `packages/web-host/tests/` does not exist today — do not create
  tests there.
- **Never write prose through `node -e "..."` or an unquoted heredoc** — it
  silently eats backslashes and dollar-sequences. Use quoted heredocs or the
  editor tools. Never use PowerShell text cmdlets on repo files (BOM /
  cp1252 damage) — see `AGENTS.md`.
- **Never run `git checkout`, `git restore`, `git stash`, or `git reset`.**
  A subagent once destroyed ~311 lines of another agent's uncommitted tests
  with `git checkout --`. Any subagent prompt must forbid
  working-tree-discarding git commands explicitly.

## Next steps, in dependency order

1. Confirm the in-flight build finished and the installer is in `out/`
   (`directories.output`, `packages/desktop/electron-builder.yml:16`). Look
   for both afterPack guard lines. If the guard threw, it is the
   corrupt-asar case — rebuild from a quiescent tree.
2. Measure the installer; expect ~437.2 MB. A large deviation means the
   bundle contents changed — investigate before shipping.
3. **The user installs and hand-tests.** Checklist, in order:
   - No silent exit 1 on launch with nothing in userData (corrupt-asar
     signature).
   - OpenCode resolves on first launch with no network fetch; OpenCode
     default is usable in the first session on a fresh profile.
   - Type "/" in an **idle** OpenCode conversation → expect 18 agent
     commands + `/new` `/agents` `/btw` `/open` `/copy` + the assistant's
     skills (auto-inject skills absent).
   - Pick a skill and send → engine log shows `inject_skills`; the skill
     actually loads, not just pasted text. Deleting the `/name` token before
     sending cancels the load.
   - `/new` navigates to a new conversation; `/agents` opens the assistants
     page.
   - A brand-new conversation still lists skills when the agent advertises
     commands; Codex's menu opens during warmup with builtins + skills, and
     agent commands merge in once the session activates.
4. If checking via `bun start` instead of the installed build: see the
   dev-profile trap above — the dev DB is at migration 40 and will refuse to
   start. Use a fresh data dir via the E2E override, or test the installed
   (production-profile) build. Never `bun run webui`.
5. Re-run `bun run test` and `bun run check:encoding` on the now-quiet
   machine to re-confirm the 4613-passing baseline before tagging.
6. Cut the release via the `bump-version` skill. The tagged CI build is what
   finally exercises the afterPack OpenCode guard on macOS and Linux — watch
   those two jobs; they have never run this code. The engine builds from the
   tracked `the-remaa/AionCore` tree, so the slash fix ships on all
   platforms with no extra step.
7. Optionally, run `scripts/pack-web-cli.js` end to end once.

## Suggested skills

- **`bump-version`** — owns the release cut (step 6); do not hand-roll it.
- **`testing`** — before claiming any behaviour verified; enforces the
  test-runner / failure-analyst wave separation `AGENTS.md` requires.
- **`architecture-recorder`** — after the release lands, fold the outcome
  into `docs/agent-context/architecture-record.md` (owned by a different
  agent than this one).

## Related context documents

- `docs/agent-context/architecture-record.md` — decisions and codebase map
  (updated for the slash work in `119f07f`).
- `docs/agent-context/privacy-audit.md` — the telemetry posture reversal.
