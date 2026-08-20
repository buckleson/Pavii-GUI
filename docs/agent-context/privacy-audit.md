# Network egress audit

Every outbound destination reachable from a shipped Pavii.Ai build, what
triggers it, and whether it survived. Written against commit `c6102fc`.

Re-run the sweep with:

```bash
node scripts/check-language.js && node scripts/check-encoding.js
```

and the binary assertions in `tests/unit/bootstrap/noVendorUpdateEndpoint.test.ts`.

## Removed

### officecli auto-install (the serious one)

Opening a `.docx`, `.xlsx` or `.pptx` with `officecli` absent ran the vendor's
install script with no prompt:

```
irm https://d.officecli.ai/install.ps1 | iex          # Windows
curl -fsSL https://d.officecli.ai/install.sh | bash   # macOS / Linux
```

A second path polled the vendor's GitHub releases page and re-ran the installer
whenever the version differed. `d.officecli.ai` is iOfficeAI, the upstream
vendor. Opening a document therefore granted a third party remote code
execution and disclosed install IP, timing and version.

Removing the Rust installer was not sufficient: eleven builtin `SKILL.md` files,
one of them auto-injected into every agent context, instructed the model to run
the same command, and `officecli-word-form` supplied a ready
`if not installed then install` conditional per shell. That is the same
execution path routed through the model.

Both are gone. `OfficeError::OfficecliNotFound` now reaches the UI, which
already rendered install instructions for that state. The displayed command
points at the project repository rather than the CDN so it can be read before
being piped into a shell.

- Engine: `crates/aionui-office/src/officecli_runtime.rs`, `watch_manager.rs`
- Skills: `crates/aionui-app/assets/builtin-skills/**/SKILL.md`
- Pinned by `module_contains_no_installer_endpoint` and
  `wp4_missing_officecli_reports_rather_than_installs`
- Verified absent from the built `paviicore.exe`

### PostHog download analytics

`.github/workflows/track-downloads.yml` mirrored GitHub's release download
counters into PostHog on a daily cron under an upstream key. CI-only, no user
data, but it is upstream's analytics pipeline aimed at a third party.

## Dormant, and why that holds

### Sentry

`@sentry/electron` is the only tracker-shaped package among 101 runtime
dependencies. Both the app and the installer read `SENTRY_DSN` at **build**
time:

- `packages/desktop/electron.vite.config.ts` defines `process.env.SENTRY_DSN`
  as `''` when unset
- `scripts/build-with-builder.js` writes the same into the NSIS define

The shipped bundle contains `dsn: ""` and no ingest URL. The installer's
reporter short-circuits on an empty DSN (`report-installer-failure.ps1`, the
`empty-dsn` branch) before it reads the log or the analytics id.

Setting `SENTRY_DSN` at build time re-arms both. The installer reporter then
uploads the full installer log as an attachment; that log contains file paths,
which contain the Windows user name.

### Upstream update feed

`updateFeed.ts` points at `buckleson/Pavii-GUI` releases.
`tests/unit/bootstrap/noVendorUpdateEndpoint.test.ts` fails the build if a
fallback to `static.aionui.com` or iOfficeAI reappears.

## Kept deliberately

| Destination                                                                             | Trigger                                       | Why it stays                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.openai.com`, `api.anthropic.com`, `api.deepseek.com`, and the other provider bases | A request to a provider the user configured   | Contacted only with the user's own key. Not reached otherwise.                                                                                                               |
| `slack.com`, `open.feishu.cn`, `oapi.dingtalk.com`, `ilinkai.weixin.qq.com`             | A channel the user set up                     | Feature endpoints; inert until configured.                                                                                                                                   |
| `nodejs.org/dist`                                                                       | Managed Node runtime missing                  | Official distribution, single source, no mirror.                                                                                                                             |
| npm registry (`opencode-ai`)                                                            | First launch, if `opencode` is not resolvable | A deliberate Pavii feature: OpenCode ships as a default agent. `packages/desktop/src/process/startup/ensureOpencode.ts`.                                                     |
| `pavii.tech/login`, `googleapis.com` certs                                              | User signs in                                 | The project's own Firebase. The Google call fetches **public** signing certs; the token is verified locally, so no user data is sent.                                        |
| `github.com` issue form                                                                 | User presses Report Issue                     | Opens a prefilled form in the user's browser; they see it and submit it. `PAVII_ISSUE_PROXY_URL` can route through `services/issue-proxy/` instead, and is unset by default. |
| `raw.githubusercontent.com/iOfficeAI/AionHub`                                           | Build time, on the developer machine          | `scripts/prepareHubResources.js` bundles the extension catalog. Not a runtime path.                                                                                          |

## Known gaps

- The bundled `claude.exe` under `managed-resources/` is Anthropic's CLI and
  carries its own telemetry. It is a third-party binary the user opted into by
  using Claude; not ours to strip.
- The engine depends on `iOfficeAI/aionrs` as a git crate. Build-time only.
- macOS and Linux builds have not been produced since the rename.
