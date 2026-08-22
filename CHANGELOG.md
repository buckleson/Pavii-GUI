# Changelog

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
