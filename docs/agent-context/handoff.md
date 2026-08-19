# Handoff — channel session management

All eight planned phases are closed: six implemented, two deliberately not done
with the reasoning recorded. Next session's focus is a live walkthrough on the
real bot, then the two follow-ups at the bottom.

Read [`docs/adr/0001-channel-session-management.md`](../adr/0001-channel-session-management.md)
first — decisions D1–D17, plus the places the original plan turned out to be
wrong.

## Where things stand

**Run the channel tests with the platform features, always:**

```
cargo test -p aionui-channel --features slack,discord,telegram,lark,dingtalk,weixin
```

Without them `aionui-channel` compiles **no plugins at all** (`default = []`) —
358 tests instead of 694 — and reports green while every plugin test sits dark.
That hid four real compile errors during this work. `just test` (`--workspace`)
is fine: it builds `aionui-app`, whose defaults enable the features (verified:
`cargo test -p aionui-channel -p aionui-app --lib` reports 694).

694 unit + integration, all green with features. Clippy clean at `-D warnings`,
`cargo fmt --check` clean, `bun run check:encoding` clean.

| Command                    | What it does                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `/sessions`                | Flat list of every conversation, paged, tap to attach           |
| `/projects`                | Projects (temp workspaces hidden), then that project's sessions |
| `/active_works`            | Only sessions executing right now; tap to attach and interject  |
| `/tasks`                   | Scheduled tasks, soonest first, next run relative to now        |
| `/status`, `/new`, `/help` | Unchanged                                                       |

Beyond commands:

- **Approvals.** The agent now stops and asks. A request is parked in
  `ApprovalService`, rendered as buttons, answered through `system.confirm`, and
  denied automatically after `APPROVAL_TIMEOUT_MS` (10 min) with the chat told.
- **Finish notifications.** `FinishNotifier` subscribes to `turn.completed` on
  the event bus and tells paired chats, including for sessions started on the
  desktop.
- **Branding.** `aionrs` never reaches a chat; `branding.rs` rewrites it to
  `paviirs` on the way out.
- **Buttons on Slack and Discord.** Both plugins used to drop `message.buttons`
  and could not receive a tap, so every picker arrived as unusable text. Both
  now render (Block Kit / message components) and handle the inbound side
  (`interactive` envelope / `INTERACTION_CREATE` with a deferred ack). One
  shared encoding in `callback.rs`, sized to Telegram's 64-byte limit so the
  same format is valid on all three.
- **WeChat keeps auto-approving.** It cannot render buttons, so an approval
  there would hang until expiry; `build_channel_extra` is platform-aware.

## What to walk on the real bot

The tests cover the state machines; these are the parts only a live run proves.

1. Trigger a tool the agent needs permission for. Confirm buttons appear, that
   **Allow resumes** and **Deny stops**, and that the deny button is last.
2. Leave one unanswered for ten minutes. It should be denied automatically and
   the chat should say so, rather than the session hanging.
3. Answer a stale button (one already answered). It should say so, not no-op.
4. Start a session **on the desktop**, let it finish. A paired chat should be
   told, with an Open button. The chat attached to that same session should
   **not** be told.
5. Two sessions running at once, switch between them; neither should stop.
6. Repeat the command checks on Slack and Discord.

**Un-`yolo` only affects new conversations** — `extra` is written once at
creation. An existing channel conversation keeps running unsupervised, so start
a fresh one to see approvals at all.

## The one thing not proven

**Slack and Discord buttons have never touched a live app.** The payload shapes
come from general knowledge of those APIs, not from captured traffic or a schema
in this repo, and neither platform is configured here (`assistant_plugins` holds
only `telegram`; no `pavii-channels.json`). The tests pin the shapes and prove a
foreign tap is never treated as an action — they cannot prove Slack accepts the
Block Kit or Discord the components.

Connect one (Slack is the smaller setup) and check: `/sessions` renders tappable
buttons, a tap attaches, an approval resolves. Until then the honest status is
"implemented, shape-tested, unproven on the wire".

## Follow-ups, in the order worth doing

### 1. Migrate Slack/Discord credentials, then retire the TS bridges

Refused for now, and why matters: the bridges read `pavii-channels.json`
(`channelStore.ts`) while the Rust plugins read the engine DB via
`IChannelRepository`. Deleting them would strand any credentials the user
entered through the desktop. The Rust plugins _are_ shipped
(`default = [... "slack", "discord"]`), so the missing piece is a one-way
migration from that JSON file into the channel plugin table, then the deletion
of `slackBridge.ts` / `discordBridge.ts`, their imports in `index.ts` (~399) and
accessors in `applicationBridge.ts` (~151).

### 2. Discord application-command registration

Telegram registers over `setMyCommands`; Slack is declared in its app manifest,
generated by `commands::slack_manifest_commands` with tests guarding drift in
both directions. Discord needs registration over its HTTP API, which
`plugins/discord/api.rs` has no application-id call for. There is no captured
Discord traffic or schema in the repo to write it against, and the engine's
rules forbid asserting an API contract from memory — so capture or cite a source
first.

### 3. Errored finishes

`FinishNotifier` fires on `turn.completed`, which is emitted for a normal end.
Whether a failed turn emits it, or emits something else, is **not yet checked**.
Worth confirming before claiming errors are covered.

## Traps worth knowing

- **Green tests are not a wired feature.** The session directory passed every
  test while production had no directory configured. `SessionDirectory::new`
  now takes its dependencies as required parameters so the compiler catches it.
  `ApprovalService` is the same shape and is easier to get wrong: **the relay
  and the action executor must share one instance**, or every button presses
  against an empty registry. `build_channel_state` builds it once.
- **`IWorkerTaskManager::active_conversation_ids` has a default impl returning
  an empty vec.** A double that forgets to override it makes every
  running-state assertion vacuously pass.
- **A test that asserts "no error" proves nothing about delivery.** The
  approval tests use a `RecordingAgent` that captures what it was told; a mock
  that just returns `Ok` would pass even if the answer never left the channel.
- **The task manager and the event bus are both global.** Every id and event
  must be checked against the owner before it is shown or acted on.
- **Callback data is 64 bytes, and one over-long button makes Telegram reject
  the whole message.** Three tests measure it (`project_callbacks_fit_…`,
  `approval_buttons_fit_…`, `the_open_button_fits_…`). Add one for any new
  button.
- **Foreign keys and CHECK constraints bite in fixtures.**
  `conversations.user_id` → `users`, `cron_jobs.conversation_id` →
  `conversations`; `cron_jobs.execution_mode` is `existing|new_conversation`,
  `last_status` is `ok|error|skipped|missed`, `schedule_kind` is
  `at|every|cron`.
- **Rust files here are CRLF.** Patch scripts matching on `\n` will fail to find
  anchors that are plainly present.
- **`check-encoding` does not catch control characters.** A mis-escaped patch
  wrote literal `U+0008` into a TypeScript regex and the gate passed it. A task
  chip is open to add the rule.
- **Two pre-existing `aionui-conversation` failures** are unrelated and fail
  identically on a clean tree (verified by stashing):
  `create_rejects_unavailable_workspace_with_trailing_whitespace_in_request`
  and `is_auto_workspace_matches_by_structure_across_user_and_date`. Both are
  Windows path handling.

## Standing constraints

- The session listing exposes every conversation to anyone paired with the bot.
  Pairing is the only gate.
- Approvals change behaviour for anyone already using channels. Call it out in
  release notes.
- Engine changes need `node scripts/build-paviicore.js` (desktop app closed) and
  then the six-target CI build. The release still has a **stuck macOS Intel
  runner** — nothing is published yet.
- All of this work is **uncommitted** in the working tree.
