# Changelog

## [2.2.11](https://www.pavii.tech/products/dev-tools/) (2026-10-23)

### Desktop

#### Features

- **sessions:** every project folder you work in now gets a `.pavii` folder that records which agent ran each conversation and its CLI session, so a later session or another agent can see what happened and pick it up. It ignores itself in git. The project notes agents keep now live in `.pavii/PAVII.md`.
- **sessions:** **Past sessions** next to the folder picker on a new chat lists the Claude Code and Codex sessions you already ran in that folder. Open one to read its history in Pavii and keep going in the same CLI session.
- **backup:** **Settings → System → Backup & restore** exports and imports a `.pavii` file with your settings, agents, MCP servers, assistants, custom skills, model providers and session list. API keys and other secrets are only included when you set a backup password. Pavii also keeps `Documents/Pavii/backup.pavii` up to date and offers to restore it after a reinstall or when you sign in with a different account.

---

## [2.2.10](https://www.pavii.tech/products/dev-tools/) (2026-10-23)

### Desktop

#### Features

- **agents:** each agent CLI Pavii can update now has a **Check update** button next to Test Connection. When a newer release exists the card shows "Update available" and an **Update to <version>** button that runs the update after you confirm. Claude Code, Codex, Gemini CLI, OpenCode and Kiro are also checked in the background, 30 seconds after launch at most every two days and when you start a conversation with one; nothing is installed without your OK.
- **agents:** a new **Open source** tab lists ten open-source agent CLIs (OpenClaw, Hermes, OpenCode, Codex, Pi, Gemini CLI, Goose, DeepAgents, Qwen Code, Kilo Code) with their license and source link. Ones Pavii can install get an **Install** button; the rest link to their official install guide. They are the same agents as on the All tab, so status, tests and updates match in both places.
- **agents:** optional **Use my Pavii key** switch for supported open-source CLIs: Pavii passes an API key you already saved in Model settings to that CLI when it starts it. Off by default, and only for CLIs whose key variable was verified against their source.

#### Bug Fixes

- **agents:** a CLI installed while Pavii is running is now found by Test Connection straight away, instead of only after a restart, and a passing test makes the agent usable immediately.

#### Performance

- **startup:** the engine now looks for all agent CLIs in parallel, so the window appears in about half the time on a machine with a long PATH.

---

## [2.2.9](https://www.pavii.tech/products/dev-tools/) (2026-08-30)

### Desktop

#### Features

- **skills:** an agent working in a project now reads `pavii-ard.md` and `pavii-hoff.md` before it starts and keeps them current as work happens, so a session opened days later continues from what the last one recorded instead of asking again. In a team the files live in the shared workspace and only the leader writes them; everyone reads.

#### Bug Fixes

- **settings:** changing the language now relabels the tray menu and switches the main process too, instead of only the window you changed it in.
- **build:** a momentary failure downloading a prebuilt native binary no longer fails a release. The download is retried before falling back to building from source, and that fallback now uses a maintained, version-pinned toolchain instead of a deprecated one fetched fresh on every build — which could not compile against the build machines' Python and so had never actually worked.

---

## [2.2.8](https://www.pavii.tech/products/dev-tools/) (2026-08-29)

### Desktop

#### Bug Fixes

- **image generation:** an agent is no longer handed the built-in image tool when no image model is configured — it could only fail there. Agents that generate images themselves, such as Codex, now use their own capability instead, and the tool no longer tells them they cannot. Configure an image model and it is used as before, for every agent.

---

## [2.2.7](https://www.pavii.tech/products/dev-tools/) (2026-08-28)

### Desktop

#### Bug Fixes

- **installer:** the desktop shortcut survives an update — it used to be created only on a first or manual install, so updating left you with the Start-menu entry and no desktop icon. A shortcut you deleted on purpose stays deleted.
- **linux:** the application-menu entry is filed under Office as well as Utility, and the package now states the libraries it needs instead of relying on a default that could change underneath it.

---

## [2.2.6](https://www.pavii.tech/products/dev-tools/) (2026-08-28)

### Desktop

#### Bug Fixes

- **installer:** an install that cannot fit on the drive is now refused up front, naming how much space is free and how much is needed, instead of failing partway through extraction with a message about corrupt files — and on an update it stops before the previous version is touched, so nothing is lost. A drive whose free space cannot be read is allowed through rather than blocked.

---

## [2.2.5](https://www.pavii.tech/products/dev-tools/) (2026-08-27)

### Desktop

#### Bug Fixes

- **mcp:** a failed connection check now shows the reason the engine actually reported instead of guessing "Missing npx on this machine", timeouts say so and note that a first run downloads the server package, and the check allows 90s so a cold package download can finish
- **brand:** the agent no longer shows pre-rebrand names — runtime context is exported and advertised under Pavii names (the old ones still work), every shipped skill instructs with them, and the built-in agent is called Pavii CLI instead of its internal id
- **agents:** Kiro is detected on Windows — it was probed under a binary name only the macOS/Linux installer creates, so a working install still showed "not installed"; the stale result is cleared on upgrade rather than needing a manual re-check

---

## [2.2.4](https://www.pavii.tech/products/dev-tools/) (2026-08-27)

### Desktop

#### Bug Fixes

- **chat:** attached files and images are copied into the agent's workspace, so the agent can actually read them — and an image's path stays in the prompt alongside the pixels
- **skills:** token-optimizer shows up and auto-injects on installs upgraded from older versions (a stale imported copy was shadowing it)
- **ci:** the release mirror upload retries transient failures instead of failing the run

---

## [2.2.3](https://www.pavii.tech/products/dev-tools/) (2026-08-27)

### Desktop

#### Bug Fixes

- **installer:** updates are transactional — a failed update restores the previous installation instead of destroying it, silent updates retry locked files, foreign installations are never touched, and the registry entry survives a failed replacement
- **chat:** generated images render bounded (max 420px) with the caption below instead of overlapping, and inline file/image cards are properly styled inside chat

---

## [2.2.2](https://www.pavii.tech/products/dev-tools/) (2026-08-27)

### Desktop

#### Bug Fixes

- **updater:** the update feed now reads the public releases mirror, so the app updates even with the source repository private

---

## [2.2.1](https://www.pavii.tech/products/dev-tools/) (2026-08-26)

### Desktop

#### Features

- **welcome:** the feedback pill now books a call — "Tell us how you feel about the product"
- **about:** real brand marks for X, LinkedIn, Instagram, Medium, and Substack
- **skills:** token-optimizer is auto-injected into every CLI and carries a YAGNI rule for code
- **welcome:** new chats default to OpenCode; Pavii CLI is never auto-selected (still selectable manually)

#### Bug Fixes

- **theme:** buttons across the app now follow the Violet Bloom / Vercel palette (the Arco palette bridge was shadowed on `body`)

---

## [2.2.0](https://www.pavii.tech/products/dev-tools/) (2026-08-26)

### Desktop

#### Features

- **usage:** token statistics are recorded by the engine, once per turn, whatever drove it — desktop chats, background conversations, scheduled tasks, channel messages and WebUI all count, served from the new `/api/usage/ledger` endpoint
- **chat:** images an agent references by bare file path render as click-to-view cards; nothing is read from disk until asked, and a refused read fails visibly with a retry
- **profile:** sharing the activity card copies it to the clipboard for pasting into the composer, and the post carries both the download link and the site
- **models:** every provider shows its own logo, and Hugging Face joins the provider list with its router endpoint preset
- **about:** X, LinkedIn, Instagram, Medium and Substack profiles beside the version badge; Help documentation, Update log and Official website each open what their label says
- **ci:** a dispatchable Windows engine build, so testing an engine change no longer needs a local release build

#### Bug Fixes

- **brand:** the codex version-drift notice (and every other backend fallback string) no longer names AionUi — chat notices are translated via the codes the engine actually emits, and scrubbed as a safety net
- **usage:** the old renderer-side counter added a session running total every turn, double-counted duplicated frames and dropped claude cache tokens; the recorded history could not be repaired and restarts from zero
- **usage:** a ledger day without breakdowns no longer crashes the Profile page, and a backend that spent nothing can no longer be crowned most-used
- **profile:** the share card is written to the clipboard by the main process — the renderer clipboard API rejected image writes with no visible cause
- **profile:** sharing to Reddit posts a link post, with the destination in the URL field where Reddit renders it as a link
- **profile:** skills attached before the rebrand are counted under their Pavii names instead of splitting the tally
- **build:** engine-test and E2E CI jobs no longer die on runner disk space and Node heap limits

#### Notes

- The engine is built from vendored source, so `aioncoreVersion` is unused for this release.

---

## [2.1.66](https://www.pavii.tech/products/Super-Assistant/) (2026-08-22)

### Desktop

#### Bug Fixes

- **db:** a database whose migration checksums differ only by line endings now repairs itself and opens, instead of failing startup with "Local data migration failed" and advising a reinstall that could not help. A genuinely modified migration still refuses to open.

### Core

#### Bug Fixes

- **system:** the update check now mocks the repository it actually requests, fixing nine `check-update` tests that returned 502 on every CI run

---

## [2.1.65](https://www.pavii.tech/products/Super-Assistant/) (2026-08-22)

### Desktop

#### Features

- **ui:** buttons now use the theme radius and shadow tokens (violet-bloom 1.4rem), and the outline variant follows the palette instead of a hardcoded grey

#### Bug Fixes

- **db:** pin migration bytes with `*.sql -text` so locally built and CI-built engines compute the same checksums
- **system:** mock the repo the update check actually requests, fixing nine check-update tests

---

## [2.1.59](https://www.pavii.tech/products/Super-Assistant/) (2026-08-21)

### Desktop

#### Features

- **analytics:** report product usage to PostHog from both processes, with autocapture in allowlist mode and a single scrub function that rewrites file:// URLs, drops non-allowlisted properties and redacts keys, paths and emails
- **skills:** replace the Custom/Official tabs with one categorised page, official content first
- **skills:** bundle 62 curated MIT-licensed ECC skills as official pack content

---

## [2.1.58](https://www.pavii.tech/products/Super-Assistant/) (2026-08-21)

### Desktop

#### Features

- **models:** open the Models page on Free models, with the tabs ordered Free models / All providers / Your providers. Someone with nothing configured now lands on what they can actually use rather than an empty list; configured providers are one click away and unchanged.

---

## [2.1.57](https://www.pavii.tech/products/Super-Assistant/) (2026-08-21)

### Desktop

#### Features

- **models:** browse providers from the Models page. Three tabs -- Your providers (unchanged default), Free models (19 providers / 145 models with free tiers), and All providers. Picking one opens the add-provider form with the endpoint already mapped, so you only supply the key. Opening a provider's key page also offers the key from your clipboard when you return.

#### Notes

- The free-model catalogue is committed as JSON; there is no third-party request at runtime.
- Cloudflare Workers AI is listed but cannot be connected in one click -- its base URL contains an account-id placeholder only you can fill in.

---

## [2.1.56](https://www.pavii.tech/products/Super-Assistant/) (2026-08-21)

### Desktop

#### Bug Fixes

- **sentry:** stop reporting a missing DSN as a startup failure -- this build ships without one deliberately, so it logged an error on every launch right after the info line saying the report was skipped
- **update:** log "no release published yet" at info instead of error -- GitHub answers `releases/latest` with 406 until a production release exists, and five error lines per launch buried the feed problems that are actually actionable
- **mcp:** log a successful transport connection at info rather than warn, so a healthy startup stops looking like it had problems

#### Notes

- First release published through the tagged pipeline. The `macos-x64` leg that hung earlier runs on a retired Intel runner label has been removed, so `publish` can now complete.

---

## [2.1.55](https://www.pavii.tech/products/Super-Assistant/) (2026-08-21)

### Desktop

#### Features

- **skills:** rename the builtin skills so slash commands read Pavii -- `/aionui-config` is now `/pavii-config`, `/officecli` is now `/pavii-cli`, and the ten document skills are `pavii-cli-*`. The pre-rename names are filtered from the skills list so an existing install does not show both.

#### Notes

- The `officecli` executable the document skills invoke keeps its own name; only the skill wrapper is renamed.

---

## [2.1.54](https://www.pavii.tech/products/Super-Assistant/) (2026-08-21)

### Desktop

#### Features

- **team:** show what a teammate is doing instead of a raw MCP tool id -- the 14 team tools now read "Updating task", "Reading messages", "Sending message to teammate"

#### Bug Fixes

- **team:** heal members frozen on a backend they cannot start on, in place when the team is opened, instead of requiring the member to be removed and re-added
- **team:** retry transient attach failures again -- a generic start failure was being treated as permanent, so a member that one more attempt would have recovered stayed dead until retried by hand

#### Notes

- The engine is built from vendored source, so `aioncoreVersion` is unused for this release.

---

## 2.1.53 (2026-08-21)

### Bug Fixes

- **team:** teammates no longer fail to start with "This assistant failed to start". An
  assistant that runs on the internal engine needs a configured model provider; when none
  matched, the backend slug was persisted as the provider id, so every start attempt failed
  with `Provider 'aionrs' not found` and Retry re-read the same broken row. Such a teammate now
  runs on the team leader's backend instead, or is refused at creation with a message naming
  what to fix.
- **team:** a failed teammate now shows why it failed rather than a generic sentence, and a
  failure that cannot resolve itself no longer re-attaches on every reconcile.
- **i18n:** removed CJK punctuation that reached English tooltips, and closed the gap in the
  language gate that let it through.
- **rebrand:** the Agent Hub, the built-in assistant descriptions, and several engine messages
  no longer show upstream names.
- **installer:** failure dialogs no longer render paths with doubled backslashes.

### Features

- **security:** the shipped binary disables `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`, enables
  cookie encryption and asar-only loading, and adds webview, window-open and navigation guards.
- **privacy:** removed an automatic install that fetched and ran a script from a third-party CDN
  whenever an Office document was opened, along with the builtin skills that instructed the agent
  to do the same. See `docs/agent-context/privacy-audit.md` for every remaining outbound call.
- **tray:** Pause All now actually cancels every running conversation.
- **release:** publishing works again — the release build had been blocked on a retired macOS
  runner. Extension bundles are pinned by hash so a build cannot silently ship changed
  third-party code.

### Notes

- Teammates created before this version keep the broken provider id in their stored row and
  need re-adding; new teams are unaffected.
- The app ships English only.

## 2.1.52 — Pavii.Ai fork baseline (2026-08-17)

- Complete surface rebrand of the AionUi fork to Pavii.Ai: product name, logos, and branding assets
- Installer identity updated to `com.pavii.ai` / `PaviiAi.exe`, with `pavii://` deep links
- Data directories moved to the `~/.pavii*` family
- i18n strings rebranded across all 13 supported languages
- Built-in assistant renamed to "Your Pavii"; built-in agent renamed to "Pavii CLI"

Prior history is available in git.
