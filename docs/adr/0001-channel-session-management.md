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
(`node scripts/build-paviicore.js`) and a six-target CI build. It cannot be
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
would break all of them. Previously _no_ command was handled, so `/sessions`
would have reached the model as an ordinary prompt.

### D5 — An unanswered approval expires as denied

`approvals.rs` parks a permission request and resolves it exactly once.
Unanswered requests expire after `APPROVAL_TIMEOUT_MS` (10 minutes) and resolve
as **denied**.

**Rationale:** nobody watches their phone at 03:00. A session blocked forever is
worse than one that stopped, and expiring toward _allow_ would turn inattention
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

### D7 — `/projects` is a second route, not a replacement for `/sessions`

`/sessions` stays a flat list of every conversation. `/projects` lists projects,
opens one, and starts a session inside it.

Two data-layer gaps had to close first: `IProjectStore` had no `list_projects`
and `ConversationFilters` had no `project_id`. Both are now present, and the
project filter is applied in SQL — filtering after the page LIMIT would return
short pages and skip rows.

**Projects are read from `projects`, not derived from conversations.** Deriving
would hide a project with no conversations yet, which is exactly where a first
conversation wants to be started.

### D8 — Project references travel without their `project_` prefix

Telegram caps callback data at 64 bytes.
`system:project.open:i=project_<uuid>` is 67; without the prefix it is 59. The
action already names the entity, so the prefix carries nothing a handler needs.
`resolve_project_ref` still accepts a prefixed reference so buttons minted by an
older build keep working.

The same budget is why the action is `project.start` and not
`project.new_session` (65 bytes), and why **a project listing does not page**: a
"next page in this project" button would need a project id _and_ a cursor — two
UUIDs, 72 bytes before any prefix. The listing shows up to
`PROJECT_SESSIONS_LIMIT` (24) and says so when it truncates.

### D9 — A session is "running" per the task manager, never per the row

`entry_label` used to read `conversations.status`. That was wrong in **both**
directions, and the reason is worth recording:

- `SessionRuntime::set_status` (`aionui-ai-agent/src/session_agent.rs:151`)
  writes only to an in-memory `Mutex`. It never touches the database.
- The row is written `"pending"` at creation
  (`aionui-conversation/src/service.rs:1369`) and `"finished"` on turn
  completion (`runtime_completion.rs:69`, `stream_persistence.rs:137`).
  **Nothing ever writes `"running"`.**

So a conversation that had never run a turn looked busy forever, and one that
was genuinely mid-turn looked idle. Running state now comes from
`IWorkerTaskManager::active_conversation_ids()` plus the task's own status; a
live task alone is not enough, because a warm idle agent still holds one.

`conversations.status` is deliberately left as it is. Making the runtime write
through would be a larger, riskier change that buys nothing here.

### D10 — A project-started session is bound by workspace, not by project id

`CreateConversationRequest` has no `project_id`, and a channel conversation is
only created lazily on the first message. What binds a conversation to a project
is `ConversationService::bind_project_best_effort`, which resolves
`extra.workspace` into a project.

So `project.start` looks up the project workspace folder, puts it on the chat
session, and `create_conversation_for_session` now carries `session.workspace`
into `extra.workspace`. The reply says a session is _ready_ rather than claiming
one exists, because none does until a message is sent.

### D11 — `/tasks` is read-only

Listing proves itself before enable/disable buttons exist: a mis-tap there stops
an automation silently and there is no undo on a phone.
`ICronRepository::list_all_for_user` already existed, so no new query was
needed. Times render relative to now, so no timezone has to be agreed between
the server and the reader; a next run in the past reads as "due now" rather than
a negative wait.

### D12 — The project picker hides temp projects

Every conversation gets a throwaway workspace, and `ProjectService` classifies
each one as `ProjectKind::Temp`. Listing them buried the real projects under one
entry per session, with nothing useful to open.

`SessionDirectory::list_projects` filters them out. The filter lives in the
channel layer, not `IProjectStore::list_projects`: the store method is
general-purpose, and hiding temps is a display decision. `project.open` is left
alone, so a temp project reached from an older button still opens rather than
starting to error.

### D13 — The channel brands `aionrs` on the way out

`aionrs` is a wire contract: the serialized `AgentType`, the value in
`conversations.type`, on-disk `.aionrs/` directories, and the `aionrs.config`
settings key. `session_context.rs` already said so at the one place that brands
a derived name. The desktop honours this by branding at the display boundary
(`assistantBranding.ts`); the channel commands were a **new display surface with
no such layer**, so the raw token reached the chat in three places: `/new`,
`/status`, and conversation titles like `tg-aionrs-<chat>`.

`aionui-channel/src/branding.rs` rewrites the token to `paviirs` for display
only, and `channel_conversation_name` now emits the branded token so new rows
stop storing it. Nothing stored is migrated — history is covered by the same
display pass, which is why the rewrite is token-bounded and idempotent.

**Deliberately not done:** renaming the stored value, the `.aionrs/` directories,
or the settings key. That would orphan every existing conversation, and the
engine warns against it in the code.

### D14 — An approval is addressed by a ticket, answered by an index

Telegram allows 64 bytes of callback data and rejects the whole message if one
button exceeds it. Neither natural key fits: an ACP tool-call id has no length
bound we control, and an AskUserQuestion option _value_ is a whole answer label.

So `ApprovalService` mints a short ticket per request and buttons carry
`t=<ticket>,v=<index>` — 25 bytes of scaffolding plus a short id, with the real
values held server-side. The index also means an option label can be any length
without touching the wire.

### D15 — Permissions and questions travel different channels

`ConversationService::confirm` answers a tool approval; `answer_ask` answers an
AskUserQuestion. Sending one down the other silently drops the answer and leaves
the agent blocked, so `ApprovalKind` is carried with every parked request and
decides the route.

Expiry differs too. A permission has an explicit refusal option, so expiry sends
it. A question does not — its answers are all legitimate choices — so expiry
sends `answer_ask(None)`, the documented "card dismissed" signal, rather than
picking an answer on the user's behalf.

### D16 — Un-`yolo` was not separable from the rest of the approval work

`build_channel_extra` now sets `session_mode: "default"` (the mode catalogue's
own default, `015_aionrs_mode_catalog.sql`) instead of `"yolo"`.

It had to land **last**. Turning it on before the return path worked would have
left every tool call hanging — strictly worse than auto-approving. Only new
conversations are affected: `extra` is written once at creation, so existing
channel conversations keep running unsupervised until replaced.

### D17 — Finish notifications subscribe to the event bus

Confirmed by implementation: `turn.completed` is broadcast on
`BroadcastEventBus` for every completed turn, whoever started it.
`FinishNotifier` subscribes there, filters on the owner (the bus carries every
user's events), resolves paired chats from channel sessions joined to their
platform identity, and suppresses the chat already attached to that conversation
because it streamed the whole turn.

### D18 — One callback encoding, owned outside the plugins

Every platform hands a button one opaque string and gives it back on a tap:
Telegram `callback_data`, Slack `value`, Discord `custom_id`. The encoding
(`category:action:k=v`) now lives in `aionui-channel/src/callback.rs` rather
than inside the Telegram plugin, because three copies would drift and the
encoding is what the entire button UI depends on.

It is encoded to **Telegram's 64-byte limit**, the tightest of the three (Slack
2000, Discord 100), so one format stays valid everywhere. `fits_budget` makes
that checkable, and the pickers and approvals each have a test asserting it.

### D19 — Buttons on Slack and Discord

Both plugins previously took `message.text` and dropped `message.buttons`, and
neither could receive a tap: Slack's Socket Mode loop handled only `events_api`,
and Discord's gateway only `MESSAGE_CREATE`. Every picker and approval prompt is
button-driven, so those platforms received unusable text.

Now: Slack renders Block Kit `actions` blocks and handles the `interactive`
envelope; Discord renders message components and handles `INTERACTION_CREATE`,
acknowledging within Discord's three-second window before routing so the user
never sees an interaction error. Over-long rows are split rather than truncated
— dropping a button would silently remove a choice — and Discord rows beyond the
message limit are counted and logged rather than hidden.

**Status: implemented and shape-tested, unproven on the wire.** The payload
shapes come from general knowledge of those APIs, not from captured traffic or a
schema in this repo. Neither platform is configured on this machine, so nothing
here has been exercised against a live Slack or Discord app.

### D20 — A platform that cannot ask does not stop to ask

`build_channel_extra` takes the platform. Approvals are rendered as buttons, so
on a platform without them the agent would stop, ask an unanswerable question,
and sit blocked until the ten-minute expiry denied it — strictly worse than
acting unsupervised. Those platforms keep `session_mode: "yolo"`.

Telegram, Slack, Discord, Lark and DingTalk render buttons; **WeChat does not**,
which is also why `stream_relay` carries a separate no-edit path for it.

## Status of implementation

| Piece                                                              | State                          |
| ------------------------------------------------------------------ | ------------------------------ |
| `session_directory.rs` — list, page, attach, status                | Done                           |
| `session_directory.rs` — projects, live running state, active list | Done                           |
| `scheduled_tasks.rs` — `/tasks` listing                            | Done                           |
| `branding.rs` — display branding for the channel                   | Done                           |
| `commands.rs` — slash command routing                              | Done                           |
| Action wiring + engine DI                                          | Done                           |
| `approvals.rs` + `approval_service.rs` — park, answer, expire      | Done                           |
| `permission_events.rs` — `AcpPermission` / `Ask` translation       | Done                           |
| Approvals wired into the relay and the confirm path                | Done                           |
| Un-`yolo` channel sessions                                         | Done                           |
| `finish_notifier.rs` — announce finished sessions                  | Done                           |
| Slack manifest command generation + drift guard                    | Done                           |
| Shared callback encoding (`callback.rs`)                           | Done                           |
| Slack + Discord buttons, both directions                           | Done, **unproven on the wire** |
| Platform-aware session mode                                        | Done                           |
| Discord application-command registration                           | **Not started** — see below    |
| Retire the TypeScript bridges                                      | **Refused** — see below        |

Test counts as of this change: 301 unit + 115 integration in `aionui-channel`,
plus 11 new `aionui-db` tests for `list_projects` and the project filter.
Clippy clean at `-D warnings`; `cargo fmt --check` clean.

## Corrections to the original plan

Three of these were found by reading the engine while implementing, and each
falsified something the plan asserted.

### Notifications cannot hook `stream_relay.rs`

A relay exists per _(chat, session)_ pair and is created when a chat dispatches
to an agent. **A session started on the desktop has no relay to any chat**, so
there is nothing to hook — which is precisely the "tell me when a session I did
not start from Telegram finishes" requirement.

Notifications therefore need a **separate subscriber** watching session
completion across the owner, which then pushes to paired chats via
`ChannelSender`.

### The confirm return path is a stub, not existing plumbing

The plan said the answer could be routed into `ChannelManager`'s `confirm_tx`
because "the return path is already there". It is not.
`orchestrator.rs::handle_confirm` logs the call id and returns. Delivering an
answer needs a `call_id` -> `conversation_id` lookup and a call into
`ConversationService::confirm(user_id, conversation_id, call_id, ConfirmRequest,
task_manager)`.

### `AgentStreamEvent::Permission` never fires

The plan listed `Permission`, `AcpPermission` and `Ask` as the events to
translate. `Permission(serde_json::Value)` is **never constructed anywhere in
the workspace** — it is only matched and ignored. The live event is
`AcpPermission(AcpPermissionEventData)`, which has two shapes:
`Confirmation(Confirmation)` (carries `id`, `call_id`, `description`, `options`)
and `Request(AcpPermissionRequestData)` (carries `tool_call.tool_call_id` and
`options`). `Ask` is separate again and answers through
`ConversationService::answer_ask`.

What the decision payload must look like is settled:
`SessionAgent::confirm` reads the option id out of `data` via
`confirm_option_id` — a bare JSON string, or an object keyed
`option_id` / `optionId` / `value` — and maps `PERM_ALLOW`,
`PERM_ALLOW_ALWAYS`, `PERM_REJECT` onto a `PermissionDecision`. Any other value
is treated as an AskUserQuestion answer label. `msg_id` in `ConfirmRequest` is
ignored by that path (`_msg_id`).

**Consequence for sequencing:** un-`yolo` is not separable from the rest of the
approval work. Turning it on without a complete return path would leave every
tool call hanging, which is worse than auto-approving.

### `/tasks` needed no new query, and has no "manual" kind

`ICronRepository::list_all_for_user` already existed and is already owner-scoped
in SQL. The plan's edge case for "a manual-only job with no schedule" does not
exist: `schedule_kind` is `CHECK`-constrained to `at`, `every` or `cron`.

## Two pieces deliberately not done

### Retiring the TypeScript bridges would strand credentials

The plan said to delete `slackBridge.ts` / `discordBridge.ts` after confirming
the Rust plugins serve live traffic. The check says do not.

The Rust plugins _are_ shipped: `aionui-app` has
`default = ["telegram", "lark", "dingtalk", "weixin", "slack", "discord"]` and
`plugins/mod.rs` registers both. But the two paths read **different credential
stores**:

- the TypeScript bridges read `pavii-channels.json` next to the app config
  (`channelStore.ts`), and are restored at every boot from
  `packages/desktop/src/index.ts`;
- the Rust plugins read the engine database through `IChannelRepository`.

So Slack/Discord credentials entered through the desktop today live somewhere
the Rust plugins never look. Deleting the bridges would break a working
integration with no migration. Retiring them needs a credential migration first;
that is its own piece of work, not a cleanup.

(The comment at the top of `slackBridge.ts` — "the closed aioncore engine has no
Slack support" — is now stale, since the vendored engine does have it.)

### Discord command registration is unverified ground

Slack and Telegram are done: Telegram registers over `setMyCommands`, and Slack
declares commands in its app manifest, generated from `menu()` by
`slack_manifest_commands` with tests guarding both directions of drift.

Discord needs application-command registration over its HTTP API. The plugin's
client (`plugins/discord/api.rs`) has no application-id call today, and the
repository holds no captured Discord traffic or schema to write one against —
so implementing it would mean asserting an API contract from memory, which the
engine's rules forbid. It also targets a path whose liveness is uncertain while
the TypeScript bridge is what serves Discord.

## A verification trap worth remembering

`aionui-channel` declares `default = []`; every platform lives behind a feature
flag. So `cargo test -p aionui-channel` compiles **none of the plugins** — 358
tests instead of 694 — and reports green while roughly three hundred plugin
tests never ran. It hid four real compile errors in code already called done.

The project gate is fine: `just test` runs `--workspace`, which builds
`aionui-app` and, through Cargo's feature unification, turns the plugin features
on (verified — `cargo test -p aionui-channel -p aionui-app --lib` reports 694).
Only the per-crate shortcut is blind.

**Per-crate runs must name the features:**

```
cargo test -p aionui-channel --features slack,discord,telegram,lark,dingtalk,weixin
```
