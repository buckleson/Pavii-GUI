# Changelog

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
