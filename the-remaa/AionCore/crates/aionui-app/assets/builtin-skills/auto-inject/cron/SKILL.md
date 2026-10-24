---
name: cron
description: Create, list, or update this conversation's scheduled task. Use when the user asks to run, remind, or repeat something at a set time or on a recurring schedule.
---

# Scheduled Task Skill

Manage this conversation's scheduled task with the bundled config CLI.

## Rules

1. At most one scheduled task per conversation.
2. Always list existing tasks before creating or updating.
3. Do not ask for extra confirmation once the user requested the scheduling change.
4. Never pass, inline, export, echo, or set any `AIONUI_...` environment variable.
5. Call `"$PAVII_HELPER_BIN" config cron current ...` directly.
6. Pass create and update payloads through a stdin heredoc attached to the command. Do not write payload JSON files to disk.
7. Put `job_id` in the update JSON payload, not in a command flag.
8. After a successful create or update, send one short confirmation a normal user understands, with the task name and schedule description. Do not show internal ids such as `cron_...`.
9. If the CLI fails, report the stderr/stdout failure in normal prose; do not claim the task was created.

## Workflow

1. `"$PAVII_HELPER_BIN" config cron current list`
2. Empty `data` array → create. One task and the user wants it changed → update it. A task exists and the user wants a different additional task → ask how to handle the existing one.
3. Report the CLI result per rules 8–9.

```bash
"$PAVII_HELPER_BIN" config cron current create <<'JSON'
{
  "name": "Weekly Meeting Reminder",
  "schedule": "0 9 * * MON",
  "schedule_description": "Every Monday at 9:00 AM",
  "message": "Reply with a short weekly meeting reminder that includes the current date and time."
}
JSON

"$PAVII_HELPER_BIN" config cron current update <<'JSON'
{
  "job_id": "cron_123",
  "name": "Daily Summary",
  "schedule": "0 18 * * MON-FRI",
  "schedule_description": "Weekdays at 6:00 PM",
  "message": "Review today's conversation context and produce a concise end-of-day summary."
}
JSON
```

## Payload

- `name`: short descriptive name. `schedule_description`: human-readable schedule. Write both, and `message`, in the user's language.
- `schedule`: standard 5-field cron `minute hour day-of-month month day-of-week` (e.g. `0 9 * * MON-FRI` = weekdays 9:00 AM). Only standard fields and ranges; no Quartz extensions (`L`, `L-N`, `W`, `LW`, `#`, `?`).
- `message`: complete, self-contained instruction the AI runs when the task fires — not a restatement of the request. Use `\n` for multiple paragraphs. "Send me hello every day at 10am" → `Reply with exactly: Hello!` (not `Send me hello`); "Summarize AI news every Monday" → `Search for the latest AI news from this week and produce a concise bullet-point summary.`
- Update: same fields plus `job_id` from the list result.
