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
| Tests               | `tests/`                                                 | Unit, integration, regression, and end-to-end suites.                                             |
| Web host / CLI      | `packages/web-host/`, `packages/web-cli/`                | Headless backend launcher + `pavii-web` CLI.                                                      |
| Website (external)  | `.workspaces/fluffy-lamp/`                               | Astro marketing/login site; pushed to `vjk7989/fluffy-lamp`, not part of the desktop build.       |

### Process and Module Boundaries

- Main and renderer process constraints are authoritative in `AGENTS.md#architecture`.
- The engine is now built from vendored source at `the-remaa/AionCore` (gitignored, excluded from lint/format): `cargo build --release --bin paviicore`, deployed to `resources/bundled-paviicore/win32-x64/paviicore.exe`. Source-level rebrand applied there: butler rules (3 locales) + `assistants.json` name/i18n ("Your Pavii", identity "built by Team Pavii — pavii.tech"), `AgentType::Aionrs.display_name()` → "Pavii CLI", temp workspaces `pavii-temp-<id>`, Pavii avatar/logo embedded. NOT renamed (contracts): ids (`aionui-assistant`, `aionrs`), `AIONUI_*` env vars, `ACP_CLIENT_NAME`, `.aionrs` dot-dir (read back by name), shipped DB migrations (existing DBs keep the seeded agent name "Aion CLI"; the display layer renames it).
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

### CJK punctuation is inside the language gate

- Status: accepted
- Decision: `scripts/check-language.js` covers U+3000-U+303F (CJK Symbols and Punctuation) alongside the ideograph and kana blocks, and runs as a blocking step in the justfile `check`/`push` recipes and in CI.
- Rationale: The range table began at U+3040, so the ideographic comma and full stop were never checked. Three list joins shipped U+3001 into English tooltips and several comment fragments truncated at a full-width full stop went unreported, because a string reads as English right up to its separator.
- Affects: `scripts/check-language.js`
- Evidence: `tests/unit/scripts/checkLanguage.test.ts`

### Chinese-ecosystem channels removed from the UI; backend rows filtered

- Status: accepted
- Decision: Lark/DingTalk/WeChat (weixin)/WeCom are removed from the channels settings UI (4 config forms, logos, and i18n across 13 locales deleted; `ChannelModalContent` trimmed); because the closed aioncore engine still ships these plugins and returns them from `GET /api/channel/plugins`, `ChannelModalContent.tsx` keeps a `HIDDEN_CHANNEL_TYPES` set filtering them out of the extension-row path.
- Rationale: The engine catalog cannot be changed, so hiding must happen in the renderer; data contracts (`ConversationSource` union, channel types, DB migration history) stay untouched so persisted data remains valid.
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
- Evidence: `tests/unit/process/startup/ensureOpencode.test.ts`, `tests/unit/assets/prepareOpencode.test.ts`, `scripts/afterPack.js`

### Issue reports leave through the reporter, not the app

- Status: accepted
- Decision: Report Issue opens a prefilled GitHub issue form in the user's own browser. `PAVII_ISSUE_PROXY_URL` may point at the Cloudflare Worker in `services/issue-proxy/` for reporters without a GitHub account; it is unset by default, and no token ships in the app.
- Rationale: The previous path called `Sentry.captureEvent`, and Sentry builds with an empty DSN, so every report was discarded or threw at the flush while the button looked functional. Routing through the browser means nothing leaves the machine without the user seeing it; a token embedded in a public desktop build would be extractable.
- Affects: `packages/desktop/src/process/feedback/issueDelivery.ts`
- Evidence: `tests/unit/feedback/issueReport.test.ts`

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
- Decision: `pickDefaultAssistantSelectionKey` selects an OpenCode assistant when present, falling back to aionrs.
- Rationale: Product preference for the OpenCode agent as the out-of-box default; OpenCode is guaranteed installed at startup.
- Affects: `packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts`
- Evidence: `packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts`

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

### Sign-in hand-off prefers a loopback callback over the pavii:// deep link

- Status: accepted
- Decision: The `paviiAuth.signIn` IPC provider starts a single-use `127.0.0.1` ephemeral-port HTTP listener and passes `http://127.0.0.1:<port>/auth` as the login redirect target; the website delivers the Firebase ID token by same-machine fetch (query param). `pavii://auth` (fragment token) is the fallback when the listener cannot start, and the deep-link handler still works; both paths converge on the shared `completeAuthSignIn` in `packages/desktop/src/process/utils/deepLink.ts` (returns boolean). Token verification stays main-process only.
- Rationale: Browsers can silently refuse to launch the `pavii://` custom scheme (stale protocol-handler caches, observed in Chrome despite a correct HKCU registration); loopback is exempt from mixed-content blocking and lets the success page stay open.
- Affects: `packages/desktop/src/process/bridge/applicationBridge.ts`, `packages/desktop/src/process/services/paviiAuthCallbackServer.ts`
- Evidence: `tests/unit/process/services/paviiAuthCallbackServer.test.ts`

### Slack/Discord are app-hosted main-process bridges, not engine channels

- Status: accepted
- Decision: aioncore has no Slack/Discord support and extension `channelPlugins` are metadata-only (no JS runtime; `webui.apiRoutes` never mounted), so both run as main-process bridges in `packages/desktop/src/process/services/channels/`: `backendConversationClient.ts` (unauthenticated `127.0.0.1` HTTP plus a `/ws` `turn.completed` listener), `slackBridge.ts` (Socket Mode via `apps.connections.open` + ws, DM/app_mention handling, per-channel conversation mapping, `chat.postMessage` replies, reconnect), `discordBridge.ts` (Gateway ws from `GET /gateway/bot`: hello/heartbeat/identify with GUILDS+GUILD_MESSAGES+MESSAGE_CONTENT+DIRECT_MESSAGES intents, DM/@mention handling, 2000-char chunked REST replies, reconnect; REST base overridable via `PAVII_DISCORD_API_BASE`), and `channelStore.ts` (`pavii-channels.json` in the config dir: credentials/enabled/conversation map, local-only); both restore on boot from `markBackendReady` in `packages/desktop/src/index.ts` and are exposed via the `paviiChannels` IPC namespace (`getStatus`/`enable`/`disable`) in `packages/desktop/src/common/adapter/ipcBridge.ts` with providers in `packages/desktop/src/process/bridge/applicationBridge.ts` and renderer `SlackConfigForm.tsx`/`DiscordConfigForm.tsx` guided cards.
- Rationale: The engine trusts its local process (spawned with `--local`), so the bridge talks to it unauthenticated over loopback; hosting bridges in the app avoids forking the closed engine.
- Affects: `packages/desktop/src/process/services/channels/`
- Evidence: `tests/unit/process/channels/`

### Skill rebranding is display-only via display_name; raw names stay backend keys

- Status: accepted
- Decision: `fs.listAvailableSkills` and `fs.readSkillInfo` are wrapped with `brandSkills`/`applySkillBranding` (`packages/desktop/src/common/utils/skillBranding.ts`): each row gains a `display_name` (prefix rules `officecli-`→`pavii-cli-`, `aionui-`→`pavii-`) and a rebranded description (brand scrub plus English overrides for the Chinese-described builtins `x-recruiter`, `xiaohongshu-recruiter`, `weixin-file-send`); the raw `name` is never rewritten because enable/delete/materialize/slash commands and `enabled_skills`/`skill_ids` all key on it. UI surfaces render `display_name ?? name` (SkillsHubSettings, SkillDetailPage, AssistantEditorSections labels, GuidActionRow skill submenu); in-chat slash surfaces keep raw names since the name is the command.
- Rationale: Skill names are engine contracts inside the closed aioncore; a display-only field rebrands every list surface without breaking round-trips.
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

### Token statistics come from a local per-day usage ledger

- Status: accepted
- Decision: The backend keeps only a last-snapshot token usage per conversation, so lifetime stats are not reconstructible from it; a main-process service `packages/desktop/src/process/services/usageLedger.ts` (`usage-ledger.json` in the config dir, debounced writes, corrupt-file tolerant) accumulates per-turn frames recorded best-effort from `useAionrsMessage` (finish frame) and `useAcpMessage` (end-of-turn `_meta` counters), exposed via the `paviiUsage` IPC namespace (`record`/`get`) in `packages/desktop/src/common/adapter/ipcBridge.ts` with providers in `packages/desktop/src/process/bridge/applicationBridge.ts`.
- Rationale: Lifetime/per-day stats require local accumulation; stats therefore start from the first launch of this build.
- Affects: `packages/desktop/src/process/services/usageLedger.ts`
- Evidence: `tests/unit/process/services/usageLedger.test.ts`

### Website Google sign-in uses the GIS token flow, not signInWithPopup

- Status: accepted
- Decision: The website login page uses the Google Identity Services token flow plus Firebase `signInWithCredential` for Google sign-in; GitHub/SAML still use `signInWithPopup` and remain broken until a planned `auth.pavii.tech` Firebase Hosting custom domain becomes the authDomain.
- Rationale: The page origin `www.pavii.tech` vs authDomain `pavii-ai3.firebaseapp.com` is cross-site, and Chrome storage partitioning breaks the popup handler handoff; the embedded Google Web client ID is a public identifier.
- Affects: `.workspaces/fluffy-lamp/src/pages/login.astro`
- Evidence: commit `dcffe50` in `vjk7989/fluffy-lamp`

### Windows in-app updates are silent and differential

- Status: accepted
- Decision: Windows in-app update installs pass the silent NSIS flag to `electron-updater`, and Windows release jobs must publish `.exe.blockmap` assets for both x64 and arm64 before either the primary or mirror GitHub Release is updated.
- Rationale: In-app updates should behave like updates instead of a fresh visible installer, while manual website downloads remain normal visible installers.
- Affects: `packages/desktop/src/process/services/autoUpdaterService.ts`
- Evidence: `packages/desktop/electron-builder.yml`, `.github/workflows/_build-reusable.yml`, `.github/workflows/release.yml`, `tests/unit/releasePackagingConfig.test.ts`

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
- Release home is `buckleson/Pavii-GUI` (git `origin`; the previous `vjk7989/pavii-ai` is kept as remote `old-vjk7989`). The repo name is the single source of truth in `packages/desktop/src/process/services/updateFeed.ts` (`GITHUB_RELEASE_OWNER`/`GITHUB_RELEASE_REPO`, consumed by `updateBridge.ts`) and `packages/desktop/electron-builder.yml` `publish:`; `tests/unit/bootstrap/noVendorUpdateEndpoint.test.ts` pins both so they cannot drift apart. `.github/workflows/_build-reusable.yml` builds Windows x64/arm64, macOS x64/arm64, and Linux x64/arm64 and uploads Windows `.exe.blockmap` files. `.github/workflows/release.yml` mirrors the staged release assets, channel files, checksums, and Windows blockmaps to `buckleson/Pavii-Gui-Releases` with `PAVII_RELEASES_TOKEN`; that mirror is for website/download distribution, not the in-app updater source. `scripts/track-downloads.mjs` defaults to the primary repo. The website repo `vjk7989/fluffy-lamp` is separate and unchanged.
- Encoding gate: `scripts/check-encoding.js` (`bun run check:encoding`) fails on a UTF-8 BOM, invalid UTF-8, cp1252 mojibake, or U+FFFD across git-tracked text files, and accepts explicit paths so the gitignored `resources/bundled-paviicore/` manifest can be checked too. Wired into `.pre-commit-config.yaml`, `justfile` (`check`, `push`), and `.github/workflows/_build-reusable.yml`. It deliberately does not check line endings (`.gitattributes` sets `* text=auto eol=lf`). Detection requires a character _pair_ so ordinary French/Turkish typography does not match; `ALLOWLIST` holds `sentry-feedback-resolutions/`, which quotes mangled strings as bug evidence. Focused tests: `tests/unit/scripts/checkEncoding.test.ts`.
- BOM-tolerant JSON at build choke points: `packages/shared-scripts/src/read-json-file.js` (`readJsonFile` strips the BOM and throws naming the file; `writeJsonFile` writes BOM-free UTF-8). Used by `prepare-paviicore.js`, `verify-bundled-paviicore-resources.js`, `scripts/resolvePaviicoreVersion.js`, `scripts/prepareHubResources.js`, `scripts/build-with-builder.js`. Tests: `tests/unit/scripts/readJsonFile.test.ts`.
- Engine builds go through `just engine-build` / `node scripts/build-paviicore.js`: runs `cargo test -p aionui-assistant builtin` (the only gate that reads the shipped assistant manifest) before `cargo build --release`, then writes `manifest.json` via Node and proves it parses back. Replaces the hand-typed steps behind both encoding incidents.
- Engine-side defence in `the-remaa/AionCore/crates/aionui-assistant/src/builtin.rs`: `strip_utf8_bom` before `serde_json`, `debug_assert` that the embedded catalog is non-empty and parsed, plus `embedded_manifest_is_clean_utf8_without_bom` whose `find_mojibake` mirrors the JS rule.
- `resources/bundled-skills/mattpocock/` intentionally mirrors the upstream repo layout (engineering has 18 children, over the 10-child guideline) because it is vendored third-party content; do not reorganize it.
- Analytics identity reuses `getOrCreateAnalyticsId()` (`process/utils/analyticsId.ts`), the per-install UUID Sentry already uses, exposed to the renderer as `ipcBridge.application.analyticsId`; `hasAnalyticsId()` must be called before it to detect a first run. `ph-no-capture` on an ancestor suppresses the whole autocapture event, so the marker on `SettingsPageWrapper` deliberately makes every settings screen invisible to autocapture — instrument those with `track()` instead of `data-ph-capture`.
- `resources/bundled-skills/ecc/` is flat (62 children, over the 10-child guideline) for the same reason: upstream keeps all skills in one directory, and topic grouping is owned by `skillCategories.ts`, not the folder layout. The curated selection excludes the 5 skills coupled to ECC's own CLI (`benchmark`, `configure-ecc`, `docker-patterns`, `security-scan`, `unified-memory`) and the vertical-industry entries; each file was normalised to LF with trailing whitespace stripped and a final newline so the prek end-of-file/trailing-whitespace hooks pass. One folder name differs from its frontmatter name (`scientific-thinking-literature-review` declares `name: literature-review`) and the frontmatter name is the operative key.
- `scripts/resetpass.ts` supports `--desktop` to target the Electron app data dir. Dev ports: `.claude/launch.json` uses 25809 (was 33000); `docs/guides/webui.md` documents 25808/25809 (was 3000).
- Profile page: `packages/desktop/src/renderer/pages/profile/` (`index.tsx`, pure functions in `profileStats.ts`, `ActivityHeatmap.tsx`, `ShareModal.tsx` canvas share card plus share-intent URLs, `shareCard.ts`); route `/profile` in `packages/desktop/src/renderer/components/layout/Router.tsx` is intentionally module-less for feedback preselection (see `tests/unit/feedback/resolveFeedbackModule.test.ts`); sidebar entry is `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderProfileEntry.tsx`; sign-out lives on the profile page; MCP/skill insights are labelled "most attached" because invocation counts are not recorded anywhere.

## Deferred to the services phase

- Sentry: DSN is env-only (`SENTRY_DSN`); telemetry tag names still `aionui.*`.
- Auth (local bcrypt/JWT), database (local SQLite), payments: unchanged; replacement planned with user-owned services.
- Mobile store binaries require an Expo/EAS account; config identity is already `com.pavii.ai.mobile`.
- Pre-existing gaps logged, not fixed: `fr-FR` missing from the main-process locale map (`packages/desktop/src/process/services/i18n/index.ts`); `tests/integration/i18n-packaged.test.ts` referenced by scripts but absent.

## Verification Pointers

- Project test standards: `.claude/skills/testing/SKILL.md`
- Update/release gate: focused updater/dialog/release packaging suites pass (`tests/unit/bootstrap/backendStartupFailure.test.ts`, `tests/unit/process/services/autoUpdaterService.test.ts`, `tests/unit/updateBridgeCdnRewrite.test.ts`, `tests/unit/renderer/layout/backendStartupViews.dom.test.tsx`, `tests/unit/assets/verifyBundledPaviicoreInstallScript.test.ts`, `tests/unit/releasePackagingConfig.test.ts`); workflow YAML parse, `bunx tsc --noEmit`, `bun run check:encoding`, and full `bun run test` pass for the silent-update/blockmap and CI-built-engine packaging changes.
- Full gate: oxlint 0 errors, format clean, tsc clean, `scripts/check-i18n.js` passes, vitest 4127 passed / 0 assertion failures (2 known environmental preview module-load timeouts, plus the `/profile` feedback-module test which was fixed and passes standalone); focused suites: `tests/unit/bootstrap/brandAssets.test.ts`, `tests/unit/common/assistantBranding.test.ts`, `tests/unit/feedback/resolveFeedbackModule.test.ts`, `tests/unit/process/services/paviiAuthCallbackServer.test.ts`, `tests/unit/process/services/usageLedger.test.ts`, `tests/unit/process/startup/ensureOpencode.test.ts`, `tests/unit/renderer/PaviiSignInGate.dom.test.tsx`, `tests/unit/renderer/profileStats.test.ts`, `tests/unit/renderer/splash.dom.test.ts`.
- Channels/WebUI change gate: tsc clean, oxlint 0 errors; focused suites green — `tests/unit/process/channels/` (6 files, 53 tests incl. Slack and Discord simulated round-trips), configMigration + channelAssistantBinding suites (26 tests; see `tests/unit/common-config/configMigration.test.ts`, `tests/unit/renderer/channelAssistantBinding.test.ts`).
- Skills-overhaul gate: tsc clean, oxlint 0 errors, `scripts/check-i18n.js` passes; `tests/unit/common/skillBranding.test.ts` (10), `tests/unit/process/startup/ensureBundledSkills.test.ts` (8), `tests/unit/renderer/assistantDefaults.test.ts` (6), `packages/web-host/src/static-server.unit.test.ts` (13 incl. anonymous-WS 401); full suite 454/456 files passed with only the known environmental preview module-load timeout (passes standalone); live dev backend verified 36 imported custom skills including `token-optimizer`.
- Runtime verification: WebUI login page renders at `bun run webui` (post chunk fix); desktop app reaches `backendManager.start ready` with engine detection including OpenCode; live end-to-end sign-in confirmed via loopback callback (`[PaviiAuth] signed in as <user>` in main-process logs).

## Referenced Artifacts

- `.claude/skills/architecture-recorder/SKILL.md`
- `.claude/skills/architecture/SKILL.md`
- `.claude/skills/handoff/SKILL.md`
- `.claude/skills/testing/SKILL.md`
- `AGENTS.md`
- `docs/agent-context/handoff.md`
- `scripts/generate-brand-icons.mjs`
