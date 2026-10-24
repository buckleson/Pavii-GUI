---
name: pavii-config
description: >-
  Configure Pavii.Ai with its config CLI. Use when the user asks to set up or change assistants, their rules (system prompts), skills, MCP servers, model providers, settings, agents, or scheduled tasks, or whether assistant changes affect this conversation.
---

# Pavii.Ai Config

Configure Pavii.Ai with the bundled agent-facing CLI. Do not discover ports, do not call raw backend paths, and do not depend on tools outside the bundled `Pavii Engine` binary.

## Rules

1. Use only `"$PAVII_HELPER_BIN" config ...`.
2. Never pass, inline, export, echo, or set any `AIONUI_...` environment variable, and never show one to the user — use and mention only the Pavii-named variables.
3. Listings return internal identifiers — agent types such as `aionrs`, row ids such as `632f31d2`, and legacy stored names. Never put them in anything the user reads. Call the built-in agent **Pavii CLI** (or "the built-in engine"), and refer to assistants and agents by display name. Use ids only inside commands, and show them only if the user needs them for a follow-up operation.
4. Put all command input in stdin JSON (heredoc `<<'JSON'`). Do not use flags for business fields.
5. When unsure which command or stdin fields are supported, run `"$PAVII_HELPER_BIN" config capabilities`.
6. Read context before changing the current assistant. Read before writing, then read back after writing.
7. Use `"assistant_id": "current"` when the user asks to change the assistant used by this conversation. Use `"conversation_id": "current"` when a command accepts a conversation selector.
8. Never reveal provider keys, MCP headers, stdio/agent env values, secret override values, or other secrets. Do not repeat secret values from the user's input. (CLI output redacts sensitive fields by default.)
9. If the CLI fails, report the stable `CONFIG_...` error from stderr in normal prose and do not claim the change was made.
10. After assistant changes, explain both persistence and effect timing (below). Saving and read-back do not mean the running conversation reloaded the changed behavior.
11. Configuration changes affect the user's live app. Keep changes narrow, show what changed in plain language, and avoid raw JSON unless the user asks for implementation detail.

## Output

Success prints `{"success": true, "data": {}, "meta": {"schema_version": 1}}`. Failure prints one stable error line to stderr; treat stderr as authoritative.

`"$PAVII_HELPER_BIN" config capabilities` returns `data.domains[].commands[]`: supported command paths, input mode, stdin fields, selector fields, read-back behavior, destructive behavior, context requirements, and fields redacted from output.

`"$PAVII_HELPER_BIN" config context` reads the current user, conversation, assistant, and local runtime context. If `data.assistant` is `null`, the conversation has no assistant: ask which assistant to edit before changing rules or defaults.

## Assistant change timing

Configuration persists immediately, but running conversations may keep the assistant snapshot taken when they started.

- Identity fields (`name`, `description`, `avatar`, recommended prompts): saved immediately; if the open UI shows old values, tell the user to refresh or reopen the assistant view.
- Runtime fields (`agent_id`, `defaults` — model, permission, skills, MCPs via `defaults.mcps` not `default_mcp_ids`, thought level — `enabled_skills`, and rules): apply to **new conversations** created from that assistant only. Say the change was saved and read back, and that it affects new conversations only.
- Skills and MCP defaults are not injected into the current runtime. A tool already available here can be used; otherwise the user should start a new conversation with the assistant.

## Commands

Prefix each with `"$PAVII_HELPER_BIN" config`. Stdin fields in parentheses. Full stdin examples: `references/examples.md`.

**Assistants**
- `assistants list`; `assistants get` (`assistant_id`, `locale`)
- `assistants create` (`name`, `description`, `agent_id`, `prompts[]`, `enabled_skills[]`)
- `assistants update` (`assistant_id`, `locale`, metadata fields, `defaults` e.g. `{"permission": {"mode": "fixed", "value": "plan"}}`, `enabled_skills`)
- `assistants state` (`assistant_id`, `enabled`, `sort_order`)
- `assistants rule read` (`assistant_id`, `locale`); `assistants rule write` (`assistant_id`, `locale`, `content`)

Use the user's actual locale (examples use `en-US`). Assistant rules are the system prompt. Preserve the user's existing useful rule instructions unless they ask to replace them. After a rule write or delete, say it was saved and read back but applies only to new conversations from this assistant; the current conversation keeps its rule snapshot.

**Skills**
- `skills list`; `skills info` (`skill_path`) to inspect before import; `skills import` (`skill_path`: skill, parent, or zip)
- Attach skills with `assistants update` (`enabled_skills`): read the assistant first, merge locally, send the full intended list — never append blindly. Do not say new skills are available in this conversation unless the runtime already exposes them.
- `"$PAVII_HELPER_BIN" config skills external-paths list`; `skills external-paths add` (`name`, `path`); `skills external-paths remove` (`path`)
- `skills market enable`; `skills market disable`

**MCP servers**
- `"$PAVII_HELPER_BIN" config mcp servers list`; `mcp servers create` (`name`, `transport`: `{"type": "stdio", "command", "args", "env"}`); `mcp servers update` (`server_id`, fields)
- `mcp test-connection` (`name`, `transport`); `mcp oauth check-status` (`server_url`)

**Providers**
- `"$PAVII_HELPER_BIN" config providers list`; `providers create` (`name`, `platform`, `base_url`, `api_key`); `providers update` (`provider_id`, fields)
- `providers detect-protocol` (`base_url`, `api_key`); `providers models fetch` (`provider_id`); `providers health-check` (`provider_id`, `model`)

**Settings**
- `"$PAVII_HELPER_BIN" config settings get`; `settings patch` — supported fields: `language`, `notification_enabled`, `cron_notification_enabled`, `command_queue_enabled`, `save_upload_to_workspace` (unknown fields are silently ignored)
- `settings client get`; `settings client put` — free-form key-value map (e.g. `"ui.zoomFactor": 1.2`); `null` removes a key; no fixed schema, so ask the user or read back first to discover keys

**Agents**
- `"$PAVII_HELPER_BIN" config agents list`; `agents enable` (`agent_id`, `enabled`)
- `agents overrides get` (`agent_id`); `agents overrides set` (`agent_id`, `command_override`)
- `agents custom create` (`name`, `command`); `agents custom update` (`agent_id`, `name`, `command`); `agents custom try-connect` (`command`; tests reachability, persists nothing); delete is also supported (see `config capabilities`)

**Scheduled tasks**
- Current conversation: `cron current list`; `cron current create` (`name`, `schedule` as a flat 5-field cron string, `schedule_description`, `message`); `cron current update` (same plus `job_id`). After success, state the task name and schedule in plain language; do not show `cron_...` ids unless needed.
- Global: `"$PAVII_HELPER_BIN" config cron jobs list`; `cron jobs create` (`name`, `schedule`, `message`, `conversation_id`, `created_by` — the last two required; `"conversation_id": "current"` attaches to this conversation); `cron jobs update` (`job_id`, fields); `cron jobs run` (`job_id`); `cron jobs skill save` (`job_id`, `content`).
- `cron jobs` `schedule` is a tagged object, not a string: `{"kind": "cron", "expr": "<cron-expr>", "tz": "<IANA-tz>"}` (recurring), `{"kind": "every", "every_ms": <ms>}` (interval), `{"kind": "at", "at_ms": <epoch-ms>}` (one-shot).
