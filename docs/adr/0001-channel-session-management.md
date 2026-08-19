# ADR 0001 — Managing sessions from chat channels

- Status: accepted, partially implemented
- Affects: `the-remaa/AionCore/crates/aionui-channel`, `crates/aionui-app/src/router/state.rs`
- Supersedes: the one-session-per-chat behaviour in `SessionManager::get_or_create_session`

## Context

A connected Telegram, Slack or Discord chat could only start a new session or
continue the one it already had. It could not see what else was running, switch
between sessions, approve anything, or learn that a long job had finished.

Three facts, established by reading the engine rather than assumed:

1. **All three platforms run through the Rust engine.** `aionui-app` compiles
   `telegram`, `slack` and `discord` on by default. The TypeScript
   `slackBridge.ts` / `discordBridge.ts` are a **second, parallel
   implementation**, imported at `packages/desktop/src/index.ts`.
2. **A chat owned exactly one session.** `get_or_create_session` keys on
   `chat_id`, and `session.new` called `reset_session` — which is why "new"
   replaced rather than added.
3. **Channel sessions auto-approve everything.** `message_service.rs` sets the
   session mode to `yolo`; `orchestrator.rs` states it outright. There was no
   Allow button to press because nothing ever asked.

## Decisions

### D1 — Build in the Rust engine, not the TypeScript bridges

All three platforms converge in `aionui-channel`, so session management,
notifications and approvals are written once instead of three times. The
TypeScript bridges are to be retired once it is confirmed they no longer serve
live traffic.

**Consequence:** every change here needs an engine rebuild
(`node scripts/build-aioncore.js`) and a six-target CI build. It cannot be
hot-reloaded like renderer work.

### D2 — A chat points at a session; it does not own one

`session_directory.rs` treats the per-chat row as a **pointer**. Attaching
repoints it and leaves the previously attached session running.

**Rationale:** if detaching stopped work, switching would cancel whatever was
running, and parallel sessions would be impossible. This is the property that
makes the whole feature work, and it is pinned by a test that asserts the
previous conversation is still `running` after a switch.

### D3 — The listing spans every conversation, not only channel-created ones

`/sessions` lists all conversations the owner has, including ones started on the
desktop, so a desktop conversation can be picked up from a phone.

**Consequence — accepted deliberately:** anyone paired to the bot can read and
continue any conversation, including private desktop ones. Pairing
(`pairing.rs`) is the only gate in front of that. Two tests assert cross-owner
isolation holds, on both listing and attach.

### D4 — Only the slash commands we own are intercepted

`commands.rs` resolves `/sessions`, `/status`, `/new` and `/help` before the
message reaches the agent. Everything else falls through.

**Rationale:** agents define their own slash commands. Swallowing unknown ones
would break all of them. Previously *no* command was handled, so `/sessions`
would have reached the model as an ordinary prompt.

### D5 — An unanswered approval expires as denied

`approvals.rs` parks a permission request and resolves it exactly once.
Unanswered requests expire after `APPROVAL_TIMEOUT_MS` (10 minutes) and resolve
as **denied**.

**Rationale:** nobody watches their phone at 03:00. A session blocked forever is
worse than one that stopped, and expiring toward *allow* would turn inattention
into authorization. Resolving exactly once prevents a late tap, a double tap, or
an answer racing the expiry sweep from sending the agent two decisions.

**Consequence:** turning approvals on is a **change of contract** for anyone
already using channels. Their sessions run unsupervised today and will begin to
stop and wait.

### D6 — The session directory is an optional dependency

`ActionExecutor::with_session_directory` rather than a new constructor
parameter, so the existing constructor call sites are untouched. Production
wires it in `build_channel_state`.

**Known risk, already hit once:** everything compiled and every test passed
while production had no directory wired, so the feature would have reported
"not configured" on a real bot. If this pattern is reused, assert the
production wiring, not just the module.

## Status of implementation

| Piece | State |
| --- | --- |
| `session_directory.rs` — list, page, attach, status | Done, 10 unit + 13 integration tests |
| `commands.rs` — slash command routing | Done, 9 tests |
| Action wiring + engine DI | Done |
| `approvals.rs` — pending registry, expiry, single-resolution | Done, 16 tests |
| Notifications on finish/error | **Not started** — see below |
| Approvals wired into the relay and `confirm_tx` | **Not started** |
| Un-`yolo` channel sessions | **Not started** |
| Retire the TypeScript bridges | **Not started** |
| Engine rebuild + live bot walkthrough | **Not done** |

## A correction to the original plan

The plan assumed notifications could hook into `stream_relay.rs`. That is wrong
for the case that matters most.

A relay exists per *(chat, session)* pair and is created when a chat dispatches
to an agent. **A session started on the desktop has no relay to any chat**, so
there is nothing to hook — which is precisely the "tell me when a session I did
not start from Telegram finishes" requirement.

Notifications therefore need a **separate subscriber** watching session
completion across the owner, which then pushes to paired chats via
`ChannelSender`. That is a larger piece than the plan implied and has not been
started.
