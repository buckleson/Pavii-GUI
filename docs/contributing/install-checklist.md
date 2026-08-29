# Install checklist

What a user actually gets on each platform and install path, and what to check
before a release. Written after two live failures — an auto-updated Windows
install lost its desktop shortcut, and a macOS install ended up with no icon —
both of which were invisible to every existing test.

Facts here were verified against the code and the electron-builder templates on
2026-08-28. Where something is unverified or unfixed it says so.

## Coverage matrix

|                             | Windows (installer) | Windows (auto-update)    | macOS (DMG drag)  | macOS (one-liner)          | Linux `.deb` | Linux AppImage       |
| --------------------------- | ------------------- | ------------------------ | ----------------- | -------------------------- | ------------ | -------------------- |
| Launcher entry              | Start menu ✅       | preserved ✅             | Launchpad ✅      | Launchpad ✅               | app menu ✅  | ❌ none              |
| Desktop icon                | ✅                  | ✅ _(fixed — see below)_ | n/a by convention | n/a by convention          | ❌ menu only | ❌ none              |
| Correct app icon            | ✅                  | ✅                       | ✅                | ✅ _(needs cache refresh)_ | ✅           | ✅                   |
| Deep link `pavii://`        | ✅                  | ✅                       | ✅                | ✅                         | ✅           | ⚠️ needs integration |
| Install-time failure codes  | ✅ E1001–E1040      | ✅                       | ❌ none           | ❌ none                    | ❌ none      | ❌ none              |
| First-run failure detection | ✅                  | ✅                       | ✅                | ✅                         | ✅           | ✅                   |

"First-run failure detection" is `classifyBackendStartupFailure`
(`packages/desktop/src/process/startup/backendStartupFailure.ts`) — it runs on
every platform and is the only install-integrity check macOS and Linux have.

## Shortcuts

**Windows.** `createDesktopShortcut: true` creates the icon on a fresh or manual
install and does **nothing** on auto-update. Two template facts make this
non-obvious:

- `setIsTryToKeepShortcuts` (`installUtil.nsh`) — because
  `allowToChangeInstallationDirectory` is set, `keepShortcuts` can only be true
  during an update.
- `addDesktopLink` (`installer.nsh`) — the `CreateShortCut` call sits behind
  `${if} $keepShortcuts == "false"`, so it never runs on an update.

**Raising the value to `"always"` does not fix it.** That defines
`RECREATE_DESKTOP_SHORTCUT`, whose branch requires `keepShortcuts == "true"`
(i.e. an update) but is itself guarded by `${ifNot} ${isUpdated}` — mutually
exclusive, dead code for this configuration.

The fix is `AIONUI_ENSURE_DESKTOP_SHORTCUT` in
`resources/windows/installer-update-verify.nsh`, called from `customInstall`. It
creates the shortcut **only when absent**, so a deliberately deleted icon is not
resurrected on every update.

Name the link `${SHORTCUT_NAME}`, never `${PRODUCT_FILENAME}` — they differ here.
`PRODUCT_FILENAME` follows `executableName` (`PaviiAi`), `SHORTCUT_NAME` follows
`shortcutName` (`Pavii.Ai`). Getting this wrong orphans an icon on uninstall,
because the uninstaller only deletes the `SHORTCUT_NAME` path.

**macOS.** No desktop-shortcut convention — `/Applications` is what populates
Launchpad and Spotlight, and the DMG ships an `/Applications` symlink for
drag-install. Nothing to create.

**Linux.** The `.deb` installs a `.desktop` entry, so the app appears in the
application menu. AppImage installs nothing at all — see Known gaps.

## Icons

The shipped `resources/app.icns` is valid (all 8 modern variants). A missing or
generic icon on macOS is almost always the **icon cache**, not the build:
replacing a bundle at a path that already held one leaves Finder, the Dock and
Launchpad showing the stale icon.

- Copy app bundles with `ditto`, never `cp -R` — `cp -R` does not reliably
  preserve extended attributes and mishandles symlinks inside Electron's
  frameworks.
- Always follow a replace with `touch /Applications/Pavii.Ai.app && killall Dock`.
- If still generic: `sudo rm -rf /Library/Caches/com.apple.iconservices.store && killall Dock Finder`.

Ad-hoc signing (`codesign --force --deep --sign -`) is **load-bearing, not
cosmetic**: builds are ad-hoc signed only (`scripts/afterSign.js` falls back when
no Apple credentials are present), and arm64 refuses to execute a binary with no
valid signature.

## PATH

**Nothing is written to the persistent user or system PATH on any platform, and
nothing needs to be.** The app never edits the user's environment. All PATH work
is process-local and disappears when the app exits:

- Windows — `process/startup/windowsPath.ts` _reads_ the registry and shell
  profiles to hydrate the child environment.
- macOS/Linux — `fixPath()` plus explicit nvm supplementation.
- Bundled OpenCode is **appended** (`packages/web-host/src/ensure-opencode.ts`),
  deliberately, so a user's own `opencode` earlier on PATH still wins.

Consequence worth knowing: a CLI the user installs while the app is running is
invisible to it until the app restarts, because Windows only hands the updated
PATH to newly created processes. This is why a freshly installed agent CLI can
read "not installed" until the app is quit from the tray and relaunched.

## Dependencies

Bundled — no user action: the engine, Node 24.11.0, the `claude` and `codex`
CLIs, OpenCode, agent hub packs, skill packs.

External, and what happens if absent:

| Dependency         | Needed for              | If missing                                                                                                    |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `node`/`npm`/`npx` | third-party MCP servers | engine prefers its own bundled Node; other bare commands fail with a PATH error surfaced in the MCP panel     |
| `python`/`python3` | some agent spawns       | spawn fails                                                                                                   |
| `officecli`        | Office document preview | UI shows a manual install command; never auto-installed (a third-party auto-install was deliberately removed) |
| glibc ≥ 2.28       | Linux                   | detected at startup → `backend_incompatible_runtime`                                                          |
| FUSE / libfuse2    | AppImage                | **undocumented — see Known gaps**                                                                             |

`deb.depends` is now declared explicitly rather than inherited, so an
electron-builder upgrade cannot silently change what the package requires.

## Before a release

1. Fresh install on Windows — desktop **and** Start-menu shortcut appear, both
   launching the app.
2. Auto-update on Windows — desktop shortcut still present afterwards. This is
   the case that regressed and that no automated test can cover.
3. Delete the desktop shortcut, then auto-update — it should **stay** deleted.
4. macOS — app appears in Launchpad with the correct icon, not a generic one.
5. Linux `.deb` — appears in the application menu with the right icon.
6. `pavii://` deep link opens the app on each platform.
7. Uninstall on Windows leaves no orphaned `.lnk` on the desktop.

## Known gaps

Recorded deliberately; none are fixed.

- **AppImage has no desktop integration at all** — no menu entry, no icon, no
  deep-link registration — and its FUSE requirement is documented nowhere in this
  repo. Fixing it needs either AppImageLauncher guidance or a first-run
  `.desktop` writer.
- **macOS and Linux have no install-time failure detection.** There is no `.pkg`,
  no deb maintainer scripts, no equivalent of the Windows E10xx codes. Every
  problem surfaces at first launch instead.
- **Four error codes are defined but never raised**: `E1050`, `E1060`, `E1070`,
  `E1090`. Same dead-code class as `E1020`, which sat unused until 2026-08-28 —
  a disk-full install reported as a corrupt download the whole time.
- **Windows registry `DisplayVersion` is not refreshed by silent updates.**
  Observed on 2026-08-28: the exe was 2.2.6 while "Installed apps" still read
  2.2.2. Cosmetic, but it makes the installed version untrustworthy in support.
