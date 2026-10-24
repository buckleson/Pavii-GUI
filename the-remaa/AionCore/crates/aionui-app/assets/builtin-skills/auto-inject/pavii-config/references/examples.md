# pavii-config stdin examples

Examples use English sample text and `en-US`. For real localized assistant content, use the user's actual locale. All commands pass input through a stdin heredoc.

## Assistants

```bash
"$PAVII_HELPER_BIN" config assistants get <<'JSON'
{ "assistant_id": "current", "locale": "en-US" }
JSON

"$PAVII_HELPER_BIN" config assistants create <<'JSON'
{
  "name": "Requirements Analyst",
  "description": "Turn rough product ideas into clear PRDs",
  "agent_id": "2d23ff1c",
  "prompts": ["Turn this feature idea into a PRD", "Review this PRD and identify confusing parts for new users"],
  "enabled_skills": ["pavii-config"]
}
JSON

"$PAVII_HELPER_BIN" config assistants update <<'JSON'
{
  "assistant_id": "current",
  "locale": "en-US",
  "description": "Updated assistant description",
  "defaults": { "permission": { "mode": "fixed", "value": "plan" } }
}
JSON

"$PAVII_HELPER_BIN" config assistants state <<'JSON'
{ "assistant_id": "current", "enabled": true, "sort_order": 10 }
JSON

"$PAVII_HELPER_BIN" config assistants rule read <<'JSON'
{ "assistant_id": "current", "locale": "en-US" }
JSON

"$PAVII_HELPER_BIN" config assistants rule write <<'JSON'
{ "assistant_id": "current", "locale": "en-US", "content": "# Role\nYou are..." }
JSON

"$PAVII_HELPER_BIN" config assistants update <<'JSON'
{ "assistant_id": "current", "enabled_skills": ["pavii-config", "cron"] }
JSON
```

## Skills

```bash
"$PAVII_HELPER_BIN" config skills info <<'JSON'
{ "skill_path": "/absolute/path/to/skill" }
JSON

"$PAVII_HELPER_BIN" config skills import <<'JSON'
{ "skill_path": "/absolute/path/to/skill-or-parent-or-zip" }
JSON

"$PAVII_HELPER_BIN" config skills external-paths add <<'JSON'
{ "name": "Team Skills", "path": "/absolute/path/to/team-skills" }
JSON

"$PAVII_HELPER_BIN" config skills external-paths remove <<'JSON'
{ "path": "/absolute/path/to/team-skills" }
JSON
```

## MCP servers

```bash
"$PAVII_HELPER_BIN" config mcp servers create <<'JSON'
{ "name": "Local Tools", "transport": { "type": "stdio", "command": "my-mcp-server", "args": [], "env": {} } }
JSON

"$PAVII_HELPER_BIN" config mcp servers update <<'JSON'
{ "server_id": "mcp_123", "description": "Updated description" }
JSON

"$PAVII_HELPER_BIN" config mcp test-connection <<'JSON'
{ "name": "Local Tools", "transport": { "type": "stdio", "command": "my-mcp-server", "args": [] } }
JSON

"$PAVII_HELPER_BIN" config mcp oauth check-status <<'JSON'
{ "server_url": "https://mcp.example.com" }
JSON
```

## Providers

```bash
"$PAVII_HELPER_BIN" config providers create <<'JSON'
{ "name": "OpenAI", "platform": "openai", "base_url": "https://api.openai.com/v1", "api_key": "sk-..." }
JSON

"$PAVII_HELPER_BIN" config providers update <<'JSON'
{ "provider_id": "provider_123", "api_key": "sk-..." }
JSON

"$PAVII_HELPER_BIN" config providers detect-protocol <<'JSON'
{ "base_url": "https://api.example.com/v1", "api_key": "..." }
JSON

"$PAVII_HELPER_BIN" config providers models fetch <<'JSON'
{ "provider_id": "provider_123" }
JSON

"$PAVII_HELPER_BIN" config providers health-check <<'JSON'
{ "provider_id": "provider_123", "model": "gpt-4.1" }
JSON
```

## Settings

```bash
"$PAVII_HELPER_BIN" config settings patch <<'JSON'
{ "language": "en-US", "notification_enabled": true }
JSON

"$PAVII_HELPER_BIN" config settings client put <<'JSON'
{ "ui.zoomFactor": 1.2 }
JSON
```

## Agents

```bash
"$PAVII_HELPER_BIN" config agents enable <<'JSON'
{ "agent_id": "codex", "enabled": true }
JSON

"$PAVII_HELPER_BIN" config agents overrides get <<'JSON'
{ "agent_id": "codex" }
JSON

"$PAVII_HELPER_BIN" config agents overrides set <<'JSON'
{ "agent_id": "codex", "command_override": "/absolute/path/to/codex" }
JSON

"$PAVII_HELPER_BIN" config agents custom create <<'JSON'
{ "name": "Custom Agent", "command": "/absolute/path/to/agent-cli" }
JSON

"$PAVII_HELPER_BIN" config agents custom update <<'JSON'
{ "agent_id": "custom_agent_123", "name": "Custom Agent", "command": "/absolute/path/to/agent-cli" }
JSON

"$PAVII_HELPER_BIN" config agents custom try-connect <<'JSON'
{ "command": "/absolute/path/to/agent-cli" }
JSON
```

## Scheduled tasks

```bash
"$PAVII_HELPER_BIN" config cron current create <<'JSON'
{
  "name": "Daily Summary",
  "schedule": "0 18 * * MON-FRI",
  "schedule_description": "Weekdays at 6:00 PM",
  "message": "Review the conversation context and produce a concise end-of-day summary."
}
JSON

"$PAVII_HELPER_BIN" config cron current update <<'JSON'
{
  "job_id": "cron_123",
  "name": "Daily Summary",
  "schedule": "0 18 * * MON-FRI",
  "schedule_description": "Weekdays at 6:00 PM",
  "message": "Review the conversation context and produce a concise end-of-day summary."
}
JSON

"$PAVII_HELPER_BIN" config cron jobs create <<'JSON'
{
  "name": "Weekly Report",
  "schedule": { "kind": "cron", "expr": "0 9 * * MON", "tz": "Asia/Shanghai" },
  "message": "Produce the weekly report.",
  "conversation_id": "current",
  "created_by": "user"
}
JSON

"$PAVII_HELPER_BIN" config cron jobs update <<'JSON'
{ "job_id": "cron_123", "name": "Weekly Report", "schedule": { "kind": "cron", "expr": "0 10 * * MON" } }
JSON

"$PAVII_HELPER_BIN" config cron jobs run <<'JSON'
{ "job_id": "cron_123" }
JSON

"$PAVII_HELPER_BIN" config cron jobs skill save <<'JSON'
{ "job_id": "cron_123", "content": "# Skill\nTask-specific instructions." }
JSON
```
