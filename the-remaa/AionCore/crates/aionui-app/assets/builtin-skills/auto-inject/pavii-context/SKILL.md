---
name: pavii-context
description: >
  Cross-session project context in .pavii/PAVII.md (architecture record, handoff). Use whenever
  working inside a project directory, and when the user asks what was decided or done before, asks to
  record a decision, or hands work to a later session.
---

# Project Context Skill

`.pavii/PAVII.md` in the working directory carries context between sessions. Sections:

- `## Architecture record` — what the project is, how it fits together, decisions and why.
- `## Handoff` — current state, what is finished, what comes next.

Templates: `references/ard-template.md` (architecture record), `references/hoff-template.md` (handoff). Read a template only when about to create that section.

`.pavii/sessions.json` is written by Pavii. Never edit, move, or delete it — only `PAVII.md` is yours.

## Rules

1. Read `.pavii/PAVII.md` before other work whenever it exists. Never answer from assumption while an unread record sits in the directory.
2. Act only in a real project directory — one containing `.git`, `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, or a comparable marker. Without one the directory is a temporary scratch workspace: read nothing, write nothing.
3. Decide whether you may write from the role in your own prompt:
   - `Role: lead` — you lead a team; write the file on the team's behalf.
   - `Role: teammate` — Read only. Never write the file, even with information worth recording; report it to your leader instead.
   - No `Role:` line — working alone; write the file.
4. If the role is genuinely unclear, run `"$PAVII_HELPER_BIN" team context`. A non-zero exit means not in a team, so write. Do not treat that failure as an error or report it.
5. Update after finishing something substantive (feature, fix, decision, discovered constraint) or after roughly three to four exchanges, whichever comes first. This holds for the whole session.
6. Do not update after a trivial turn (question answered, file read, one-line change).
7. Record only what you have evidence for. Never invent content to fill a heading; leave a section out rather than pad it.
8. Replace stale facts; do not append a contradiction next to them.
9. Create the file only once there is something real to record; no empty scaffold at session start.
10. Never write secrets, credentials, tokens, keys, or personal data into the file.
11. Keep the file short enough to read every session; cut history that no longer affects the work.

## Older context files

Earlier sessions used `pavii-ard.md` (architecture record) and `pavii-hoff.md` (handoff) at the working-directory root. If either exists:

1. Read it along with `.pavii/PAVII.md`.
2. Only while `.pavii/PAVII.md` does not exist, and when rule 3 permits writing, create it from them (`pavii-ard.md` → `## Architecture record`, `pavii-hoff.md` → `## Handoff`), dropping stale content. Once `PAVII.md` exists, do not fold them in again.
3. Never delete, move or edit the old root files; they belong to the user. A teammate leaves them alone too.

## Workflow

1. Look for `.pavii/PAVII.md` (and the older root files). If any exists, read it before answering or changing anything.
2. If none exists and the directory is not a project (rule 2), stop — this skill does not apply.
3. Do the requested work.
4. When rule 5 is met and rule 3 permits writing: durable facts (structure, decisions, constraints, risks, technical debt, why a library or pattern was chosen) go under `## Architecture record`; the moving picture (half-finished work, next concrete step, blockers and what would unblock them) under `## Handoff`. A fact that fits both goes under `Architecture record`, referenced from `Handoff`. Create a missing file or section from its template, creating `.pavii/` if needed.
5. Do not announce the update or show its contents unless asked. Continue the work.
