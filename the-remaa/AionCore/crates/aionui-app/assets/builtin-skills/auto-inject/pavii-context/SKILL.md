---
name: pavii-context
description: >
  Shared project context across sessions. Reads pavii-ard.md (architecture record) and
  pavii-hoff.md (handoff) from the working directory before starting work, so a new session
  continues where the last one stopped instead of asking again, and keeps both files current
  as the project changes.
  Use whenever working inside a project directory, and when the user asks what was decided or
  done previously, asks to record a decision, or is handing work to a later session.
---

# Project Context Skill

Two files in the working directory carry context between sessions:

- `pavii-ard.md` — architecture record: what the project is, how it fits together,
  which decisions were made and why.
- `pavii-hoff.md` — handoff: current state, what is finished, what comes next.

Templates are in `references/ard-template.md` and `references/hoff-template.md`.
Read a template only when you are about to create that file.

## Rules

1. Read both files before doing other work, whenever they exist. Never answer from
   assumption about this project while an unread record sits in the directory.
2. Act only in a real project directory — one containing `.git`, `package.json`,
   `Cargo.toml`, `pyproject.toml`, `go.mod`, or a comparable marker. Without one the
   directory is a temporary scratch workspace: read nothing, write nothing.
3. Decide whether you may write from the role stated in your own prompt:
   - `Role: lead` — you lead a team. You write both files on the team's behalf.
   - `Role: teammate` — you are a team member. Read only. Never write either file,
     even when you have information worth recording; report it to your leader instead.
   - No `Role:` line — you are working alone in a project. You write both files.
4. If the role is genuinely unclear, run `"$PAVII_HELPER_BIN" team context`. A non-zero
   exit means you are not in a team, so write. Do not treat that failure as an error and
   do not report it to the user.
5. Update after finishing something substantive — a feature, a fix, a decision, a
   constraint you discovered — or after roughly three to four exchanges, whichever comes
   first. This stays in force for the whole session; it does not lapse after many turns.
6. Do not update after a trivial turn. A question answered, a file read, or a one-line
   change is not worth a revision.
7. Record only what you have evidence for. Never invent content to fill a heading, and
   leave a section out rather than padding it.
8. Replace facts that have become stale. Do not append a contradiction next to the
   statement it contradicts.
9. Create a file only once there is something real to record. Do not scaffold empty
   documents at the start of a session.
10. Never write secrets, credentials, tokens, keys, or personal data into either file.
11. Keep both files short enough to be read at the start of every session. Cut history
    that no longer affects the work rather than letting either file grow without limit.

## Workflow

1. Look for `pavii-ard.md` and `pavii-hoff.md` in the working directory.
2. If either exists, read it before answering or making any change.
3. If neither exists and the directory is not a project (rule 2), stop here — this skill
   does not apply.
4. Do the work the user asked for.
5. When rule 5 is met and rule 3 permits you to write:
   - Put durable facts in `pavii-ard.md` — structure, decisions, constraints, risks.
   - Put the moving picture in `pavii-hoff.md` — state, next steps, blockers.
   - Create a missing file from its template in `references/`.
6. Do not announce the update or show its contents unless the user asks. Continue with
   the work.

## What goes where

| Fact | File |
| ------------------------------------------ | -------------- |
| Why a library or pattern was chosen | `pavii-ard.md` |
| A constraint that will outlive this session | `pavii-ard.md` |
| A known risk or piece of technical debt | `pavii-ard.md` |
| What is half-finished right now | `pavii-hoff.md` |
| The next concrete step | `pavii-hoff.md` |
| A blocker and what would unblock it | `pavii-hoff.md` |

When a fact fits both, put it in `pavii-ard.md` and reference it from `pavii-hoff.md`
rather than writing it twice.
