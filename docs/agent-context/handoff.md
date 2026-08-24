# Handoff — verify a clean Windows build, then cut the release

Next session's focus: **finish verifying a clean Windows x64 build of `v2.1.66`,
then cut a release.** Everything the release depends on is already merged to
`main`; nothing is on a feature branch.

Repo state at handoff: branch `main`, working tree clean, version `2.1.66`
(`package.json`). Head is `87fff2b`.

## Read this first — the trap that cost a build cycle

**Never edit any file in the working tree while a packaging build is running.**

`electron-builder` stats and hashes every file to build the asar header, then
streams contents in a _second_ pass. A file edited between the two passes
displaces every later entry in `app.asar`. The result packages and code-signs
cleanly and is completely dead: Electron exits 1 during bootstrap with no
stdout, no stderr (the exe is GUI-subsystem, so silence carries no
information) and nothing written to userData. The
`EnableEmbeddedAsarIntegrityValidation` fuse is deliberately **off** (see the
comment at `scripts/afterPack.js:45`), so nothing catches this at runtime.

`verifyAsarIntegrity` in `scripts/afterPack.js` (defined ~line 165, invoked at
line 316) now catches it at _pack_ time by re-reading the boot path and the
archive tail against their header hashes. Regression coverage:
`tests/unit/bootstrap/asarIntegrityGuard.test.ts`. The full diagnosis is in
commit `87fff2b` — read that message rather than re-deriving it.

Practical rule for the next session: start the build, then **stop touching the
tree** until it finishes. Do docs and planning work only after the artifact
exists.

## What is done and merged

Reference the commits; do not re-read the diffs unless something fails.

| Commit    | What it settled                                                             |
| --------- | --------------------------------------------------------------------------- |
| `87fff2b` | asar integrity guard at pack time (`scripts/afterPack.js`)                  |
| `af28486` | web-host tests that were silently never running                             |
| `e4f8e1a` | OpenCode ships in the web-cli tarball too                                   |
| `8dd55c3` | multi-arch build invocations refused instead of shipping the wrong binaries |
| `789da7f` | every main-process analytics event carries `app_version`/`platform`/`arch`  |

Also in place from the preceding commits (`d102583`, `0ab601a`, `d0efbb6`):
OpenCode ships inside the desktop installer, and `bundled-opencode/` /
`bundled-paviicore/` are scoped to the single target arch per build.
`verifyBundledOpencode` (`scripts/afterPack.js:247`) fails the pack if the
bundle for the target runtime key is missing or its `manifest.json` version
does not match `OPENCODE_VERSION`.

Analytics honesty pass: `readme.md` (the `## Privacy` section — the tracked
filename is lowercase) and the About
modal
(`packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx`,
lines 223-233, keys `settings.analyticsNoticeTitle` /
`settings.analyticsNoticeBody`) both state plainly that analytics is always on
and that there is no in-app switch.

**Test suite:** the last full run reported 4549 passed / 6 skipped / 2 todo
across 496 files. _Not re-run in this session_ — the packaging build was
occupying the machine. Treat it as the last known-good number, not a fresh
result.

## Still open — nothing below is proven

- **The clean Windows build had not finished at handoff time.** The previous one
  was corrupt (see above). Neither `dist/` nor `release/` existed when this
  handoff was written.
- **Installer size is unconfirmed.** 437.2 MB was measured on the _corrupt_
  build, against a 316.5 MB `v2.1.58` baseline. A jump of roughly 120 MB is
  plausible now that OpenCode ships inside the installer, but it must be
  re-measured on a clean build before it means anything.
- **No release has been cut.**
- **The afterPack OpenCode guard has never run on macOS or Linux.** Only a
  tagged CI build proves it. Note that `verifyBundledOpencode` intentionally
  passes when no published binary exists for a runtime key.
- **`scripts/pack-web-cli.js` has never been run end to end.** Its OpenCode
  staging is covered only by contract-level unit tests in
  `tests/unit/assets/prepareOpencode.test.ts`.
- **Branch protection on `main` is still off.** It needs the user's `buckleson`
  admin account and is **explicitly out of scope** by the user's instruction —
  do not attempt it.
- **No runtime analytics opt-out.** `POSTHOG_DISABLED` is a build-time flag read
  in `packages/desktop/src/common/analytics/config.ts:42` and injected as a Vite
  define (`packages/desktop/electron.vite.config.ts`, lines 158 and 316).
  `readme.md` and the About modal both say so; this is a product-owner decision,
  not an oversight.
- **A privacy policy page is NOT in this repo.** It lives at
  `.workspaces/fluffy-lamp/src/pages/privacy.astro`, linked from the site
  footer, verified rendering locally — but `.workspaces/` is gitignored, so it
  is neither committed nor deployed.

## Two pinned-but-undecided behaviours

Both in `packages/web-host/src/`. Neither is a bug today; both were noticed and
deliberately left alone.

1. `registerOpencodeOnPath` is called unconditionally in `startWebHost`
   (`packages/web-host/src/index.ts`, before the `ownBackend` /
   `useExistingBackend` branch). For `useExistingBackend` the PATH mutation is
   ineffective — the engine is someone else's process. The desktop main process
   also calls it independently at `packages/desktop/src/index.ts:914`;
   registration is idempotent, so the double call is harmless.
2. That call is not wrapped in a `try`, so a PATH-registration failure aborts
   the whole web host rather than degrading to "no bundled OpenCode".
   `registerOpencodeOnPath` itself (`packages/web-host/src/ensure-opencode.ts`,
   line 107) has no explicit throw path, so this is latent rather than observed.

## Environment traps

- **`just` is NOT installed on this machine** (verified: not on `PATH`). The
  `just push` recipe steps must be run by hand: `bun run lint:fix` →
  `bun run format` → `bunx tsc --noEmit` → `bun run test` → `git push`. Judge
  lint by exit code — the repo has many pre-existing _warnings_.
- **vitest only includes `packages/web-host/src/` `*.test.ts` files** for that
  package (`vitest.config.ts`, the `node` project's `include` list). A test
  placed anywhere else inside `packages/web-host` never runs and never reports.
  That is what `af28486` fixed.
- **Never write prose through `node -e "..."` or an unquoted heredoc.** It
  silently eats backslashes and dollar-sequences; it has corrupted regexes and
  docs more than once. Use quoted heredocs or the editor tools. Never use
  PowerShell text cmdlets on repo files either (BOM and cp1252 damage) — see
  `AGENTS.md`.
- **Never run `git checkout`, `git restore`, `git stash`, or `git reset`.** A
  subagent once ran `git checkout --` on files it assumed the formatter had
  touched and destroyed roughly 311 lines of another agent's uncommitted tests.
  Any instruction you give a subagent must forbid working-tree-discarding git
  commands explicitly.

## Next steps, in dependency order

1. Confirm the in-flight `bun run build-win:x64` finished. Look for the
   afterPack lines reporting `app.asar integrity verified` and
   `Bundled OpenCode ... verified for win32-x64`. If the guard threw, it is the
   corrupt-asar case again — rebuild from a quiescent tree.
2. Measure the produced installer and compare against the 316.5 MB `v2.1.58`
   baseline. Record the real number; retire the 437.2 MB figure either way.
3. Install and launch the artifact. The failure mode to rule out is a silent
   exit 1 with nothing written to userData. Confirm OpenCode resolves on first
   launch without a network fetch.
4. Re-run `bun run test` and `bun run check:encoding` on the now-quiet machine
   to re-confirm the 4549-passing baseline before tagging.
5. Cut the release via the `bump-version` skill. The tagged CI build is what
   finally exercises the afterPack OpenCode guard on macOS and Linux — watch
   those two jobs specifically, they have never run this code.
6. Optionally, run `scripts/pack-web-cli.js` end to end once. It has only ever
   been unit-tested.

## Suggested skills

- **`bump-version`** — owns the release cut: version bump, checks, branch, PR,
  tag. Step 5 above is its job; do not hand-roll it.
- **`testing`** — before claiming any behaviour is verified, and for the
  test-runner / failure-analyst wave separation `AGENTS.md` requires.
- **`architecture-recorder`** — after the build verifies and the release lands,
  to fold the outcome into `docs/agent-context/architecture-record.md` (owned by
  a different agent than this one).

## Related context documents

- `docs/agent-context/architecture-record.md` — decisions and codebase map.
- `docs/agent-context/privacy-audit.md` — the telemetry posture reversal.
