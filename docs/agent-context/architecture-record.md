# Architecture Record

## Current Architecture

### Codebase Map

| Area                | Location                                                 | Notes                                                                                             |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Agent context       | `docs/agent-context/`                                    | This record and the current handoff.                                                              |
| Brand assets        | `resources/brand/`, `resources/app.*`                    | Master logo + generated icons; see `scripts/generate-brand-icons.mjs`.                            |
| Bundled skills      | `resources/bundled-skills/`                              | Pavii-curated skill pack (Token Optimizer + mattpocock set), auto-imported at startup.            |
| Channel bridges     | `packages/desktop/src/process/services/channels/`        | App-hosted Slack + Discord bridges between chat platforms and backend conversations.              |
| Desktop application | `packages/desktop/`                                      | Electron application workspace.                                                                   |
| Display branding    | `packages/desktop/src/common/utils/assistantBranding.ts` | Rebrands backend-supplied assistant/agent names at the HTTP adapter (skills: `skillBranding.ts`). |
| IPC preload         | `packages/desktop/src/preload/`                          | Boundary between renderer and main process.                                                       |
| Main process        | `packages/desktop/src/process/`                          | Node.js and Electron main APIs; no DOM.                                                           |
| Mobile app          | `mobile/`                                                | Expo/React Native remote client (`Pavii.Ai Mobile`).                                              |
| Profile & usage     | `packages/desktop/src/renderer/pages/profile/`           | Profile page (stats, heatmap, share card); data from the main-process usage ledger.               |
| Renderer            | `packages/desktop/src/renderer/`                         | React/browser APIs only.                                                                          |
| Shared code         | `packages/desktop/src/common/`                           | Cross-process-safe types and utilities.                                                           |
| Slash commands      | `packages/desktop/src/common/chat/slash/`                | Menu assembly: ACP mapping, merge/ordering, availability, and skill injection.                    |
| Tests               | `tests/`                                                 | Unit, integration, regression, and end-to-end suites.                                             |
| Web host / CLI      | `packages/web-host/`, `packages/web-cli/`                | Headless backend launcher + `pavii-web` CLI.                                                      |
| Website (external)  | `.workspaces/fluffy-lamp/`                               | Astro marketing/login site; pushed to `vjk7989/fluffy-lamp`, not part of the desktop build.       |

### Process and Module Boundaries

- Main and renderer process constraints are authoritative in `AGENTS.md#architecture`.
- The engine is built from vendored source at `the-remaa/AionCore`, which **is tracked in this repository**: `.gitignore` re-includes it (`!the-remaa/AionCore/`) and ignores only its `target/` and `node_modules/`; the tree is excluded from lint/format (`.oxlintrc.json`, `.prettierignore`), not from git. CI release builds compile it from this tree (`.github/workflows/_build-reusable.yml`: `cargo build --release --bin paviicore`), so committed engine changes ship on tag automatically. Local builds: `cargo build --release --bin paviicore`, deployed to `resources/bundled-paviicore/win32-x64/paviicore.exe`. Source-level rebrand applied there: butler rules (3 locales) + `assistants.json` name/i18n ("Your Pavii", identity "built by Team Pavii — pavii.tech"), `AgentType::Aionrs.display_name()` → "Pavii CLI", temp workspaces `pavii-temp-<id>`, Pavii avatar/logo embedded. NOT renamed (contracts): ids (`aionui-assistant`, `aionrs`), `AIONUI_*` env vars, `ACP_CLIENT_NAME`, `.aionrs` dot-dir (read back by name), shipped DB migrations (existing DBs keep the seeded agent name "Aion CLI"; the display layer renames it).
- Cross-process communication must use the IPC bridge in `packages/desktop/src/preload/`.
- The agent engine is the `paviicore` binary built from `the-remaa/AionCore`, spawned as a subprocess and reached over HTTP/WS; the engine inherits a spawn-time snapshot of `process.env` (`packages/web-host/src/backend-launcher.ts` `buildSpawnEnv`), so PATH/env mutations must happen before backend start.

## Active Decisions

### Apply backend-name rebranding at the HTTP adapter choke point

- Status: accepted
- Decision: Backend-supplied display strings are rebranded in `applyAssistantBranding`/`applyAgentBranding`/`brandHubExtensions` wrappers on `assistants.list/get`, `acpConversation.getManagedAgents`, and `hub.getExtensionList`; the agent predicate matches `agent_type === 'aionrs' || backend === 'aionrs'`; backend ids (`aionui-assistant`, agent kind `aionrs`) never change.
- Rationale: The engine catalog is owned upstream; a single adapter mapping rebrands every surface without forking the backend.
- Affects: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Evidence: `packages/desktop/src/common/utils/assistantBranding.ts`, `tests/unit/common/assistantBranding.test.ts`

### Automatic third-party tool installs are removed, not gated

- Status: accepted
- Decision: Opening an Office document no longer installs `officecli`. The engine's installer and its version-check-then-reinstall path are deleted, `OfficeError::OfficecliNotFound` propagates to the UI, and the eleven builtin `SKILL.md` files that told the agent to run the vendor install script now tell it to hand the command to the user instead. Displayed commands point at the project repository, never `d.officecli.ai`.
- Rationale: The upstream flow ran `irm https://d.officecli.ai/install.ps1 | iex` unprompted, which is third-party remote code execution triggered by opening a file, and disclosed install IP/timing/version to the vendor CDN. Fixing only the Rust path would have left the skill instructions as an equivalent route through the model.
- Affects: `the-remaa/AionCore/crates/aionui-office/src/officecli_runtime.rs`
- Evidence: `docs/agent-context/privacy-audit.md`, `the-remaa/AionCore/crates/aionui-office/tests/watch_manager_integration.rs`

### Brand purge is complete and guarded; remaining old-brand tokens are classified keeps

- Status: accepted
- Decision: Three escalating rebrand passes (grep-driven, render-sink inventory, full term census) removed every user-visible `AionUi`/`Aion` string; ~15k occurrences remain by design and fall into exactly five keep classes — wire/storage identifiers (`AIONUI_*` env vars, `aionui-` ids, crate names, NSIS variables), tests pinning legacy data or the branding chokepoints themselves, scrubber rule definitions that must name what they scrub, legacy-data matchers (`BUILTIN_IMAGE_GEN_LEGACY_NAMES`), and internal dev docs/tracing. Do not re-litigate or "clean up" these classes: renaming identifiers breaks saved configs, and renaming legacy matchers breaks the migrations they serve.
- Rationale: The leak mechanism was engine-emitted English fallbacks and asset prose reaching render sinks unscrubbed; those sinks are now covered by display-layer scrub functions plus locale definitions for every engine `LocalizedText` code, and regressions are pinned by a dedicated guard suite.
- Affects: `packages/desktop/src/common/utils/assistantBranding.ts`
- Evidence: `tests/unit/renderer/brandLeakGuard.test.ts`, `packages/desktop/src/common/utils/skillBranding.ts`, `packages/desktop/src/renderer/utils/chat/toolTextBranding.ts`, `the-remaa/AionCore/crates/aionui-session/src/backend/cli_version.rs`

### CJK punctuation is inside the language gate

- Status: accepted
- Decision: `scripts/check-language.js` covers U+3000-U+303F (CJK Symbols and Punctuation) alongside the ideograph and kana blocks, and runs as a blocking step in the justfile `check`/`push` recipes and in CI.
- Rationale: The range table began at U+3040, so the ideographic comma and full stop were never checked. Three list joins shipped U+3001 into English tooltips and several comment fragments truncated at a full-width full stop went unreported, because a string reads as English right up to its separator.
- Affects: `scripts/check-language.js`
- Evidence: `tests/unit/scripts/checkLanguage.test.ts`

### Chinese-ecosystem channels removed from the UI; backend rows filtered

- Status: accepted
- Decision: Lark/DingTalk/WeChat (weixin)/WeCom are removed from the channels settings UI (4 config forms, logos, and i18n across 13 locales deleted; `ChannelModalContent` trimmed); because the aioncore engine still ships these plugins and returns them from `GET /api/channel/plugins`, `ChannelModalContent.tsx` keeps a `HIDDEN_CHANNEL_TYPES` set filtering them out of the extension-row path.
- Rationale: The engine still ships these plugins, so hiding happens in the renderer; data contracts (`ConversationSource` union, channel types, DB migration history) stay untouched so persisted data remains valid.
- Affects: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/ChannelModalContent.tsx`
- Evidence: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/ChannelModalContent.tsx`

### Do not rename upstream and persisted-contract identifiers

- Status: accepted
- Decision: Keep unchanged: `aioncoreVersion`, upstream release asset names (`aioncore-<tag>-<target>`) and download URLs, `AIONCORE_LISTENING`/`AIONCORE_READY` stdout markers, `*.aioncore.log` filenames, `agent-facing-aioncore-cli` contract id, `AIONUI_*` env vars and NSIS defines/error codes, i18n keys (incl. `AIONUI_STREAM_BROKEN`-style backend codes), `aionui-assistant`, `aionrs`, `aion-extension.json`, `.aionui-modal` CSS classes, localStorage keys, `persist:aionui-browser`, `_aionui_` separator, `[AionUi]` log prefixes, Apache license headers.
- Rationale: These are backend/build/persisted-data contracts; renaming breaks the engine handshake, error-code matching, or existing user data.
- Affects: `packages/desktop/src/`
- Evidence: `packages/shared-scripts/src/prepare-paviicore.js`, `packages/desktop/src/common/config/storageKeys.ts`

### Generate all brand icons from one master logo

- Status: accepted
- Decision: `scripts/generate-brand-icons.mjs` derives every icon (ico/icns/png/PWA/mobile/avatar data URI) from `resources/brand/the-logo.png`, converting the outside of the circular badge to transparency.
- Rationale: One source of truth; also fixed the previously missing `resources/app.png` referenced by tray/notifications/linux icon.
- Affects: `resources/`, `public/pwa/`, `packages/desktop/src/common/utils/paviiAvatarDataUri.ts`
- Evidence: `tests/unit/bootstrap/brandAssets.test.ts`

### Idle conversations serve the cached slash-command catalog

- Status: accepted
- Decision: `get_slash_commands` in `the-remaa/AionCore/crates/aionui-conversation/src/service_ops.rs` tries the live task first and otherwise serves the persisted `agent_metadata.available_commands` catalog via `resolve_agent_metadata_row` (acp_session row → assistant snapshot → `extra.agent_id` → `extra.backend` builtin, mirroring `session_context::resolve_acp_identity` and the team adapters); no live task and no cache returns `Ok(vec![])`, never 404. The cached JSON (snake_cased ACP `AvailableCommand`s with `_meta` preserved verbatim) is deserialized by the new public `cached_slash_command_items` in `the-remaa/AionCore/crates/aionui-ai-agent/src/manager/acp/agent.rs`, reusing the existing private converter.
- Rationale: `GET /api/conversations/{id}/slash-commands` only served live sessions, so the composer menu blanked the moment a session finished; the response feeds a menu, not a turn, so a missing cache must degrade to an empty list rather than an error. Verified live against production data: the conversation that 404'd returns 200 with 18 commands, completion metadata intact.
- Affects: `the-remaa/AionCore/crates/aionui-conversation/src/service_ops.rs`
- Evidence: `the-remaa/AionCore/crates/aionui-ai-agent/tests/cached_slash_commands.rs`, `the-remaa/AionCore/crates/aionui-app/tests/auxiliary_e2e.rs`

### Inline the launch splash in the renderer HTML shell

- Status: accepted
- Decision: A branded launch splash is inlined in `packages/desktop/src/renderer/index.html` (theme-aware via the existing `__aionui_theme` sync script) and dismissed by `dismissSplash()` from `packages/desktop/src/renderer/utils/ui/splash.ts`, called from `main.tsx` (Main `ready && configReady` and `BackendStartupFailureDialog`) and `packages/desktop/src/renderer/components/layout/BackendStartingView.tsx`.
- Rationale: Splash must paint before the JS bundle loads; the global classes `pavii-splash-mark`/`pavii-splash-word` are intentionally reused by `BackendStartingView` for visual continuity.
- Affects: `packages/desktop/src/renderer/index.html`
- Evidence: `tests/unit/renderer/splash.dom.test.ts`

### Ship OpenCode in the installer and put it on PATH before the engine spawns

- Status: accepted (supersedes "install OpenCode at startup via npm")
- Decision: `prepare-opencode.js` stages the pinned OpenCode binary into `resources/bundled-opencode/<runtimeKey>/` during the build (registry tarball, sha512 verified, idempotent), electron-builder ships it, and `registerOpencodeOnPath` **appends** that directory to PATH in the pre-spawn block of `index.ts` — before `backendManager.start`. The npm install of `opencode-ai` is demoted to a fallback for arches with no published binary. The bundle is a desktop-owned directory, deliberately not an engine managed-resource.
- Rationale: The product requires OpenCode on every install, but the previous mechanism could not deliver it — the npm install needed the network, ran after `markBackendReady` (so the engine had already snapshotted PATH and probed availability), and failed silently, including an unquoted `shell: true` command line that broke on any install path containing a space. Measured with the developer's own OpenCode hidden from PATH: without the bundle the engine hydrates `available=5` and `/api/assistants` contains no OpenCode row; with it, `available=6` and the row appears. Appending rather than prepending keeps a user's own OpenCode in front. PATH-only means **no engine change**: the engine resolves agents solely through `which::which` on the inherited PATH, and its `prepare-managed-resources` deliberately emits `clis: []`.
- Affects: `packages/shared-scripts/src/prepare-opencode.js`
- Evidence: `packages/web-host/src/ensure-opencode.test.ts`, `tests/unit/assets/prepareOpencode.test.ts`, `scripts/afterPack.js`

### Issue reports file into Supabase with an insert-only shipped key

- Status: accepted
- Decision: Report Issue inserts a row into the Pavii Supabase project (`issue_reports` table) and uploads screenshots/log bundles to the private `issue-attachments` bucket, using the publishable key baked into `packages/desktop/src/common/config/issueReporting.ts`. Row-level security grants that key INSERT only (no read/update/delete on rows or objects), and inserts use `Prefer: return=minimal` because the key has no SELECT. The GitHub proxy/browser paths remain as fallbacks when Supabase is unreachable; the previous browser-form flow is otherwise superseded.
- Rationale: The GitHub path required a reporter account and could never upload attachments (they were saved to a local folder to drag in by hand). A publishable key is safe in a public desktop build precisely because RLS makes it write-only; the project's secret key is used by nothing in the repo.
- Affects: `packages/desktop/src/process/feedback/issueDelivery.ts`
- Evidence: `tests/unit/feedback/issueDelivery.test.ts`

### Release assets flow through a draft GitHub release, not workflow artifacts

- Status: accepted
- Decision: Each build job uploads its installers and per-arch-renamed channel file directly onto the tag's draft release (created once by release.yml's `prepare` job); the publish job downloads from the draft, adds stable-named aliases and SHA256SUMS, verifies 8 installers + 2 Windows blockmaps + 6 updater feeds carrying the artifact version + full checksum coverage, then flips the release live (prerelease when the tag has a `-` suffix) and mirrors to buckleson/Pavii-Gui-Releases. Publish gates key on the version read from the built `latest.yml`, with a stable-tag gate requiring tag and artifact versions to agree. Preflight jobs run the full desktop and engine suites before any build starts.
- Rationale: The artifact-mediated pipeline was quota-gated end to end — an exhausted Actions storage quota stalled v2.2.0 for a day with builds that could not hand output to publish. Release assets are not metered by that quota (proven by `release-asset-probe.yml`), and a draft is invisible to `releases/latest` until every gate passes. Validated end to end by a v2.2.0-rc.1 prerelease dry-run before the real tag.
- Affects: `.github/workflows/release.yml`
- Evidence: `.github/workflows/_build-reusable.yml`, `tests/unit/releasePackagingConfig.test.ts`

### The Arco palette bridge is re-inherited on body

- Status: accepted
- Decision: `arco-override.css` re-declares the eight tokens the app defines on `:root` that arco.css also declares on `body` (`--primary-1..7`, `--color-text-1`) as `inherit` on `body` and `body[arco-theme='dark']`, plus explicit ramp fills for primary/secondary/text buttons.
- Rationale: An element's own custom-property declaration beats an inherited one, so Arco's `body` palette silently shadowed the `:root` violet bridge — every `type='primary'` button and `rgb(var(--primary-6))` usage rendered Arco blue while hand-written `var(--primary)` surfaces went violet. `inherit` re-opens the cascade for any theme that writes `:root`, presets included.
- Affects: `packages/desktop/src/renderer/styles/arco-override.css`
- Evidence: `tests/unit/theme/arcoButtonTheme.test.ts`

### token-optimizer is a builtin auto-inject skill

- Status: accepted
- Decision: The skill ships in the engine's embedded corpus at `the-remaa/AionCore/crates/aionui-app/assets/builtin-skills/auto-inject/token-optimizer/` (auto-injection is a path predicate — builtin source plus an `auto-inject/` relative location — not a flag), carrying a YAGNI rule for code. The desktop bundle copy is removed, and `brandSkills` drops the lingering imported user-source duplicate on older installs while keeping the builtin row.
- Rationale: The bundle import lands skills as user-source rows, which can never auto-inject; only the embedded corpus loads a skill into every conversation for every CLI.
- Affects: `the-remaa/AionCore/crates/aionui-app/assets/builtin-skills/auto-inject/token-optimizer/SKILL.md`
- Evidence: `packages/desktop/src/common/utils/skillBranding.ts`, `tests/unit/common/skillBranding.test.ts`

### Palette light on Violet Bloom, dark on Vercel

- Status: accepted
- Decision: The default color scheme maps the tweakcn "violet-bloom" palette to the light block and the tweakcn "vercel" monochrome palette to the dark block, including an Arco `--primary-1..7` RGB-triplet bridge; dark keeps a blue interactive accent instead of Vercel's literal white primary.
- Rationale: Requested brand look; a pure-white primary would collide with components that render white text on the primary color.
- Affects: `packages/desktop/src/renderer/styles/themes/default-color-scheme.css`
- Evidence: `docs/theming/tokens.md`

### Pin shared vendor helpers into the react chunk

- Status: accepted
- Decision: `manualChunks` places `commonjsHelpers`, `@babel/runtime`, and `scheduler` into `vendor-react` and matches react/react-dom by exact package path.
- Rationale: The prior `'/react/'` substring also matched `@iconify/react` and `@monaco-editor/react`, creating a circular chunk graph that evaluated Arco before React and blanked every production page (pre-existing upstream bug).
- Affects: `packages/desktop/electron.vite.config.ts`
- Evidence: `packages/desktop/electron.vite.config.ts` (manualChunks comments)

### Prefer OpenCode over aionrs as the default assistant selection

- Status: accepted
- Decision: `pickDefaultAssistantSelectionKey` selects an OpenCode assistant when present, falling back to aionrs; an OpenCode row whose `agent_status` is explicitly `missing` or `offline` is skipped, while `unchecked`/undefined still qualifies.
- Rationale: Product preference for the OpenCode agent as the out-of-box default; the engine seeds the OpenCode row enabled whether or not the binary exists, so `enabled` alone would default a user onto a dead agent, but punishing a not-yet-probed agent would break cold starts.
- Affects: `packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts`
- Evidence: `tests/unit/renderer/guidAgentSelection.test.ts`

### Rebrand as Pavii.Ai with a clean identity break

- Status: accepted
- Decision: Product identity is Pavii.Ai (appId `com.pavii.ai`, executable `PaviiAi`, scheme `pavii://`, data dirs `~/.pavii*`, workspaces `@pavii/*`, CLI `pavii-web`, publisher Team Pavii <info@pavii.tech>, links to `https://www.pavii.tech/products/Super-Assistant/`); no migration from AionUi identifiers.
- Rationale: Fork has no installed user base; a clean break avoids migration code (YAGNI).
- Affects: `packages/desktop/electron-builder.yml`
- Evidence: `package.json`, `packages/desktop/src/process/startup/windowsAppUserModelId.ts`, `packages/desktop/src/process/utils/deepLink.ts`

### Remove the Appearance settings tab but keep theme data app-wide

- Status: accepted
- Decision: The Appearance settings tab and its UI (`AppearanceModalContent`, `AppearanceSettings/index.tsx`, CSS-theme components) are removed; `/settings/appearance` and `/settings/display` redirect to `/settings/system`; `AppearanceSettings/presets`, `presets.ts`, and `themeCovers.ts` remain as app-wide theme data consumed by `packages/desktop/src/renderer/theme/builtinThemes.ts`.
- Rationale: Product decision to drop the settings surface; the theme presets are still runtime data for the whole app, not tab-local UI.
- Affects: `packages/desktop/src/renderer/pages/settings/AppearanceSettings/`
- Evidence: `packages/desktop/src/renderer/components/layout/Router.tsx`

### Remove the Desktop Pet feature completely

- Status: accepted
- Decision: All pet code is deleted: renderer settings tab/page and pet windows (`renderer/pet/`), main `process/pet/` managers, the three pet preloads, `public/pet-states` assets, the `pet` i18n namespace (13 locales plus its `i18n-config.json` module entry), the four `pet.*` config keys, the tray pet submenu, the `petNotifyHook` seam in `packages/desktop/src/common/adapter/main.ts`, the installer-integrity `missingPetStatesDir` sentinel (`backendStartupFailure.ts`, `electron.ts`, `sentry.ts`), and the pet inputs in `packages/desktop/electron.vite.config.ts`; `/settings/pet` redirects to `/settings/system`; `bugReportModuleDisplaySettings` copy was reworded (the `display-desktop` feedback tag is kept).
- Rationale: Product decision to drop the feature entirely; the redirect preserves old deep links, and the feedback tag is a persisted contract.
- Affects: `packages/desktop/src/`
- Evidence: `packages/desktop/src/renderer/components/layout/Router.tsx`

### Renderer keeps last-known slash commands on fetch errors

- Status: accepted
- Decision: The fetch-error path in `useSlashCommands` no longer clears the command list — the last-known commands (per-conversation LRU cache) stay on screen; a genuinely empty successful response still clears, and switching conversations re-seeds from the cache keyed by the new id.
- Rationale: A transient fetch failure or pre-warmup 404 blanked the menu even though the cache still held a good list; keeping stale-but-real commands matches `useAcpMessage`'s existing keep-on-error policy.
- Affects: `packages/desktop/src/renderer/hooks/chat/useSlashCommands.ts`
- Evidence: `tests/unit/renderer/useSlashCommands.dom.test.ts`

### Sign-in hand-off prefers a loopback callback over the pavii:// deep link

- Status: accepted
- Decision: The `paviiAuth.signIn` IPC provider starts a single-use `127.0.0.1` ephemeral-port HTTP listener and passes `http://127.0.0.1:<port>/auth` as the login redirect target; the website delivers the Firebase ID token by same-machine fetch (query param). `pavii://auth` (fragment token) is the fallback when the listener cannot start, and the deep-link handler still works; both paths converge on the shared `completeAuthSignIn` in `packages/desktop/src/process/utils/deepLink.ts` (returns boolean). Token verification stays main-process only.
- Rationale: Browsers can silently refuse to launch the `pavii://` custom scheme (stale protocol-handler caches, observed in Chrome despite a correct HKCU registration); loopback is exempt from mixed-content blocking and lets the success page stay open.
- Affects: `packages/desktop/src/process/bridge/applicationBridge.ts`, `packages/desktop/src/process/services/paviiAuthCallbackServer.ts`
- Evidence: `tests/unit/process/services/paviiAuthCallbackServer.test.ts`

### Slack/Discord are app-hosted main-process bridges, not engine channels

- Status: accepted
- Decision: aioncore has no Slack/Discord support and extension `channelPlugins` are metadata-only (no JS runtime; `webui.apiRoutes` never mounted), so both run as main-process bridges in `packages/desktop/src/process/services/channels/`: `backendConversationClient.ts` (unauthenticated `127.0.0.1` HTTP plus a `/ws` `turn.completed` listener), `slackBridge.ts` (Socket Mode via `apps.connections.open` + ws, DM/app_mention handling, per-channel conversation mapping, `chat.postMessage` replies, reconnect), `discordBridge.ts` (Gateway ws from `GET /gateway/bot`: hello/heartbeat/identify with GUILDS+GUILD_MESSAGES+MESSAGE_CONTENT+DIRECT_MESSAGES intents, DM/@mention handling, 2000-char chunked REST replies, reconnect; REST base overridable via `PAVII_DISCORD_API_BASE`), and `channelStore.ts` (`pavii-channels.json` in the config dir: credentials/enabled/conversation map, local-only); both restore on boot from `markBackendReady` in `packages/desktop/src/index.ts` and are exposed via the `paviiChannels` IPC namespace (`getStatus`/`enable`/`disable`) in `packages/desktop/src/common/adapter/ipcBridge.ts` with providers in `packages/desktop/src/process/bridge/applicationBridge.ts` and renderer `SlackConfigForm.tsx`/`DiscordConfigForm.tsx` guided cards.
- Rationale: The engine trusts its local process (spawned with `--local`), so the bridge talks to it unauthenticated over loopback; hosting bridges in the app avoids carrying a chat-platform runtime inside the engine tree.
- Affects: `packages/desktop/src/process/services/channels/`
- Evidence: `tests/unit/process/channels/`

### Slash skill picks load through inject_skills, resolved at send time

- Status: accepted
- Decision: Picking a skill in the "/" menu is remembered per composer (a ref in `AcpSendBox.tsx` / `AionrsSendBox.tsx`, cleared on every send) and turned into the send payload's structured `inject_skills` field by `resolvePendingInjectSkills`; inserting `/name ` as text stays, but is no longer the mechanism. The token must still be present in the outgoing message (deleting it cancels the load), skills already in `conversationContext.loadedSkills` are dropped, and the function returns `undefined` rather than `[]` so ordinary messages keep their existing payload shape.
- Rationale: No agent resolves a skill from a `/` prefix — skills reach the engine only through `inject_skills`, which was plumbed through `ipcBridge` but never set by any renderer code, so every pick was inert. Re-checking the token at send time rather than at pick time is what makes deletion mean "cancel"; excluding loaded skills avoids paying their prompt cost twice. Skill names are RegExp-escaped before matching because a name such as `a[b` would otherwise throw and take down the whole send path, not just injection.
- Affects: `packages/desktop/src/common/chat/slash/injectSkills.ts`
- Evidence: `tests/unit/chat/injectSkills.test.ts`

### Slash display order is separate from slash collision precedence

- Status: accepted
- Decision: `orderSlashCommandsForDisplay` ranks the merged list acp > builtin > skill (stable within each group) and is applied on top of `mergeSlashCommands`, which keeps the opposite precedence for name collisions (builtin > acp > skill). The two functions stay separate by design.
- Rationale: They answer different questions. Collision precedence must keep builtin first so a skill cannot shadow `/copy`; display order must put the agent's own commands first because that is what users look for. Folding one into the other would either run the wrong command or order the menu wrongly.
- Affects: `packages/desktop/src/common/chat/slash/mergeSlashCommands.ts`
- Evidence: `tests/unit/chat/mergeSlashCommands.test.ts`

### Slash menu skills come from the assistant's capabilities, not the session

- Status: accepted
- Decision: `useAssistantSlashSkills` derives the menu's skill entries from the conversation assistant's `capabilities.default_skill_ids` + `custom_skill_names`, minus `default_disabled_builtin_skill_ids`, unioned with `conversationContext.loadedSkills` after the subtraction; auto-inject skills are filtered out unless this session loaded them, and while the skills index is still loading the candidates are shown rather than an empty list.
- Rationale: The old source was `loadedSkills` alone, which is empty in almost every session, so the skills half of the menu looked broken. Reading `capabilities.default_*` matches how `useAssistantEditor` derives the same set, so the menu agrees with Settings instead of inventing its own notion of "enabled" (`preferences.last_*` is the previous session's picks and would not). Subtracting last makes an explicit "off" switch win; keeping loaded skills after the subtraction keeps what is live in the session offered. Auto-inject skills already apply to every turn, so listing them only pushes real choices off screen.
- Affects: `packages/desktop/src/renderer/hooks/chat/useAssistantSlashSkills.ts`
- Evidence: `tests/unit/renderer/hooks/useAssistantSlashSkills.dom.test.tsx`

### Skill rebranding is display-only via display_name; raw names stay backend keys

- Status: accepted
- Decision: `fs.listAvailableSkills` and `fs.readSkillInfo` are wrapped with `brandSkills`/`applySkillBranding` (`packages/desktop/src/common/utils/skillBranding.ts`): each row gains a `display_name` (prefix rules `officecli-`→`pavii-cli-`, `aionui-`→`pavii-`) and a rebranded description (brand scrub plus English overrides for the Chinese-described builtins `x-recruiter`, `xiaohongshu-recruiter`, `weixin-file-send`); the raw `name` is never rewritten because enable/delete/materialize/slash commands and `enabled_skills`/`skill_ids` all key on it. UI surfaces render `display_name ?? name` (SkillsHubSettings, SkillDetailPage, AssistantEditorSections labels, GuidActionRow skill submenu); in-chat slash surfaces keep raw names since the name is the command.
- Rationale: Skill names are engine contracts inside aioncore; a display-only field rebrands every list surface without breaking round-trips.
- Affects: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Evidence: `tests/unit/common/skillBranding.test.ts`

### PostHog analytics is always on, with the privacy guarantee in one scrub function

- Status: accepted
- Decision: The app reports product usage to PostHog EU from both processes on every launch, for every install, with **no consent prompt and no user-facing opt-out** (an explicit product-owner decision). The public project key is a literal in `common/analytics/config.ts`; `POSTHOG_KEY` overrides and `POSTHOG_DISABLED=1` disables, both build-time only. Autocapture runs in allowlist mode (`css_selector_allowlist: ['[data-ph-capture]']`) with `mask_all_text` and `mask_all_element_attributes`, pageviews are emitted manually from `PostHogRouteTracker` because the app is a HashRouter, and every event passes `scrubEvent` before leaving.
- Rationale: This app's DOM is the user's private data, and the packaged build loads the renderer over `file://`, so PostHog's own `$current_url` / `$pathname` / `$initial_pathname` would carry the OS user name on every event. Config cannot cover that — `before_send` is the only hook that also reaches `$set` and `$set_once`, where `$initial_*` is persisted — so the scrub is the guarantee and it fails closed, dropping the event on any throw. Autocapture hardened this way is functionally curated events; that trade was made knowingly to keep a denylist from failing open when new UI lands.
- Affects: `packages/desktop/src/common/analytics/scrub.ts`
- Evidence: `tests/unit/analytics/scrub.test.ts`, `docs/agent-context/privacy-audit.md`

### Skills page is one categorised page, official content first

- Status: accepted
- Decision: The Skills page no longer has Custom/Official tabs. One page stacks Official skills, Extension skills, Auto-injected skills, then the user's own imports, and the Official and user lists render grouped under topic headings from a curated name-to-category map (`skillCategories.ts`); auto-injected and extension sections stay flat. Unmapped names fall back to `other`, and `SkillDetailPage` navigates back to `/settings/skills` with no tab state.
- Rationale: The catalog is ~117 categorisable entries (19 built-in folders plus the 98-skill bundled pack), unreadable as two flat lists, and the tab split hid official content behind a click. Inference from names/descriptions was rejected as silently miscategorising; a committed map is testable, and a table test over the shipped built-in folders and `BUNDLED_SKILL_NAMES` fails if a new skill is left unmapped.
- Affects: `packages/desktop/src/renderer/pages/settings/SkillsSettings/skillCategories.ts`
- Evidence: `tests/unit/skills/skillCategories.test.ts`, `tests/unit/skills/SkillsHubSettings.dom.test.tsx`

### Ship a curated skill pack and import it once per install at startup

- Status: accepted
- Decision: `resources/bundled-skills/` ships `token-optimizer/` (the MIT "caveman" skill rewritten with Token Optimizer identity; original MIT notice kept in its `LICENSE`), `mattpocock/` (35 MIT skills mirrored in upstream category layout with upstream `LICENSE`), and `ecc/` (62 of the 286 MIT skills from github.com/affaan-m/ECC, flat as upstream, with upstream `LICENSE`); electron-builder copies it via `extraResources` (`bundled-skills`); `packages/desktop/src/process/startup/ensureBundledSkills.ts` runs from `markBackendReady`, resolves the dir (`process.resourcesPath` first, repo `resources/` in dev), and POSTs each skill folder to `/api/skills/import`, recording names in `pavii-bundled-skills.json` in the config dir so a user's deletion is never re-imported; `token-optimizer` is default-enabled client-side in `resolveGuidAssistantDefaults` (`DEFAULT_ENABLED_SKILL_IDS`) only while `preferences.last_skill_ids` is unset, so deselecting sticks.
- Rationale: The engine's builtin-skill corpus and skills market are closed (hardcoded to the upstream repo), so curated skills must ship in the app and enter through the public import endpoint; the marker file separates "never imported" from "user deleted".
- Affects: `resources/bundled-skills/`
- Evidence: `tests/unit/process/startup/ensureBundledSkills.test.ts`, `tests/unit/renderer/assistantDefaults.test.ts`

### No upstream-vendor update endpoint (privacy)

- Status: accepted
- Decision: The update feed has **no default**. `updateFeed.ts` reads `PAVII_UPDATE_FEED_URL` (unset => `buildCdnFeedOptions()` returns null, `isUpdateFeedConfigured()` false) and `updateBridge.ts` has `DEFAULT_REPO = ''` with `AIONUI_GITHUB_REPO` as the only source; the CDN host/base resolve per call and the download-host allowlist only admits the configured host plus GitHub asset hosts. Startup notify, manual check, and CDN manifest fetch all early-return/throw when unconfigured, so a stock build makes zero update requests.
- Rationale: The fork previously shipped `static.aionui.com` + `iOfficeAI/AionUi` defaults, which leaked install IP/version/launch timing to the upstream vendor on every launch and could have served their binary as an update to a Pavii install.
- Affects: `packages/desktop/src/process/services/updateFeed.ts`, `packages/desktop/src/process/bridge/updateBridge.ts`
- Evidence: `tests/unit/bootstrap/noVendorUpdateEndpoint.test.ts`, `tests/unit/process/services/cdnUpdateFeed.test.ts`

### Removed builtin content is filtered at the display layer for existing installs

- Status: accepted
- Decision: `x-recruiter` / `xiaohongshu-recruiter` skills and the `social-job-publisher` assistant were deleted from the engine source, and the bundled Pavii skill pack (`BUNDLED_SKILL_NAMES`) is display-tagged `display_source: 'official'` so it renders on the Skills tab's Official section instead of "My Skills". Because the engine indexes builtin skills/assistants into its database and never prunes rows whose source folders disappear, `brandSkills`/`brandAssistants` also filter the removed ids for installs created before the removal.
- Rationale: An engine rebuild cannot retroactively clean existing user databases; filtering at the single display choke point covers every install without a migration.
- Affects: `packages/desktop/src/common/utils/skillBranding.ts`, `packages/desktop/src/common/utils/assistantBranding.ts`
- Evidence: `tests/unit/common/skillBranding.test.ts`, `tests/unit/common/bundledSkillNames.test.ts`

### OS-level identity is owned by packaging config plus an embedded engine resource

- Status: accepted
- Decision: The packaged app's OS identity comes from electron-builder (`productName: Pavii.Ai` → Windows FileDescription/ProductName, macOS CFBundleName/DisplayName), extended with `mac.extendInfo` (CFBundleDisplayName, NSHumanReadableCopyright, NSMicrophoneUsageDescription) and a corrected Linux desktop entry (`StartupWMClass: Pavii.Ai` for dock association, `Icon: PaviiAi` matching the installed hicolor basename, AppImage beside deb). The **engine** process — the one Windows firewall dialogs name — carries its own version-info resource embedded via `winresource` in `the-remaa/AionCore/crates/aionui-app/build.rs` (FileDescription "Pavii.Ai Engine", CompanyName "Team Pavii", Pavii icon). Dev runs register a stable `com.pavii.ai.dev` AUMID instead of `process.execPath`; the dev process is still `electron.exe` (unavoidable outside packaging).
- Rationale: Identity must hold for every process the OS surfaces separately; the engine is a top-level process, not an Electron child, so packaging metadata never reaches it.
- Affects: `packages/desktop/electron-builder.yml`
- Evidence: `tests/unit/bootstrap/osIdentityConfig.test.ts`, `tests/unit/process/startup/windowsAppUserModelId.test.ts`

### The hub catalog is branded on the way to the screen

- Status: accepted
- Decision: `useHubAgents` runs `scrubBrandText` over each hub extension's `description` and `author` before the UI renders them. `name`, `engines.aionui` and `contributes` are install-time contracts and stay raw.
- Rationale: `resources/hub/index.json` is re-downloaded from the upstream hub by `scripts/prepareHubResources.js` on every build, so editing the checked-in copy would not survive. Every entry ships an author of "Aionui Official" and a description ending "... as an ACP adapter in AionUi.", and `AgentHubModal` renders the description verbatim. The scrub rule was also widened from `AionU[iI]` to `Aion[Uu][iI]`, which is what had let the lowercase-u spelling through; the leading capital stays deliberate because all-lowercase `aionui` is the identifier form.
- Affects: `packages/desktop/src/renderer/hooks/agent/useHubAgents.ts`, `packages/desktop/src/common/utils/assistantBranding.ts`
- Evidence: `tests/unit/renderer/hubAgentBranding.test.ts`

### The locally built engine is pinned against upstream re-download

- Status: accepted
- Decision: `resources/bundled-paviicore/<key>/manifest.json` carries `sourceType: 'local-source-build'`; `packages/shared-scripts/src/prepare-paviicore.js` returns that bundle untouched instead of downloading, prefers an explicitly supplied `AIONUI_BACKEND_LOCAL_BINARY` before GitHub release downloads, and a bundle that fails `verifyPreparedPaviicoreBundle` **throws** rather than falling back to the upstream download. `build-win:x64:fast` no longer passes `--config.win.signAndEditExecutable=false` (that flag shipped an exe with Electron's stock metadata/icon); the failure-retry path keeps the flag but warns the artifact is not shippable.
- Rationale: Packaging previously re-downloaded the upstream engine on every build, and release CI could also download the upstream engine after building Pavii Engine locally, silently stripping Pavii-specific rebrand and migrations from shipped installers.
- Affects: `packages/shared-scripts/src/prepare-paviicore.js`
- Evidence: `tests/unit/bootstrap/osIdentityConfig.test.ts`

### The shipped resources tree holds exactly one target's binaries

- Status: accepted
- Decision: electron-builder copies whole `extraResources` directories, so both bundle preparers now scope `resources/` to the target being built. `prepare-opencode.js` deletes bundles for other runtime keys; `prepare-paviicore.js` **moves** them to `resources/.paviicore-cache/<key>/` and restores them when that target is next built.
- Rationale: Neither preparer removed the previous target's output, so a machine that built two arches shipped both inside each installer — ~170 MB for OpenCode and ~939 MB for the engine, none of it executable on the receiving machine. The delete/move asymmetry is deliberate: OpenCode is re-fetchable from the npm registry, while an engine bundle whose manifest reads `local-source-build` was compiled from vendored AionCore source, carries the Pavii rebrand, and can only be rebuilt (see "The locally built engine is pinned against upstream re-download"). Both calls sit at the top of their preparer so every exit path is covered, including the local-source-build early return and the unsupported-arch return — the latter must ship nothing rather than another platform's binary.
- Affects: `packages/shared-scripts/src/prepare-paviicore.js`
- Evidence: `tests/unit/assets/prepareOpencode.test.ts`, `tests/unit/assets/preparePaviicoreBundleStash.test.ts`

### One architecture per build invocation, enforced

- Status: accepted
- Decision: `scripts/build-with-builder.js` exits 1 when more than one architecture is requested, naming the per-arch scripts; `build-mac` and `build` chain `build-mac:arm64 && build-mac:x64` instead of passing both flags at once.
- Rationale: The script only ever staged `archArgs[0]`, so a multi-arch invocation packaged an app whose second arch had no engine. Staging both in one pass is not a fix: `AIONUI_BACKEND_LOCAL_BINARY` is a single path with no arch information, so looping `preparePaviicore` would copy one engine into both bundle directories (an arm64 engine inside the x64 installer), and without that variable the second arch silently downloads the upstream AionCore engine, stripping the rebrand. Both outcomes package successfully and fail in the user's hands, so refusing is the only safe behaviour. `.github/workflows/_build-reusable.yml` already mandates one job per platform+arch for the same reason.
- Affects: `scripts/build-with-builder.js`
- Evidence: `tests/unit/bootstrap/buildWithBuilder.test.ts`

### OpenCode PATH registration lives in web-host and serves both distributions

- Status: accepted
- Decision: `ensureOpencode.ts` moved from the desktop main process to `packages/web-host/src/ensure-opencode.ts` and is exported from the package index. `startWebHost` registers PATH before `startBackend`; the Electron main process keeps its own pre-spawn call. `scripts/pack-web-cli.js` stages and copies the binary into the `pavii-web` tarball, tolerating an arch with no published binary via the `unsupported` flag on `prepareOpencode`'s result.
- Rationale: The desktop installer bundled OpenCode while the `curl | bash` web distribution shipped none, so `pavii-web` users had a default agent that only worked if they already had OpenCode. The helper imports nothing but node builtins, and web-host is the only package both `@pavii/desktop` and `@pavii/web-cli` depend on, so moving it there adds no dependency edge and drags neither runtime into the other. Registration mutates `process.env` rather than a constructed env object because `buildSpawnEnv` passes `process.env` through by reference when no `dirs` are supplied. `skipped` on `prepareOpencode` was ambiguous — a cache hit also skips — hence the separate `unsupported` flag for callers that copy the bundle elsewhere.
- Affects: `packages/web-host/src/ensure-opencode.ts`
- Evidence: `packages/web-host/src/start-web-host.test.ts`, `packages/web-host/src/ensure-opencode.test.ts`

### The About page carries the analytics disclosure

- Status: accepted
- Decision: `readme.md` states what analytics are actually collected, and `AboutModalContent.tsx` repeats it in-app as inline text behind i18n keys `settings.analyticsNotice*`.
- Rationale: The README previously claimed the app ships "no analytics or telemetry" while PostHog shipped in every build — the repository's only public privacy statement, and false. The notice is inline rather than a link because this repository is private (a GitHub link 404s for users) and the marketing site has no privacy page. Two details the copy must keep: `identify()` links events to a Pavii account id once signed in, so the id is not purely per-install; and `POSTHOG_DISABLED` is a build-time Vite define, so there is genuinely no in-app opt-out.
- Affects: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx`
- Evidence: `tests/unit/settings/AboutModalContent.dom.test.tsx`, `readme.md`

### app.asar is verified against its own header at pack time

- Status: accepted
- Decision: `verifyAsarIntegrity` in `scripts/afterPack.js` (exported for tests) parses the packed `app.asar` header and reads three things at their recorded offsets before anything else in `afterPack` runs: `package.json` must parse as JSON, the `main` script must match its header sha256, and the **final** packed entry must match its own hash. Any mismatch throws and the build fails. Consequent operational constraint: **do not edit the working tree while a packaging build is running.**
- Rationale: electron-builder stats+hashes every file to build the header, then streams contents in a second pass; a source file edited between the two passes makes the header disagree with the archive and displaces every later entry. Such a build packages and code-signs cleanly and is completely dead — Electron reads `package.json` at the recorded offset, gets unrelated JavaScript, and exits 1 in bootstrap with no stdout/stderr (GUI-subsystem exe) and nothing written to userData. `EnableEmbeddedAsarIntegrityValidation` is deliberately off (see the fuse comment in `scripts/afterPack.js`), so there is no runtime validation either and pack time is the only place this is catchable. The boot path plus the tail is the chosen coverage because displacement anywhere propagates to the last entry; hashing all ~40k entries would be too slow to run on every build.
- Affects: `scripts/afterPack.js`
- Evidence: `tests/unit/bootstrap/asarIntegrityGuard.test.ts`

### Token statistics come from a local per-day usage ledger

- Status: accepted
- Decision: The backend keeps only a last-snapshot token usage per conversation, so lifetime stats are not reconstructible from it; a main-process service `packages/desktop/src/process/services/usageLedger.ts` (`usage-ledger.json` in the config dir, debounced writes, corrupt-file tolerant) accumulates per-turn frames recorded best-effort from `useAionrsMessage` (finish frame) and `useAcpMessage` (end-of-turn `_meta` counters), exposed via the `paviiUsage` IPC namespace (`record`/`get`) in `packages/desktop/src/common/adapter/ipcBridge.ts` with providers in `packages/desktop/src/process/bridge/applicationBridge.ts`.
- Rationale: Lifetime/per-day stats require local accumulation; stats therefore start from the first launch of this build.
- Affects: `packages/desktop/src/process/services/usageLedger.ts`
- Evidence: `tests/unit/process/services/usageLedger.test.ts`

### TUI-only slash commands get app equivalents only where a real action exists

- Status: accepted
- Decision: The shared SendBox adds two builtin commands executed by the app instead of inserted as text: `/new` navigates to `/guid` with `resetAssistant` (the sider new-conversation button's exact navigation) and `/agents` navigates to `/assistants`. The remaining TUI-only commands OpenCode shows in its own terminal UI (`/exit`, `/move`, `/variants`, `/status`, and the rest) are not exposed over ACP and get no fake entries.
- Rationale: Users expect these commands from the agent's TUI, but no client can invoke them remotely; mapping only the two with real app actions avoids dead menu entries. `useNavigate` in the shared SendBox requires a Router, so test harnesses that render it without one must stub the hook (two pre-existing harnesses do).
- Affects: `packages/desktop/src/renderer/components/chat/SendBox/index.tsx`
- Evidence: `tests/unit/renderer/conversation/sendBoxSlashBuiltins.dom.test.tsx`, `tests/unit/renderer/conversation/SendBoxCronPrefill.dom.test.tsx`, `tests/unit/renderer/conversation/sendBoxActiveFocus.dom.test.tsx`

### Website Google sign-in uses the GIS token flow, not signInWithPopup

- Status: accepted
- Decision: The website login page uses the Google Identity Services token flow plus Firebase `signInWithCredential` for Google sign-in; GitHub/SAML still use `signInWithPopup` and remain broken until a planned `auth.pavii.tech` Firebase Hosting custom domain becomes the authDomain.
- Rationale: The page origin `www.pavii.tech` vs authDomain `pavii-ai3.firebaseapp.com` is cross-site, and Chrome storage partitioning breaks the popup handler handoff; the embedded Google Web client ID is a public identifier.
- Affects: `.workspaces/fluffy-lamp/src/pages/login.astro`
- Evidence: commit `dcffe50` in `vjk7989/fluffy-lamp`

### Each sign-in provider is a separate account, even with the same email

- Status: accepted
- Decision: Firebase Authentication → Settings → User account linking is "Create multiple accounts for each identity provider". Google, GitHub and email/password sign-ins with the same email are separate Firebase users with separate UIDs; the login page does no account linking. The GitHub OAuth App (`pavii-ai3`, owner `buckleson`) lists `https://pavii-ai3.firebaseapp.com/__/auth/handler` as a redirect URI next to `https://www.pavii.tech/`.
- Rationale: Product decision (Oct 19, 2026): a user signing in with a different provider must get a different account. The default "link accounts that use the same email" mode rejected GitHub with `auth/account-exists-with-different-credential`. The desktop app keys the session on the token's UID (`paviiAuth.ts`), not the email.
- Affects: Firebase project `pavii-ai3` and GitHub OAuth App settings (outside the repo); `.workspaces/fluffy-lamp/src/pages/login.astro`
- Evidence: website commit `f070fa0` added linking and `9847d75` removed it; a missing redirect URI had caused GitHub's "redirect_uri is not associated" page.

### Windows in-app updates are silent and differential

- Status: accepted
- Decision: Windows in-app update installs pass the silent NSIS flag to `electron-updater`, and Windows release jobs must publish `.exe.blockmap` assets for both x64 and arm64 before either the primary or mirror GitHub Release is updated.
- Rationale: In-app updates should behave like updates instead of a fresh visible installer, while manual website downloads remain normal visible installers.
- Affects: `packages/desktop/src/process/services/autoUpdaterService.ts`
- Evidence: `packages/desktop/electron-builder.yml`, `.github/workflows/_build-reusable.yml`, `.github/workflows/release.yml`, `tests/unit/releasePackagingConfig.test.ts`

### The in-app updater reads the public releases mirror

- Status: accepted
- Decision: The update feed points at the public `buckleson/Pavii-Gui-Releases` mirror rather than the source repository, and the Windows settle-poll after an update runs only in packaged Windows builds.
- Rationale: The source repo is private, so an unauthenticated updater got 404s and no install could ever see a new version; the mirror is public by design. The settle-poll is a packaged-Windows concern only, and running it elsewhere produced spurious dev-mode work.
- Affects: `packages/desktop/src/process/services/updateFeed.ts`
- Evidence: commits `4330784`, `f81b2d1`; `tests/unit/bootstrap/noVendorUpdateEndpoint.test.ts`

### An update that fails restores the previous installation

- Status: accepted
- Decision: The NSIS update path is transactional — it snapshots the existing install, and a failed replacement rolls back instead of leaving a half-removed directory; silent updates retry locked files; installations not written by this product are never touched; the registry entry survives a failed replacement.
- Rationale: A user hit a cascade where a failed atomic replace destroyed a working install and then the registry entry pointed at nothing, leaving the app unlaunchable and un-repairable (E1003 then E1010). Cleanup that can delete a working install must be reversible.
- Affects: `packages/desktop/build/installer/`
- Evidence: commit `2c636e4`; `scripts/smoke-installer-rollback.js`, `scripts/build-with-builder.js`

### Chat markdown renders in a shadow root, so every class ships with it

- Status: accepted
- Decision: Inline media cards (images, file chips, copy-path buttons) declare their styles in `ShadowView`'s own stylesheet under `pavii-inline-*`, not as UnoCSS utilities or Arco component classes.
- Rationale: Chat markdown renders inside a shadow root where UnoCSS utilities and Arco styles do not exist. A card styled with utility classes renders unstyled there — this is what produced the oversized image with its caption overlapping.
- Affects: `packages/desktop/src/renderer/components/Markdown/ShadowView.tsx`
- Evidence: commit `21dcd41`; `packages/desktop/src/renderer/components/media/InlineImageCard.tsx`, `InlineFileChip.tsx`

### Attachments are copied into the workspace and keep their path in the prompt

- Status: accepted
- Decision: Files and images attached in chat are copied into the agent's workspace as real readable files, and an image's path stays in the prompt text alongside the native media block.
- Rationale: The agent CLI reads from disk; a native media block alone gave it pixels but no file it could open, so "read this file" failed. Stripping the path once the image rode as a native block removed the only handle the CLI had.
- Affects: `the-remaa/AionCore/crates/aionui-conversation/`
- Evidence: commits `e3e4d3c`, `7a182c9`, `15a6e12`; `resolve_chat_message` takes 5 params — grep the whole workspace for call sites before changing that signature

### A failed MCP check reports the engine's reason, never a guess

- Status: accepted
- Decision: The MCP row persists `last_test_error` / `last_test_error_code` from the engine and renders that; name-matched guesses are gone, timeouts say so, and the connect budget is 90s.
- Rationale: The UI printed "Missing npx on this machine" purely because the server was named `chrome-devtools`. Verified from this machine's engine log: the same server had connected with 29 tools in 8.7s, and the failure was a 30s timeout with npx present — a cold `npx -y …@latest` fetches a dependency tree before it can answer.
- Affects: `packages/desktop/src/renderer/pages/settings/ToolsSettings/McpServerHeader.tsx`
- Evidence: commit `a7f3b86`; `packages/desktop/src/common/config/storage.ts`

### Everything the agent is told about carries a Pavii name

- Status: accepted
- Decision: Runtime context is exported under `PAVII_*` names alongside the original `AIONUI_*` ones, all four capabilities commands advertise the Pavii names, and every shipped skill instructs with them.
- Rationale: The display-layer choke point brands what the UI renders, but not prose the agent writes itself. Skills told it to run `$AIONUI_HELPER_BIN …`, so it quoted the pre-rebrand name back to the user. The old names stay exported — they are a live contract for user scripts.
- Affects: `the-remaa/AionCore/crates/aionui-ai-agent/src/types.rs`
- Evidence: commits `282b3b6`, `bd9d24e`; `tests/unit/renderer/brandLeakGuard.test.ts` — an agent-facing name that is advertised but not exported is worse than the leak

### Agent binaries are probed under the name that exists on every platform

- Status: accepted
- Decision: A builtin agent's `command` must name a binary present on all supported platforms; Kiro is probed as `kiro-cli`, not the Unix-only `kiro-cli-chat`.
- Rationale: Availability resolves a single name against PATH with no alias fallback, so a platform-specific name makes the agent permanently undetectable there. Kiro's Windows installer ships one executable, `kiro-cli.exe`, which is itself the chat binary.
- Affects: `the-remaa/AionCore/crates/aionui-db/migrations/041_kiro_cli_windows_command.sql`
- Evidence: commit `b0ee834`; a rename alone is inert — the cached projection treats a stored `command_not_found` as still-missing and blocks the fresh probe, so the migration also drops the verdict it invalidates

### An install that cannot fit on disk is refused before anything is touched

- Status: accepted
- Decision: `AIONUI_ASSERT_FREE_SPACE` runs at the top of `customRemoveFiles` and raises E1020 below 1536 MB free, measured with `AvailableFreeSpace` so per-user quotas count; it fails OPEN when the probe returns nothing.
- Rationale: E1020 was declared for months and never raised — nothing measured disk — so a full disk surfaced as E1010 "could not extract", which reads as a corrupt download and sends the user to re-download instead of freeing space. On an update that failure lands after the snapshot rename, costing the user a working install.
- Affects: `resources/windows/installer-errors-sentry.nsh`
- Evidence: commit `7727d98`; threshold set against a measured 1022 MB payload; `scripts/smoke-installer-disk-gate.js`

### The desktop shortcut is recreated from our own customInstall, not by electron-builder

- Status: accepted
- Decision: `AIONUI_ENSURE_DESKTOP_SHORTCUT` in `customInstall` creates the shortcut only when absent, naming it `${SHORTCUT_NAME}` and pointing at `${APP_EXECUTABLE_FILENAME}`.
- Rationale: `createDesktopShortcut: true` creates on fresh/manual install and does nothing on auto-update, because `allowToChangeInstallationDirectory` makes `keepShortcuts` true only when `${isUpdated}`, and the template's `CreateShortCut` sits behind `keepShortcuts == "false"`. **Raising it to `"always"` does not help**: that branch needs `keepShortcuts == "true"` yet is guarded by `${ifNot} ${isUpdated}` — mutually exclusive, dead code here. Creating only when absent is deliberate; recreating always would resurrect an icon the user deleted on purpose.
- Affects: `resources/windows/installer-update-verify.nsh`
- Evidence: commit `05c18b0`; `${SHORTCUT_NAME}` ("Pavii.Ai") and `${PRODUCT_FILENAME}` ("PaviiAi", from `executableName`) differ and the uninstaller only deletes the former, so the other name orphans an icon; verified on the official 2.2.7 installer, log showing `result=kept` and `result=created updated=1`

### The Linux .desktop Categories can only be set through linux.category

- Status: accepted
- Decision: set `linux.category`; never put `Categories` under `desktop.entry`.
- Rationale: electron-builder writes `desktopMeta.Categories` from `linux.category` _after_ merging `desktop.entry`, so the latter is silently discarded — the app shipped `Categories=Utility;` while the config asked for Office too. `deb.depends` is now declared explicitly for the same reason: an inherited default can change under us.
- Affects: `packages/desktop/electron-builder.yml`
- Evidence: commit `05c18b0`; `LinuxTargetHelper.computeDesktopEntry`

### The site CSP is delivered as meta and must be validated on every page

- Status: accepted
- Decision: the policy lives once in `.workspaces/fluffy-lamp/src/config/csp.mjs` and is injected twice — `MainLayout` for marketing pages and Starlight's `head` for docs. Any change is validated by loading **every page type** and watching for `securitypolicyviolation`.
- Rationale: GitHub Pages cannot send custom headers, so `vercel.json` was inert and the live site had no security headers at all. The first policy was written from the dev-tools page's origins and applied site-wide, which **blocked `accounts.google.com/gsi/client` and took Google sign-in down on both the website and the desktop app** (the app opens `/login` in a browser — `paviiAuth.ts`). Static analysis cannot catch this class: the Firebase SDK builds its `googleapis.com` URLs at runtime.
- Affects: `.workspaces/fluffy-lamp/src/config/csp.mjs`
- Evidence: website commits `b2d8e76` (introduced), `1d9462c` (Google fixed), `8e1b92f` (GitHub/SSO fixed: Firebase `signInWithPopup` injects `apis.google.com/js/api.js` before opening the popup, a path Google sign-in never takes, so verifying Google alone missed it); auth-critical origins are `accounts.google.com`, `apis.google.com`, `identitytoolkit`/`securetoken.googleapis.com`, the Firebase authDomain, and loopback `localhost`/`127.0.0.1` for the desktop token hand-off — removing any one breaks sign-in. **Validate every sign-in provider**, not one.

### macOS app bundles are copied with ditto and re-registered with LaunchServices

- Status: accepted
- Decision: the published install command uses `ditto`, refreshes the icon cache (`touch` + `killall Dock`), and runs `lsregister` + `mdimport`.
- Rationale: three separate live failures, all from the shell-install path rather than the build. `cp -R` mishandles the symlinks in Electron's frameworks; replacing a bundle at a path that already held one leaves Finder/Dock/Launchpad showing the cached icon; and a Finder drag registers the app with LaunchServices while a script copy does not, so the app sits in `/Applications` invisible to Launchpad and Spotlight. The shipped `app.icns` was verified valid throughout.
- Affects: `.workspaces/fluffy-lamp/src/pages/products/[id].astro`
- Evidence: website commits `22387d6`, `9f4a11f`; ad-hoc `codesign` is load-bearing, not cosmetic — arm64 refuses to execute an unsigned binary and builds are ad-hoc signed only

### A builtin MCP server is injected only when its computed enabled flag is true

- Status: accepted
- Decision: selected **builtin** MCP rows are skipped when `enabled` is false; user-added rows keep "selected but disabled still injects".
- Rationale: for a builtin, `enabled` is computed (`switch === true && resolution.ok`), so false means no usable provider — the image-gen server could only fail. Skipping it lets Codex use its native, default-on image generation; a configured provider still wins for every agent. `prompt_capabilities.image` is deliberately not the gate (it means image _input_).
- Affects: `the-remaa/AionCore/crates/aionui-conversation/src/service.rs`, `packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts`
- Evidence: commit `e5d38ed`; `explicitly_selected_disabled_mcp_row_remains_injectable` still passes

### Side-effecting settings notify the main process over a real IPC provider

- Status: accepted
- Decision: the language-change side effects (tray relabel, main-process i18n) run on `notifyLanguageChanged`, an IPC provider beside `setCloseToTray`; persistence stays on the existing HTTP PATCH.
- Rationale: HTTP-backed bridge methods return `provider: () => {}`, so a handler registered on one (`systemSettings.changeLanguage`) is legal and never runs. The `languageChanged` wsEmitter call was removed because nothing publishes that event.
- Affects: `packages/desktop/src/common/adapter/ipcBridge.ts`, `packages/desktop/src/process/bridge/systemSettingsBridge.ts`
- Evidence: commit `fa1a8c4`; `tests/unit/process/systemSettingsLanguageBridge.test.ts` pins the channel, not just the behaviour

### Native module prebuilds are retried, and the source fallback uses pinned @electron/rebuild

- Status: accepted
- Decision: the prebuilt fetch retries with backoff; the fallback runs `@electron/rebuild` 4.2.0 from `node_modules` by file path with `--version`.
- Rationale: 2.2.8 windows-arm64 failed on one transient "No prebuilt binaries found". The old fallback (`bun x --yes electron-rebuild` 3.2.9) had never worked on CI: its `lzma-native` needs node-gyp 9, which imports `distutils`, gone in the runners' Python 3.12+.
- Affects: `scripts/rebuildNativeModules.js`
- Evidence: commit `fa1a8c4`; `tests/unit/bootstrap/nativeRebuildRetry.test.ts` (structural)

### Project context carries between agent sessions through pavii-context

- Status: accepted
- Decision: builtin auto-inject skill `pavii-context` makes the agent read and maintain `pavii-ard.md` and `pavii-hoff.md` in a project directory; in a team only the lead writes.
- Rationale: the role comes from the injected `Role: lead|teammate` line, with `paviicore team context` as tiebreaker (it returns 401 outside a team, so any non-zero exit means "not in a team"). Cadence and leader-only writing are prose instructions because no engine hook enforces them. Skipped in scratch temp workspaces.
- Affects: `the-remaa/AionCore/crates/aionui-app/assets/builtin-skills/auto-inject/pavii-context/SKILL.md`
- Evidence: commit `fa1a8c4`; `the-remaa/AionCore/crates/aionui-app/tests/pavii_context_skill.rs`

### Agent CLI update checks run in the main process, off the launch path

- Status: accepted
- Decision: `packages/desktop/src/process/agentCli/` checks catalog CLIs (claude, codex, gemini, opencode, kiro) against `registry.npmjs.org/<pkg>/latest` 30s after `did-finish-load` at most every 48h, on conversation start when a result is over 48h old, and from the Agents page button; updates run only after the user confirms.
- Rationale: user decision — notify plus one-click, never silent installs; "up to date" means the latest release, not the engine's pinned `VERIFIED_*_VERSION`. Update method is `npm install -g` only when the binary sits in `npm prefix -g`, else the CLI's own updater (verified from `--help`: `claude update`, `codex update`, `opencode upgrade`), else manual. Kiro's updater is unverified, so it is manual-only. Windows `.cmd` shims run through `cmd.exe` because `execFile` cannot execute them. The renderer cannot import the catalog, so `AGENT_CLI_UPDATE_BACKENDS` duplicates its backend list and a test pins the two together.
- Affects: `packages/desktop/src/process/agentCli/cliUpdateService.ts`, `packages/desktop/src/process/agentCli/scheduleAutoCheck.ts`, `packages/desktop/src/renderer/pages/settings/AgentSettings/AgentCard.tsx`
- Evidence: `tests/unit/process/agentCli/cliUpdateService.test.ts`, `tests/unit/process/agentCli/cliCatalog.test.ts`; outbound call recorded in `docs/agent-context/privacy-audit.md`

### A CLI installed after launch is found through an engine PATH override

- Status: accepted
- Decision: Test connection on a `missing` agent first posts the re-read user PATH to `POST /api/agents/refresh-path`, which sets a process-wide override used by `resolve_command_path` and `agent_process_env`, then re-probes the registry; a manual check that comes back online also `reload_one`s the cached registry entry.
- Rationale: the engine's PATH is fixed at spawn, so a CLI whose installer adds a new PATH folder stayed `command_not_found` until restart. The override avoids `std::env::set_var` (unsound with threads). `get_for_user` re-probes live, so the reload must key on the cached `registry.get(id)` entry, not on the probed `meta`.
- Affects: `the-remaa/AionCore/crates/aionui-runtime/src/resolver.rs`, `the-remaa/AionCore/crates/aionui-ai-agent/src/services/availability/mod.rs`, `packages/desktop/src/process/agentCli/agentCliBridge.ts`
- Evidence: `the-remaa/AionCore/crates/aionui-ai-agent/tests/agent_path_override_integration.rs`, `the-remaa/AionCore/crates/aionui-app/tests/agent_refresh_path_e2e.rs`

### The Agents page "Open source" tab is a filtered view of the same agents

- Status: accepted
- Decision: the tab lists the official agents whose backend is in `OPEN_SOURCE_CLIS` (10 CLIs, GitHub-star order) using the same `ManagedAgent` objects as "All", adding license and repo links plus Install (npm kind), Install guide (docs kind) or an npx note; installs run the bundled npm into Pavii's managed-tools folder.
- Rationale: one engine row per CLI keeps status, Test connection and update state identical in both tabs. The list is static, verified against the GitHub API (licenses) and registry.npmjs.org (packages, binaries); no network refresh. Hermes' npm package is an unofficial wrapper, so it uses its docs link. Claude Code and Kiro are excluded (no open-source license). Managed-tools installs are updated with the same bundled npm and `--prefix`.
- Affects: `packages/desktop/src/common/types/agent/openSourceClis.ts`, `packages/desktop/src/process/agentCli/installCli.ts`, `packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx`
- Evidence: `tests/unit/process/agentCli/installCli.test.ts`, `tests/unit/settings/agentFilters.test.ts`, `tests/unit/renderer/LocalAgents.dom.test.tsx`

### Saved provider keys reach an agent CLI only through an opt-in link

- Status: accepted
- Decision: `agent_metadata.linked_provider_id` (migration 042, an id only) is set via `PUT /api/agents/{id}/provider-link`; at spawn `factory/acp.rs` calls `provider_link::inject_linked_provider_env`, which decrypts that provider for the spawning user and appends the mapped env vars to an owned copy of the metadata, never overwriting an existing name.
- Rationale: off by default because e.g. an OpenAI key could silently replace a CLI's subscription login. Each backend-to-env-var mapping is cited to upstream source in `provider_link.rs`; Codex (its app-server ignores `OPENAI_API_KEY`) and OpenClaw (the gateway holds credentials) have none. The OpenAI preset is stored as platform `custom`, so key-only CLIs (opencode, kilo, pi, goose) can link only Anthropic/Gemini providers. The link is one value per machine like other agent overrides; another user's spawn finds no provider and injects nothing. Linking a disabled provider, or one without a base URL where the mapping needs one, is accepted and skipped at spawn with a warn log. `AgentEnvEntry` derives `Debug`/`Serialize` with the plaintext value, so post-injection metadata must never be logged with `?` or returned from an API.
- Affects: `the-remaa/AionCore/crates/aionui-ai-agent/src/provider_link.rs`, `the-remaa/AionCore/crates/aionui-ai-agent/src/factory/acp.rs`, `the-remaa/AionCore/crates/aionui-db/migrations/042_agent_linked_provider.sql`
- Evidence: `the-remaa/AionCore/crates/aionui-ai-agent/src/provider_link_tests.rs`, `the-remaa/AionCore/crates/aionui-app/tests/agent_provider_link_e2e.rs`

### `.pavii` data: per-project session index, CLI session import, portable backup

- Status: accepted
- Decision: the engine keeps `<workspace>/.pavii/sessions.json` (plus a self-ignoring `.pavii/.gitignore`) for user-chosen workspaces, updated at create and whenever the CLI session id binds; the `pavii-context` skill maintains `.pavii/PAVII.md` (it never deletes the old `pavii-ard.md`/`pavii-hoff.md`). The desktop main process lists past Claude Code sessions by parsing `~/.claude/projects/*/*.jsonl` (cwd match) and Codex threads through `codex app-server` `thread/list`/`thread/read`, and imports one as a Pavii conversation (create → `POST /messages/import` → `PUT /backend-session`) that resumes the CLI session. A `*.pavii` backup (settings, agents, MCP, assistants, custom skills, providers, session index) is auto-saved to `Documents/Pavii/backup.pavii` and offered for restore on an empty profile or a different Pavii account.
- Rationale: Codex ids are taken from its own protocol (schema from codex-cli 0.147: `ThreadListParams.cwd`, `Thread.id` = `thread/resume` `threadId`), not from rollout files. Claude `--resume` only works from the original cwd, so the import uses the session's cwd as workspace. Secrets (provider keys, agent env overrides, MCP env/headers, client settings matching token/secret/password/credential) are only written when the user sets a backup password (scrypt + AES-256-GCM); auto-saves never contain them, and the engine rejects keyless providers, so without a password providers do not restore. The `.pavii` writer is best-effort and skips auto temp workspaces; it hooks the BackendBound bind through a repository decorator because `aionui-ai-agent` cannot see workspaces.
- Affects: `the-remaa/AionCore/crates/aionui-conversation/src/pavii_index.rs`, `the-remaa/AionCore/crates/aionui-conversation/src/session_import.rs`, `packages/desktop/src/process/paviiData/`, `packages/desktop/src/renderer/components/settings/PaviiBackup/`, `packages/desktop/src/renderer/pages/guid/components/PastSessions/`
- Evidence: `the-remaa/AionCore/crates/aionui-app/tests/conversation_import_e2e.rs`, `tests/unit/process/paviiData/`, `tests/unit/renderer/paviiData/`

### Pavii agent tools install automatically and join every Pavii chat

- Status: accepted (supersedes "install on a user click", by product-owner decision for these four tools only)
- Decision: Pavii Code Map (Trail-Code, npm), Pavii Compress (Headroom), Pavii Graph (graphify) and Pavii Reach (Agent-Reach; PyPI/GitHub via a pinned, checksum-verified uv with `--managed-python`) install into `<data>/managed-tools` in the background 60 s after the main window loads (`scheduleAutoInstall.ts`); a failed tool is retried only after an app update or by Retry in Settings → Tools. Builtin MCP rows `pavii-code-map`, `pavii-compress`, `pavii-graph` (stdio, `builtinMcp/codeGraphMcp.ts`, no tools outside a code base, graphs in `<data>/code-graphs/<hash>/<tool>/`) and `pavii-search` (http, Exa `https://mcp.exa.ai/mcp`, no key). Every enabled row is added to each new chat by `withPaviiToolSessionServers` (`renderer/hooks/mcp/catalog.ts`); the Settings switch turns a row off and keeps the files. Reach's launchers (`agent-reach`, `yt-dlp` via `--with-executables-from`) sit in `managed-tools/uv-bin`, prepended only to Pavii's in-memory PATH (`registerManagedToolsOnPath`). The auto-inject skill `pavii-tools` tells agents what the tools are and when to use them. Upstream credits are on the About page. `ste100-replies` is unchanged (switch `replyStyle.ste100`).
- Rationale: the owner wants the tools as Pavii's own, on by default, working only through Pavii. Their setup commands (`trail init`, `headroom wrap`, `graphify install`, any `agent-reach` command — even `doctor --json` creates `~/.agent-reach`) write `~/.claude*`, `~/.codex`, `~/.agents`, CLAUDE.md, git hooks or system packages, so Pavii never runs them. The engine passes a stdio MCP server no cwd, so the renderer appends the workspace to code-map row args. ACP agents without the `http` MCP capability silently do not get `pavii-search` (`aionui-mcp/src/session_injection.rs`). Team members inherit the leader conversation's session MCP rows (`aionui-team/src/provisioning.rs`); cron and channel chats do not get them.
- Affects: `packages/desktop/src/process/agentCli/recommendedTools/`, `packages/desktop/src/process/resources/builtinMcp/codeGraphMcp.ts`, `packages/desktop/src/process/utils/runBackendMigrations.ts`, `packages/web-host/src/ensure-opencode.ts`, `packages/desktop/src/renderer/pages/settings/ToolsSettings/RecommendedToolsSection.tsx`, `the-remaa/AionCore/crates/aionui-app/assets/builtin-skills/auto-inject/{pavii-tools,ste100-replies}/`
- Evidence: `tests/unit/process/agentCli/recommendedTools/`, `tests/unit/renderer/recommendedTools/`, `the-remaa/AionCore/crates/aionui-app/tests/{pavii_tools_skill,ste100_replies_skill}.rs`

### Startup agent probes run concurrently

- Status: accepted
- Decision: `hydrate` and `refresh_availability` decode and PATH-probe every agent row on the blocking pool in parallel (`run_blocking_concurrently` in `registry.rs`), keeping input order.
- Rationale: each miss walks all PATH entries times PATHEXT and shim suffixes (about 85 ms with 88 entries); 43 rows probed one after another held engine readiness for about 3 s. Warm launch went from window created at 6.6 s / shown at 11.5 s to 3.2 s / 6.9 s.
- Affects: `the-remaa/AionCore/crates/aionui-ai-agent/src/registry.rs`
- Evidence: `the-remaa/AionCore/crates/aionui-ai-agent/tests/agent_path_override_integration.rs` (`concurrent_hydrate_keeps_every_row_and_records_unavailable_reasons`)

### Open-source agent CLIs install into the managed-tools folder

- Status: accepted
- Decision: the Agents page "Open source" tab lists `OPEN_SOURCE_CLIS` (`packages/desktop/src/common/types/agent/openSourceClis.ts`) with repo, license and install kind. `npm` entries install on click with the bundled npm (`npm install -g <pkg> --prefix <managed-tools>`), `npx` entries need no install, `docs` entries link to the official guide. After an install the renderer runs the PATH refresh, so the agent comes online without a restart.
- Rationale: the managed-tools folder is already on the main-process PATH before the engine spawns, so no system-wide npm or admin rights are needed. Hermes's npm package is an unofficial wrapper, so it is `docs`. `installCli.ts` is loaded lazily from the bridge, so nothing runs at launch.
- Affects: `packages/desktop/src/process/agentCli/installCli.ts`, `packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx`, `packages/desktop/src/renderer/pages/settings/AgentSettings/agentFilters.ts`
- Evidence: `tests/unit/process/agentCli/installCli.test.ts`, `tests/unit/renderer/LocalAgents.dom.test.tsx`, `tests/unit/settings/agentFilters.test.ts`

### An agent can opt in to a saved provider's key

- Status: accepted
- Decision: migration 042 adds a nullable `agent_metadata.linked_provider_id`, set through `PUT /api/agents/{id}/provider-link` and the AgentCard "Use my Pavii key" control. At spawn, `inject_linked_provider_env` decrypts that provider's key and appends it to `meta.env` under the variable the CLI is verified to read; `BACKEND_MAPPINGS` in `provider_link.rs` is the single source of truth and cites the upstream source for every entry.
- Rationale: NULL by default, so existing spawns are unchanged. The key is never copied into the agent row. A variable already in `meta.env` (seed or user override) wins. A missing, disabled or unsupported provider is logged by id only and never fails the spawn. Entries with a base-URL variable are injected only when the provider has a base URL, so a third-party key never reaches a vendor's default endpoint. Unlisted backends (`codex`, whose `app-server` ignores env keys, and `openclaw`) offer no link.
- Affects: `the-remaa/AionCore/crates/aionui-ai-agent/src/provider_link.rs`, `the-remaa/AionCore/crates/aionui-ai-agent/src/routes/agent.rs`, `the-remaa/AionCore/crates/aionui-db/migrations/042_agent_linked_provider.sql`, `packages/desktop/src/renderer/pages/settings/AgentSettings/AgentCard.tsx`
- Evidence: unit tests in `provider_link.rs` and `registry_tests.rs`; `tests/unit/renderer/AgentCard.dom.test.tsx`; checksum pinned in `tests/fixtures/migration-checksums.json`

## Implementation Context

- Dev-mode engine resolution falls back to `<cwd>/resources/bundled-paviicore/<platform-arch>/` in `packages/desktop/src/process/backend/binaryResolver.ts`; run `node scripts/build-paviicore.js` once per checkout.
- Desktop background behavior: `packages/desktop/src/process/utils/closeToTraySetting.ts` defaults new installs to `system.closeToTray = true`, so closing the main window hides it to the tray and keeps the app/backend running; explicit saved `false` still opts out.
- Displayed names after rebrand: built-in assistant "Your Pavii", built-in `aionrs` agent "Pavii CLI", engine "Pavii Engine", hub "Pavii Hub".
- NSIS sources keep internal `$AionUi*` variables, bare `Var /GLOBAL AionUi*` declarations, PowerShell `*-AionUi*` function names, and `AIONUI_*` defines; only display strings changed. App exe references are `PaviiAi.exe`; the uninstaller display file is `Uninstall Pavii.Ai.exe` (derived from productName).
- Release artifacts: `out/Pavii.Ai-<version>-win-x64.exe` (NSIS) via `bun run build-win:x64:fast`; `dist-web-cli/pavii-web-<version>-<platform>.tar.gz` via `node scripts/pack-web-cli.js`. Both re-prepare the engine binary; CI must pass its freshly built `paviicore` through `AIONUI_BACKEND_LOCAL_BINARY`, bundled managed resources may intentionally carry `clis: []`, and no dev instance (electron/paviicore) may be running.
- Readmes reference marketing images (`resources/*.gif`, `resources/pavii-ai-banner-1.png`) that are not in git — broken links inherited from upstream.
- `tests/unit/releasePackagingConfig.test.ts` skips workflow assertions while `.github/` is absent from the fork snapshot.
- Sign-in gate v3: `packages/desktop/src/renderer/components/base/PaviiSignInGate.tsx` + `PaviiSignInGate.module.css` (staged entrance, value row); i18n keys `paviiGate.titleLead`/`subtitle`/`value1-3` replaced `paviiGate.title` across all 13 locales.
- `tests/unit/renderer/layout/LayoutSiderBrandHome.dom.test.tsx` mocks `PaviiSignInGate` to null (collaborator-trim pattern); keep the mock in sync if the gate's module path changes.
- Firebase Authorized domains include `pavii.tech` and `www.pavii.tech` (verified via the public `getProjectConfig` endpoint), resolving the earlier `auth/unauthorized-domain` error. Pending user console step: add `https://www.pavii.tech` and `https://pavii.tech` to the OAuth client's Authorized JavaScript origins.
- Firebase web API key restrictions (website referrers + Identity Toolkit/Token Service APIs) are a pending user console step; the key is a public client identifier by design and is not a secret.
- Website login success page (`vjk7989/fluffy-lamp`, commits `19b321c`, `3232934`, `618cc7d`): shows confetti, a welcome card, and an "Open Pavii" toast; loopback redirect targets receive the ID token via query param, `pavii://` targets via URL fragment.
- WebUI QR login: the exchange is implemented client-side in `packages/desktop/src/renderer/pages/login/index.tsx` (POST `/api/auth/qr-login`, field `qr_token`); previously generated QR links were consumed by nothing. New i18n key `login.qrExpired` exists in 14 locales; `channels.slack*` keys in 13.
- `packages/web-host/src/static-server.ts` serves HTML with `Cache-Control: no-cache` (fixes the stale-shell MIME-error class of failures, observed on mobile) while `/assets/` stay immutable; WS upgrade splices (`/ws`, `/api/stt/stream`) are gated by `verifyWsSession` (replays Cookie/Authorization against `/api/auth/user`; anonymous upgrades get 401 — tests must send a session cookie and mock that endpoint, see `packages/web-host/src/static-server.unit.test.ts`).
- Conversation snapshots are branded in `fromApiConversation` (`packages/desktop/src/common/adapter/apiModelMapper.ts`): `assistant.name`/`avatar` and `extra.agent_name` are scrubbed so pre-rebrand conversations display Pavii names in headers/sider/search.
- `preview.office.*` i18n values across 13 locales say "Pavii CLI" (keys like `officecliNotFound` are unchanged contracts); the sweep script pattern lives in the scratchpad, values-only.
- Privacy posture: **this entry changed — the app is no longer telemetry-free.** It now ships PostHog product analytics, always on, from both processes; see the decision above and `docs/agent-context/privacy-audit.md`. Still true: the Rust engine has **no telemetry crates**; Sentry (`@sentry/electron`) is DSN-env-gated and no DSN exists in the repo, so crash reporting and `sendStartupLogReport` (which would upload gzipped app logs) remain inert; channel plugins are opt-in per user config. `analytics.json` now backs PostHog's `distinct_id` as well as Sentry's dormant device id. Known leaks outside the app: Google Analytics on the pavii.tech website, and secrets (e.g. Telegram bot token) written verbatim into engine logs.
- **Never edit engine assets (`the-remaa/AionCore/**`) with PowerShell text/JSON cmdlets.** `Get-Content -Raw`decodes BOM-less UTF-8 as Windows-1252 and`Set-Content -Encoding utf8`(PS 5.1) writes a BOM: this silently mojibake'd 293 strings in`builtin-assistants/assistants.json`and the BOM made the engine reject the whole catalog, dropping all 20 builtin assistants (including the butler) from`/api/assistants`. Use the Edit/Write tools or a Node/bun script with explicit UTF-8 (no BOM). Symptom to watch for: `builtin` assistant count 0.
- Release home is `buckleson/Pavii-GUI` (git `origin`; the previous `vjk7989/pavii-ai` is kept as remote `old-vjk7989`). The repo name is the single source of truth in `packages/desktop/src/process/services/updateFeed.ts` (`GITHUB_RELEASE_OWNER`/`GITHUB_RELEASE_REPO`, consumed by `updateBridge.ts`) and `packages/desktop/electron-builder.yml` `publish:`; `tests/unit/bootstrap/noVendorUpdateEndpoint.test.ts` pins both so they cannot drift apart. `.github/workflows/_build-reusable.yml` builds Windows x64/arm64, macOS x64/arm64, and Linux x64/arm64 and uploads Windows `.exe.blockmap` files. `.github/workflows/release.yml` mirrors the staged release assets, channel files, checksums, and Windows blockmaps to `buckleson/Pavii-Gui-Releases` with `PAVII_RELEASES_TOKEN`. **That mirror is now also the in-app updater source** (changed in 2.2.2, commit `4330784`): the source repo is private, so an unauthenticated updater 404'd on every check. The website repo `vjk7989/fluffy-lamp` is separate and unchanged.
- Encoding gate: `scripts/check-encoding.js` (`bun run check:encoding`) fails on a UTF-8 BOM, invalid UTF-8, cp1252 mojibake, or U+FFFD across git-tracked text files, and accepts explicit paths so the gitignored `resources/bundled-paviicore/` manifest can be checked too. Wired into `.pre-commit-config.yaml`, `justfile` (`check`, `push`), and `.github/workflows/_build-reusable.yml`. It deliberately does not check line endings (`.gitattributes` sets `* text=auto eol=lf`). Detection requires a character _pair_ so ordinary French/Turkish typography does not match; `ALLOWLIST` holds `sentry-feedback-resolutions/`, which quotes mangled strings as bug evidence. Focused tests: `tests/unit/scripts/checkEncoding.test.ts`.
- BOM-tolerant JSON at build choke points: `packages/shared-scripts/src/read-json-file.js` (`readJsonFile` strips the BOM and throws naming the file; `writeJsonFile` writes BOM-free UTF-8). Used by `prepare-paviicore.js`, `verify-bundled-paviicore-resources.js`, `scripts/resolvePaviicoreVersion.js`, `scripts/prepareHubResources.js`, `scripts/build-with-builder.js`. Tests: `tests/unit/scripts/readJsonFile.test.ts`.
- Engine builds go through `just engine-build` / `node scripts/build-paviicore.js`: runs `cargo test -p aionui-assistant builtin` (the only gate that reads the shipped assistant manifest) before `cargo build --release`, then writes `manifest.json` via Node and proves it parses back. Replaces the hand-typed steps behind both encoding incidents.
- Engine-side defence in `the-remaa/AionCore/crates/aionui-assistant/src/builtin.rs`: `strip_utf8_bom` before `serde_json`, `debug_assert` that the embedded catalog is non-empty and parsed, plus `embedded_manifest_is_clean_utf8_without_bom` whose `find_mojibake` mirrors the JS rule.
- `resources/bundled-skills/mattpocock/` intentionally mirrors the upstream repo layout (engineering has 18 children, over the 10-child guideline) because it is vendored third-party content; do not reorganize it.
- Analytics identity reuses `getOrCreateAnalyticsId()` (`process/utils/analyticsId.ts`), the per-install UUID Sentry already uses, exposed to the renderer as `ipcBridge.application.analyticsId`; `hasAnalyticsId()` must be called before it to detect a first run. `ph-no-capture` on an ancestor suppresses the whole autocapture event, so the marker on `SettingsPageWrapper` deliberately makes every settings screen invisible to autocapture — instrument those with `track()` instead of `data-ph-capture`.
- `resources/bundled-skills/ecc/` is flat (62 children, over the 10-child guideline) for the same reason: upstream keeps all skills in one directory, and topic grouping is owned by `skillCategories.ts`, not the folder layout. The curated selection excludes the 5 skills coupled to ECC's own CLI (`benchmark`, `configure-ecc`, `docker-patterns`, `security-scan`, `unified-memory`) and the vertical-industry entries; each file was normalised to LF with trailing whitespace stripped and a final newline so the prek end-of-file/trailing-whitespace hooks pass. One folder name differs from its frontmatter name (`scientific-thinking-literature-review` declares `name: literature-review`) and the frontmatter name is the operative key.
- `getBundledOpencodeDir` (`packages/web-host/src/ensure-opencode.ts`) requires the binary to be a real **file** (`statSync().isFile()`), not merely an existing path: a directory named `opencode.exe` satisfies `existsSync`, would put a non-executable directory on PATH and suppress the npm fallback, so the app would advertise a bundled agent that cannot run. Pinned by `packages/web-host/src/ensure-opencode.test.ts`.
- Packaging is not safe against concurrent edits: a build in progress must have an otherwise idle working tree, or `verifyAsarIntegrity` fails the build (and, before that guard existed, shipped a dead installer). See the decision above.
- The agent-commands half of the "/" menu already worked end to end and was not touched by the skills fix (commit `33a5c54`): each CLI agent advertises its own commands through the ACP `available_commands_update` notification, `the-remaa/AionCore/crates/aionui-session/src/backend/acp_conn.rs` consumes and persists them, and the engine serves them over `GET /api/conversations/{id}/slash-commands` (`the-remaa/AionCore/crates/aionui-conversation/src/routes_aux.rs`; for idle conversations the endpoint now serves the persisted catalog — see the "Idle conversations serve the cached slash-command catalog" decision) plus the WS `available_commands` / `slash_commands_updated` pushes handled in `packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`. Codex additionally has an engine-side bridge table (`route_slash_command` in `the-remaa/AionCore/crates/aionui-session/src/backend/codex_conn.rs`) mapping `/compact`, `/init`, `/review` and their variants onto native codex RPCs.
- `packages/desktop/src/common/chat/slash/availability.ts` exports two gates and new callers must pick deliberately: `isSlashCommandListEnabled` (may the menu open at all — acp/aionrs/codex) and `isSlashCommandFetchEnabled` (may the backend endpoint be called yet — additionally requires codex `session_active`, because that endpoint 404s until the session is warm). The split changed no behaviour; it separates two concepts that were one function, so gating the menu on codex warmup no longer hides builtins and skills. Pinned by `tests/unit/chat/slashAvailability.test.ts`.
- `buildGuidSlashCommands` (`packages/desktop/src/common/chat/slash/guidSlashCommands.ts`, new-conversation composer) previously discarded skills entirely whenever the agent advertised any command; it now merges both groups and applies `orderSlashCommandsForDisplay`, same as `SendBox`.
- Deliberate limitation of slash skill injection: `textMentionsSlashSkill` requires the token at start-of-string or after whitespace, so a wrapped token such as `(/tdd)` does not inject. It fails closed (no load) rather than guessing, and the case is pinned by an explicit assertion in `tests/unit/chat/injectSkills.test.ts`.
- Dev-profile DB pollution (operational note): the `Pavii.Ai-Dev` profile's engine database is at migration 40 ("oauth client id"), installed 2026-08-21 by an engine run from the `wip/tools-mcp-directory` branch; main's engine ships 39 migrations, so dev runs refuse that database via the downgrade guard — by design, not a bug. Symptom: the dev-profile "Startup didn't complete" dialog. The production profile's database is at 39 and unaffected.
- `scripts/resetpass.ts` supports `--desktop` to target the Electron app data dir. Dev ports: `.claude/launch.json` uses 25809 (was 33000); `docs/guides/webui.md` documents 25808/25809 (was 3000).
- Profile page: `packages/desktop/src/renderer/pages/profile/` (`index.tsx`, pure functions in `profileStats.ts`, `ActivityHeatmap.tsx`, `ShareModal.tsx` canvas share card plus share-intent URLs, `shareCard.ts`); route `/profile` in `packages/desktop/src/renderer/components/layout/Router.tsx` is intentionally module-less for feedback preselection (see `tests/unit/feedback/resolveFeedbackModule.test.ts`); sidebar entry is `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderProfileEntry.tsx`; sign-out lives on the profile page; MCP/skill insights are labelled "most attached" because invocation counts are not recorded anywhere.

- Release gates key on the version read from the built `latest.yml` (`ARTIFACT_V`), not the tag: an `rc` tag and the package.json version differ, and gating on the tag failed the `v2.2.0-rc.1` publish. The mirror upload retries transient failures and asserts the uploaded asset count instead of trusting a clean exit.
- Migration bytes are a shipped contract. A new `.sql` must be added to `tests/fixtures/migration-checksums.json` (add an entry; never edit an existing one) or `tests/unit/bootstrap/migrationChecksums.test.ts` fails the push gate. Do not edit a migration file while `cargo test` is compiling — the embedded and on-disk copies then disagree and sqlx reports `VersionMismatch(N)`, which looks like a real defect and is not.
- Agent availability has two caches that behave differently, and this bites any catalog change: startup `hydrate` does a real PATH probe (`AvailabilityProjection::Probe`), but the agent **list** reads `Cached`, where `cached_snapshot_indicates_missing` treats a stored `command_not_found`/`command_missing`/`primary_missing`/`bridge_missing` as still-missing and `overlay_hydrated_availability` refuses to overlay the fresh probe onto any row carrying a snapshot. Only a manual health check clears it. A migration that repoints an agent's `command` must therefore also clear the snapshot columns, and `has_availability_snapshot` ORs six of them including `last_success_at`/`last_failure_at` — leaving one set keeps the row pinned. See `the-remaa/AionCore/crates/aionui-ai-agent/src/registry.rs`.
- Post-030, `agent_metadata` rows carry both a surrogate `id` and a logical `agent_id` (both seeded from the pre-030 `id`). New migrations should match on `agent_source` + `backend` like `039_omp_direct_cli_launch.sql`, which survives that split.
- Engine builds on this machine fail for disk, not code. Three distinct symptoms, all the same cause and all cleared by `cargo clean` rather than by editing source: truncated metadata (`E0786 found invalid metadata files`), a rustc crash (`STATUS_STACK_BUFFER_OVERRUN`, exit `0xc0000409`), and `fatal error LNK1180: insufficient disk space to complete link`. **`cargo test --workspace` does not currently fit on D:** — measured 2026-08-28, it grew `target/` to 14.7 GB, drove the drive to 0 bytes free, and still died at link time. Run per-crate suites locally (`cargo test -p <crate>`, which does fit) and let CI's engine preflight be the authoritative workspace gate; it runs the same command on a runner with adequate disk.
- Piping a build or test command into `grep`/`tail` replaces its exit code with the filter's, so a failed run reports success. Redirect to a file and check `$?` — this masked both a failed `just push` and a failed workspace compile.
- `cargo test -p <crate> --bins` does not build the integration targets under `tests/`. CI's engine preflight runs `cargo test --workspace`; a change to shared output or shipped asset text must be validated against that, or assertions in `tests/` fail only in CI. `cargo test` also stops at the first failing binary, so one reported failure can be hiding others.

- Installer NSIS test coverage is uneven and the gap moves. Five smokes compile real NSIS (`smoke-installer-{shortcut,disk-gate,rollback,self-lock,failure-messagebox}.js`), but each includes only the `.nsh` files it needs — **no smoke included `installer-update-verify.nsh` until `smoke-installer-shortcut.js` existed**, so that file had only ever been compiled by a full release build. When adding a macro there, check whether any smoke actually compiles it. The harness lifts macro text out of the shipped `.nsh` rather than copying it, and injects electron-builder's `nsis-resources` plugin dir so `WinShell::SetLnkAUMI` resolves for real.
- A local `bun run build-win:x64` bundles the engine from `resources/bundled-paviicore/<key>/`, which is a **staged binary that goes stale**. On 2026-08-29 that staging was two days older than migration 041, so the locally built app hit the downgrade guard (`db_migration_version 41 > app_migration_version 40`) and refused to open the database — "Startup didn't complete". The guard behaved correctly; the build was wrong. CI is unaffected because it compiles the engine from vendored source. Refresh the staging (`node scripts/build-paviicore.js`) before any local packaging test, and expect to reinstall the official build afterwards.
- NSIS installers **re-launch themselves** on the update path (two `session-begin` events in the JSONL log), so `Start-Process -Wait` returns on the parent while the install continues in a child. Measuring the installed version immediately after that returns the OLD version and looks like a failed install. Poll until no installer process remains.
- `scripts/build-paviicore.js` looks for the binary in `the-remaa/AionCore/target/release/`; with `CARGO_TARGET_DIR` redirected (on this machine build caches live on `G:/pavii-super/` because D: is nearly full) the build succeeds but the script reports "Engine binary missing", and the copy plus manifest steps must be finished by hand.
- The bundled Node runtime (`resources/bundled-paviicore/<key>/managed-resources/node/node-v*/`) ships `npm.cmd` without `node_modules/npm`, so its npm cannot run (`MODULE_NOT_FOUND npm-cli.js`). Agent CLI installs therefore use the engine's managed runtime at `<getDataPath()>/runtime/node/node-v*/`, which has a complete npm, and accept a bundled npm only when `npm-cli.js` exists (`hasNpmCli` in `packages/desktop/src/process/agentCli/installCli.ts`). `ensureOpencodeInstalled` in `packages/web-host/src/ensure-opencode.ts` still uses the bundled npm directly, so its npm fallback fails the same way (pre-existing, not changed).
- `aionui-runtime` has 8 unit tests that fail on Windows on the unchanged code (node_runtime, spawn and shell_env tests asserting Unix paths); they are not regressions.
- The installer's JSONL log at `%TEMP%\aionui-installer-<version>-<date>-log.jsonl` is the primary diagnostic for any install question — it records the disk check, every verify step, the shortcut decision with `updated=` state, and `session-end`. Read it before theorising.

## Deferred to the services phase

- Sentry: DSN is env-only (`SENTRY_DSN`); telemetry tag names still `aionui.*`.
- Auth (local bcrypt/JWT), database (local SQLite), payments: unchanged; replacement planned with user-owned services.
- Mobile store binaries require an Expo/EAS account; config identity is already `com.pavii.ai.mobile`.
- Pre-existing gaps logged, not fixed: `fr-FR` missing from the main-process locale map (`packages/desktop/src/process/services/i18n/index.ts`); `tests/integration/i18n-packaged.test.ts` referenced by scripts but absent.

## Verification Pointers

- Project test standards: `.claude/skills/testing/SKILL.md`
- Update/release gate: focused updater/dialog/release packaging suites pass (`tests/unit/bootstrap/backendStartupFailure.test.ts`, `tests/unit/process/services/autoUpdaterService.test.ts`, `tests/unit/updateBridgeCdnRewrite.test.ts`, `tests/unit/renderer/layout/backendStartupViews.dom.test.tsx`, `tests/unit/assets/verifyBundledPaviicoreInstallScript.test.ts`, `tests/unit/releasePackagingConfig.test.ts`); workflow YAML parse, `bunx tsc --noEmit`, `bun run check:encoding`, and full `bun run test` pass for the silent-update/blockmap and CI-built-engine packaging changes.
- Full gate: oxlint 0 errors, tsc clean, `scripts/check-encoding.js` and `scripts/check-language.js` clean, `scripts/check-i18n.js` passes, vitest 4613 passed / 6 skipped / 2 todo; focused suites: `packages/web-host/src/ensure-opencode.test.ts`, `packages/web-host/src/start-web-host.test.ts`, `tests/unit/bootstrap/asarIntegrityGuard.test.ts`, `tests/unit/bootstrap/brandAssets.test.ts`, `tests/unit/chat/injectSkills.test.ts`, `tests/unit/chat/mergeSlashCommands.test.ts`, `tests/unit/chat/slashAvailability.test.ts`, `tests/unit/common/assistantBranding.test.ts`, `tests/unit/feedback/resolveFeedbackModule.test.ts`, `tests/unit/process/services/paviiAuthCallbackServer.test.ts`, `tests/unit/process/services/usageLedger.test.ts`, `tests/unit/renderer/PaviiSignInGate.dom.test.tsx`, `tests/unit/renderer/hooks/useAssistantSlashSkills.dom.test.tsx`, `tests/unit/renderer/profileStats.test.ts`, `tests/unit/renderer/splash.dom.test.ts`.
- Channels/WebUI change gate: tsc clean, oxlint 0 errors; focused suites green — `tests/unit/process/channels/` (6 files, 53 tests incl. Slack and Discord simulated round-trips), configMigration + channelAssistantBinding suites (26 tests; see `tests/unit/common-config/configMigration.test.ts`, `tests/unit/renderer/channelAssistantBinding.test.ts`).
- Skills-overhaul gate: tsc clean, oxlint 0 errors, `scripts/check-i18n.js` passes; `tests/unit/common/skillBranding.test.ts` (10), `tests/unit/process/startup/ensureBundledSkills.test.ts` (8), `tests/unit/renderer/assistantDefaults.test.ts` (6), `packages/web-host/src/static-server.unit.test.ts` (13 incl. anonymous-WS 401); full suite 454/456 files passed with only the known environmental preview module-load timeout (passes standalone); live dev backend verified 36 imported custom skills including `token-optimizer`.
- Analytics privacy, verified against production: 400 live events pulled from PostHog EU (project 249810) and scanned across every property for file:// URLs, Windows paths, home directories, emails, and credential-shaped strings — zero hits. `$current_url` arrives normalised (`app://pavii/conversation/:id`, `.../detail/:skillName`), confirming `normaliseRoute` runs before send. `token` and `distinct_id` appear in stored properties because PostHog's ingestion echoes them; `token` is the public `phc_` write key, not a secret. Dashboards: "Pavii.Ai — Product Health" (912262) and "Pavii.Ai — Activation & Usage" (912263).
- Main-process analytics attribution: `posthog-node` has no `register`, so `analyticsService` merges `environment`/`app_version`/`platform`/`arch` into every capture by hand; explicit event properties win, matching posthog-js. Regression-tested in `tests/unit/analytics/mainProcessSuperProperties.test.ts`, which fails on 3 of 5 cases without the merge. Fixes production events that arrived unattributable to any release or OS. All five recorded failures are `backend_data_migration_failed` on 21-22 Aug 2026, before the CRLF fix shipped; none since.
- Slash-command persistence gate: full app suite 4613 passed / 6 skipped / 2 todo; engine tests `cargo test -p aionui-ai-agent --test cached_slash_commands` (6 tests) and `cargo test -p aionui-app --test auxiliary_e2e` (17 tests) both green; live production check returned 200 with 18 commands for the conversation that previously 404'd.
- Runtime verification: WebUI login page renders at `bun run webui` (post chunk fix); desktop app reaches `backendManager.start ready` with engine detection including OpenCode; live end-to-end sign-in confirmed via loopback callback (`[PaviiAuth] signed in as <user>` in main-process logs).
- Kiro `acp` entry point, verified against the real binary (2026-08-28, kiro-cli 2.20.0 on Windows): driving a JSON-RPC `initialize` into `kiro-cli acp` over stdio returns `protocolVersion: 1`, `agentInfo.name "Kiro CLI Agent"`, and `agentCapabilities` that match the `agent_capabilities` seeded for Kiro in `003_agent_acp_capabilities.sql` field for field — `loadSession: true`, `promptCapabilities {image: true, audio: false, embeddedContext: false}`, `mcpCapabilities {http: true, sse: false}`, `sessionCapabilities {}`. It answers before any `kiro-cli login` and returns `authMethods: []`, confirming 003's premise that this entry point serves ACP unauthenticated. This proves the `["acp"]` args and the capabilities row, not just the binary name.

- Agent CLI updates gate: `tests/unit/process/agentCli/`, `tests/unit/renderer/AgentCard.dom.test.tsx`, `tests/unit/renderer/LocalAgents.dom.test.tsx`, `tests/unit/renderer/useGuidSend.dom.test.ts`; engine `cargo test -p aionui-ai-agent` and `cargo test -p aionui-app --test agent_refresh_path_e2e`. Live check in the desktop app: the auto-check logs `[AgentCli] auto-check done`, and the Agents page shows "Update to <version>" for outdated CLIs.

- Test discovery trap: `vitest.config.ts` includes only `packages/web-host/src/**/*.test.ts` for that package, so anything under `packages/web-host/tests/` never executes. The package-local `packages/web-host/vitest.config.ts` does include `tests/**`, which is what made those files look covered. That directory is now gone (its one real assertion moved into `packages/web-host/src/start-web-host.test.ts`, the rest deleted); new web-host tests must live in `packages/web-host/src/`. `startWebHost` registers OpenCode on PATH for real unless stubbed, so an unstubbed call mutates `process.env` for the remainder of the run.

## Referenced Artifacts

- `.claude/skills/architecture-recorder/SKILL.md`
- `.claude/skills/architecture/SKILL.md`
- `.claude/skills/handoff/SKILL.md`
- `.claude/skills/testing/SKILL.md`
- `AGENTS.md`
- `docs/agent-context/handoff.md`
- `scripts/generate-brand-icons.mjs`
