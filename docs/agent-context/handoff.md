# Handoff — channel session management

Next session's focus: finish Phases 2–4 of managing sessions from Telegram,
Slack and Discord, then rebuild the engine and test against a real bot.

Read [`docs/adr/0001-channel-session-management.md`](../adr/0001-channel-session-management.md)
first — it carries the decisions and the reasoning. This file is only what you
need to pick the work up.

## Where things stand

Landed and green (`cargo test -p aionui-channel`, clippy clean at `-D warnings`):

| Module | What it does |
| --- | --- |
| `aionui-channel/src/session_directory.rs` | Lists every conversation the owner has, pages it, attaches a chat to one |
| `aionui-channel/src/commands.rs` | Resolves `/sessions`, `/status`, `/new`, `/help` before the agent sees them |
| `aionui-channel/src/approvals.rs` | Parks permission requests, expires them as denied, resolves exactly once |
| `aionui-channel/src/action.rs` | `session.list` / `session.attach` actions; `session.status` extended |
| `aionui-app/src/router/state.rs` | Wires the directory into production DI |

**48 tests** across the three modules, including cross-owner isolation, paging
with no duplicates, a failed attach leaving the pointer alone, and approval
expiry at the exact boundary.

## What is left, in the order I would do it

### 1. Wire approvals into the relay (largest, highest value)

`approvals.rs` exists but nothing calls it. Needed:

- **Stop forcing `yolo`** in `message_service.rs` (~line 337) and
  `orchestrator.rs` (~line 233). Until this changes, `Permission` events never
  fire and the registry stays empty.
- `AgentStreamEvent::{Permission, AcpPermission, Ask}` reach `stream_relay.rs`
  but are **not translated into `StreamAction`** — they are dropped. Add
  variants and render them as inline Allow/Deny buttons. `Ask` carries a
  `questions[]` array, so render one button per option, not a bare Allow/Deny.
- Route the button answer into `ChannelManager`'s existing
  `confirm_tx: mpsc::Sender<(String, String)>` — the return path is already
  there.
- Run `expire_older_than` on a timer and tell the chat when something expired.

### 2. Notifications on finish

**The plan was wrong about this — do not just hook `stream_relay`.** A relay
exists per *(chat, session)* and only when a chat dispatched the work. A session
started on the desktop has no relay to any chat, which is exactly the case the
user asked for.

You need a separate subscriber over session completion for the owner, pushing to
paired chats through `ChannelSender`. Suppress the notification when the chat is
already attached to that session — it is already streaming the output, so a
notification would be noise.

### 3. Retire the TypeScript bridges

`packages/desktop/src/process/services/channels/{slackBridge,discordBridge}.ts`,
their imports in `index.ts` (~line 399) and their accessors in
`applicationBridge.ts` (~line 151).

**Verify before deleting.** The Rust plugins are compiled in by default, but
confirm they actually serve live Slack/Discord traffic. If they do not, stop and
report rather than removing a working path.

### 4. Rebuild and test live

```bash
node scripts/build-aioncore.js
```

Takes ~2 minutes and **requires the desktop app closed** — Windows locks the
binary. The script runs the assistant-manifest test first, which is the only
thing that catches a corrupt catalogue.

Then walk it on a real bot: two sessions running, `/sessions` lists both,
attaching switches between them and neither stops; detach and confirm the finish
notification arrives; trigger a permission and confirm Allow resumes and Deny
stops; leave one unanswered and confirm it expires rather than hanging.

## Traps worth knowing before you start

- **Green tests are not a wired feature.** The directory passed every test while
  production had no directory configured. Assert the DI, not just the module.
- **`conversations.status` is NOT NULL** in the schema although the Rust model
  types it `Option<String>`. Fixtures that pass `None` fail on insert.
- **`conversations.user_id` is a foreign key into `users`.** Testing cross-owner
  isolation needs a real second user, not an invented id.
- **`session.status` already existed** before this work. A new match arm with
  the same name silently shadows it and only shows up as an unreachable-pattern
  warning.
- **Rust files here are CRLF.** Patch scripts that match on `\n` will fail to
  find anchors that are plainly present.
- **Never edit engine assets with PowerShell text cmdlets** — it has corrupted
  `assistants.json` twice. `bun run check:encoding` is the backstop.

## Standing constraints

- Approvals change behaviour for anyone already using channels: silent agents
  become agents that stop and wait. Expected, but call it out in release notes.
- The listing exposes every conversation to anyone paired with the bot. Pairing
  is the only gate.
- Engine changes need the six-target CI build, and the release currently has a
  **stuck macOS Intel runner** — nothing is published yet.
