# Handoff — install and hand-test the Windows build, then cut the release

Next session's focus: **install the packaged Windows x64 build of `v2.1.66`,
hand-test it — the "/" menu above all — then cut a release.** Everything the
release depends on is already merged to `main`; nothing is on a feature branch.

Repo state at handoff: branch `main`, working tree clean, version `2.1.66`
(`package.json`). Head is `33a5c54`.

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

**A build is in flight as this handoff is written** (verified: `node
scripts/build-with-builder.js x64 --win --x64` plus its `electron-builder` child
were both running). The installer directory `out/` at the repo root — `directories.output` in
`packages/desktop/electron-builder.yml:16` — did not exist yet. Do not edit the
tree until it lands.

## What is done and merged

Reference the commits; do not re-read the diffs unless something fails.

| Commit    | What it settled                                                             |
| --------- | --------------------------------------------------------------------------- |
| `33a5c54` | the "/" menu lists the assistant's real skills and actually loads them      |
| `87fff2b` | asar integrity guard at pack time (`scripts/afterPack.js`)                  |
| `af28486` | web-host tests that were silently never running                             |
| `e4f8e1a` | OpenCode ships in the web-cli tarball too                                   |
| `8dd55c3` | multi-arch build invocations refused instead of shipping the wrong binaries |
| `789da7f` | every main-process analytics event carries `app_version`/`platform`/`arch`  |

On `33a5c54` specifically — the newest change and the least proven, so know what
you are hand-testing. The menu itself was never broken: agents advertise their
own commands over ACP and the composer already merged them with Pavii's
builtins. **Skills** were the broken half — only conversation-mounted skills
were listed (nearly always none), picking one merely inserted `/name ` as text
and never loaded anything, and the new-conversation composer dropped skills
entirely whenever the agent advertised any command. Now the assistant's enabled
skills are listed (from `capabilities.default_*`, auto-inject ones excluded), a
pick is sent as the structured `inject_skills` field, and display order is
agent commands → builtins → skills. Read the commit message for the full
reasoning; ordering (`orderSlashCommandsForDisplay`) is deliberately separate
from collision precedence (`mergeSlashCommands`), which runs the opposite way so
a skill cannot shadow `/copy`. Key files:
`packages/desktop/src/common/chat/slash/injectSkills.ts`,
`.../slash/mergeSlashCommands.ts`, `.../slash/availability.ts`, and
`packages/desktop/src/renderer/hooks/chat/useAssistantSlashSkills.ts`.

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

**Test suite:** the last full run reported **4603 passed / 6 skipped / 2 todo
across 499 files** (was 4549/496 before `33a5c54`, which added 54 tests). _Not
re-run while writing this handoff_ — the packaging build owns the machine. The
file count is corroborated structurally (494 files under `tests/unit`,
`tests/integration`, `tests/regression` plus 5 under `packages/web-host/src`);
the pass count is the reported number, not a fresh result.

## Still open — nothing below is proven

- **A clean Windows installer HAS been produced and verified — but not the one
  that includes `33a5c54`.** The earlier healthy build reported both guard lines
  (`app.asar integrity verified (40016 packed entries)` and `Bundled OpenCode
1.18.21 verified`) and measured **437.2 MB**, against a 316.5 MB `v2.1.58`
  baseline. That ~120 MB jump is OpenCode now shipping inside the installer.
  The previous handoff flagged 437.2 MB as measured on a corrupt build; it has
  since been confirmed on a healthy one, so treat it as the real figure.
- **The build now running includes `33a5c54`; its outcome is unknown.** Nothing
  in this document asserts anything about that artifact. Check the two guard
  lines and re-measure before trusting it.
- **The slash-command changes have NOT been verified in the running app.** Only
  unit tests cover them (54 added in `33a5c54`). The visual and interaction
  check is the user's to perform: the Browser pane cannot drive an Electron
  window, and the standing preference is `bun start` (desktop app) — never
  `bun run webui`, and never both at once.
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
- **The privacy policy page is written but PARKED by the user.** It lives at
  `.workspaces/fluffy-lamp/src/pages/privacy.astro`, with the footer link added
  in `.workspaces/fluffy-lamp/src/utils/navigation.ts:27`. Reported clean on
  `npx astro check` (0 errors) and rendering locally — _not re-verified in this
  session_. `.workspaces/` is gitignored **here**, but `fluffy-lamp` is its own
  git repo with remote `vjk7989/fluffy-lamp` that auto-deploys, so this CAN
  ship by committing there — both files are currently uncommitted in that repo.
  The user has explicitly parked it until the product works, and additionally
  wants a footer link plus wording that logging in accepts the privacy policy
  and terms. That wording does not exist yet. **Pending, not done — do not ship
  it unasked.**

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

- **`just` is NOT on `PATH`** (re-verified: `command -v just` fails). A binary
  does exist at `.cache/tools/just/just.exe` (`just 1.58.0`) and can be invoked
  by absolute path. Otherwise run the `just push` recipe steps by hand:
  `bun run lint:fix` → `bun run format` → `bunx tsc --noEmit` → `bun run test` →
  `git push`. Judge lint by exit code — the repo has many pre-existing
  _warnings_.
- **vitest scopes web-host to `src/` only.** The root `vitest.config.ts` (`node`
  project's `include` list) matches `packages/web-host/src` test files and
  nothing else, so a test placed anywhere else inside `packages/web-host` never
  runs and never reports. That is what `af28486` fixed. **The divergence is
  still live:**
  `packages/web-host/vitest.config.ts` also includes `tests/**/*.test.ts`, so a
  file there runs when that config is used directly but sits outside the
  `bun run test` gate entirely. `packages/web-host/tests/` does not exist today,
  so nothing is currently being missed — but do not create tests there.
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

1. Confirm the in-flight `bun run build-win:x64` finished and the installer is
   in `out/` at the repo root. Look for the afterPack lines reporting
   `app.asar integrity verified` and `Bundled OpenCode ... verified for
win32-x64`. If the guard threw, it is the corrupt-asar case again — rebuild
   from a quiescent tree.
2. Measure the installer. Expect roughly 437.2 MB (the previous healthy build)
   against the 316.5 MB `v2.1.58` baseline. A large deviation means something
   changed in what got bundled — investigate before shipping.
3. **The user installs and hand-tests.** This is theirs, not an agent's: the
   Browser pane cannot drive an Electron window. What to rule out and check, in
   order:
   - Silent exit 1 on launch with nothing written to userData (the corrupt-asar
     signature).
   - OpenCode resolves on first launch with no network fetch.
   - **The "/" menu** — the only unproven behaviour in this build. Open a
     conversation on a real ACP agent and type `/`. Expect the agent's own
     commands first, then Pavii builtins, then the assistant's enabled skills
     (auto-inject skills deliberately absent). Then: pick a skill and send —
     it must actually load, not just paste text. Delete the `/name` token
     before sending — the load must be cancelled. Also check a brand-new
     conversation, which is where skills used to vanish entirely whenever the
     agent advertised commands.
   - Codex specifically: the menu must open immediately during warmup with
     builtins and skills, and the agent's own commands must merge in once the
     session activates.
4. If `bun start` is used for the "/" check instead of the installed build,
   that is fine and is the user's standing preference. Never `bun run webui`.
5. Re-run `bun run test` and `bun run check:encoding` on the now-quiet machine
   to re-confirm the 4603-passing baseline before tagging.
6. Cut the release via the `bump-version` skill. The tagged CI build is what
   finally exercises the afterPack OpenCode guard on macOS and Linux — watch
   those two jobs specifically, they have never run this code.
7. Optionally, run `scripts/pack-web-cli.js` end to end once. It has only ever
   been unit-tested.

## Suggested skills

- **`bump-version`** — owns the release cut: version bump, checks, branch, PR,
  tag. Step 6 above is its job; do not hand-roll it.
- **`testing`** — before claiming any behaviour is verified, and for the
  test-runner / failure-analyst wave separation `AGENTS.md` requires.
- **`architecture-recorder`** — after the build verifies and the release lands,
  to fold the outcome into `docs/agent-context/architecture-record.md` (owned by
  a different agent than this one).

## Related context documents

- `docs/agent-context/architecture-record.md` — decisions and codebase map.
- `docs/agent-context/privacy-audit.md` — the telemetry posture reversal.
