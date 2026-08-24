<div align="center">
  <img src="./resources/brand/the-logo.png" alt="Pavii.Ai" width="120" />

  <h1>Pavii.Ai</h1>

  <p><strong>Your personal AI workspace.</strong> Chat with local coding agents, run teams of assistants, automate on a schedule — on your own machine.</p>

  <p>
    <a href="https://github.com/buckleson/Pavii-GUI/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/buckleson/Pavii-GUI?style=flat-square&color=7c5cff" /></a>
    <a href="https://github.com/buckleson/Pavii-GUI/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/buckleson/Pavii-GUI/total?style=flat-square&color=32CD32" /></a>
    <a href="https://github.com/buckleson/Pavii-GUI/actions/workflows/release.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/buckleson/Pavii-GUI/release.yml?style=flat-square" /></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-informational?style=flat-square" />
    <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" /></a>
  </p>

  <p><a href="https://www.pavii.tech/products/Super-Assistant/">Product page</a></p>
</div>

## Download

<div align="center">

### Windows

[<img src="https://img.shields.io/badge/Download-Windows%20x64-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows x64" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-Windows-x64-Setup.exe)
[<img src="https://img.shields.io/badge/Download-Windows%20ARM64-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows ARM64" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-Windows-arm64-Setup.exe)

### macOS

[<img src="https://img.shields.io/badge/Download-Apple%20Silicon-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for Apple Silicon" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-macOS-arm64.dmg)
[<img src="https://img.shields.io/badge/Download-Mac%20Intel-555555?style=for-the-badge&logo=apple&logoColor=white" alt="Download for Intel Mac" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-macOS-x64.dmg)

### Linux

[<img src="https://img.shields.io/badge/AppImage-x64-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download AppImage x64" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-Linux-x64.AppImage)
[<img src="https://img.shields.io/badge/AppImage-ARM64-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download AppImage ARM64" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-Linux-arm64.AppImage)
[<img src="https://img.shields.io/badge/.deb-x64-A81D33?style=for-the-badge&logo=debian&logoColor=white" alt="Download deb x64" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-Linux-x64.deb)
[<img src="https://img.shields.io/badge/.deb-ARM64-A81D33?style=for-the-badge&logo=debian&logoColor=white" alt="Download deb ARM64" height="42" />](https://github.com/buckleson/Pavii-GUI/releases/latest/download/Pavii.Ai-Linux-arm64.deb)

<sub>All builds, checksums and release notes: <a href="https://github.com/buckleson/Pavii-GUI/releases/latest">releases page</a></sub>

</div>

> **First launch on macOS and Windows.** Releases are not yet code-signed, so the OS shows a warning the first time.
> On macOS: right-click the app -> **Open** -> **Open**, or run `xattr -dr com.apple.quarantine "/Applications/Pavii.Ai.app"`.
> On Windows: **More info** -> **Run anyway** on the SmartScreen prompt.

Requirements: Windows 10+, macOS 12+, or a modern Linux desktop - 4 GB RAM - ~1 GB disk.

## Features

- **Chat UI over local coding agents** — Pavii CLI, Claude Code, Codex CLI, OpenCode and more, side by side
- **Teams of assistants** that collaborate on a task
- **Skills** — a curated pack ships built in, and you can import your own
- **Scheduled automation** for recurring jobs
- **Desktop app + WebUI** — reach your workspace from your phone or another machine
- **Channels** — talk to your assistant from Telegram, Slack or Discord

## Privacy

Pavii.Ai runs on your machine. Conversations go only to the model provider you configure and the CLI agents you connect, and update checks contact only this repository's releases.

The app does send **product analytics** to PostHog (EU region) so we can see which features get used and when something breaks. What is sent: an id, app version, OS and architecture, and a fixed list of event names such as `app_opened`, `message_sent` and `turn_completed`. The id is random and per-install while you are signed out; once you sign in to a Pavii account, events are linked to that account's id instead. Your email address is never sent either way.

What is never sent: your conversations, prompts or model responses; file names, file contents or any filesystem path; API keys or credentials; your email or account name. Screen names are normalised before they leave the app, so a conversation appears as `/conversation/:id` and never as its real id. Anything not on the allowed list is dropped rather than sent, and an event that cannot be cleaned is discarded entirely.

There is currently **no in-app switch to turn analytics off** — it is compiled in at build time. If you need a build without it, set `POSTHOG_DISABLED=1` when building from source.

## Development

```bash
bun install
bun start          # desktop app in dev mode
bun run webui      # browser-accessible mode
```

Building installers, the CI matrix and the release flow are documented in [docs/contributing/development.md](docs/contributing/development.md). Architecture notes live in [docs/](docs/README.md).

## Translations

[中文](docs/readme/readme_ch.md) · [繁體中文](docs/readme/readme_tw.md) · [日本語](docs/readme/readme_jp.md) · [한국어](docs/readme/readme_ko.md) · [Español](docs/readme/readme_es.md) · [Português](docs/readme/readme_pt.md) · [Русский](docs/readme/readme_ru.md) · [Türkçe](docs/readme/readme_tr.md) · [Українська](docs/readme/readme_uk.md)

## License

Apache-2.0. Pavii.Ai is a fork of the Apache-2.0 licensed AionUi project, and bundles the Pavii.Ai Engine — a modified build of the MIT-licensed AionCore (see [the-remaa/AionCore/LICENSE](the-remaa/AionCore/LICENSE)).
