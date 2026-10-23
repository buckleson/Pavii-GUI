---
name: pavii-context
description: >
  Shared project context across sessions. Reads .pavii/PAVII.md (architecture record and
  handoff) from the working directory before starting work, so a new session continues where
  the last one stopped instead of asking again, and keeps it current as the project changes.
  Use whenever working inside a project directory, and when the user asks what was decided or
  done previously, asks to record a decision, or is handing work to a later session.
---

# Project Context Skill

One file in the working directory carries context between sessions: `.pavii/PAVII.md`.
It has two sections:

- `## Architecture record` — what the project is, how it fits together, which decisions
  were made and why.
- `## Handoff` — current state, what is finished, what comes next.

Section templates are in `references/ard-template.md` (architecture record) and
`references/hoff-template.md` (handoff). Read a template only when you are about to create
that section.

The `.pavii/` folder also holds `sessions.json`, which Pavii itself writes. Never edit,
move, or delete `sessions.json` — only `PAVII.md` is yours to maintain.

## Rules

1. Read `.pavii/PAVII.md` before doing other work, whenever it exists. Never answer from
   assumption about this project while an unread record sits in the directory.
2. Act only in a real project directory — one containing `.git`, `package.json`,
   `Cargo.toml`, `pyproject.toml`, `go.mod`, or a comparable marker. Without one the
   directory is a temporary scratch workspace: read nothing, write nothing.
3. Decide whether you may write from the role stated in your own prompt:
   - `Role: lead` — you lead a team. You write the file on the team's behalf.
   - `Role: teammate` — you are a team member. Read only. Never write the file,
     even when you have information worth recording; report it to your leader instead.
   - No `Role:` line — you are working alone in a project. You write the file.
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
9. Create the file only once there is something real to record. Do not scaffold an empty
   document at the start of a session.
10. Never write secrets, credentials, tokens, keys, or personal data into the file.
11. Keep the file short enough to be read at the start of every session. Cut history
    that no longer affects the work rather than letting it grow without limit.

## Older context files

Earlier sessions kept the same context in two files at the working-directory root:
`pavii-ard.md` (architecture record) and `pavii-hoff.md` (handoff). If either exists:

1. Read it along with `.pavii/PAVII.md` (rule 1).
2. Only while `.pavii/PAVII.md` does not exist yet, and when rule 3 permits you to write,
   create it from the old files — `pavii-ard.md` into `## Architecture record`,
   `pavii-hoff.md` into `## Handoff` — dropping anything stale. Once `PAVII.md` exists,
   keep it current and do not fold the old files in again.
3. Never delete, move or edit the old root files; they belong to the user. A teammate
   leaves them alone too.

## Workflow

1. Look for `.pavii/PAVII.md` (and the older root files above) in the working directory.
2. If any exists, read it before answering or making any change.
3. If none exists and the directory is not a project (rule 2), stop here — this skill
   does not apply.
4. Do the work the user asked for.
5. When rule 5 is met and rule 3 permits you to write:
   - Put durable facts under `## Architecture record` — structure, decisions,
     constraints, risks.
   - Put the moving picture under `## Handoff` — state, next steps, blockers.
   - Create a missing file or section from its template in `references/`, creating the
     `.pavii/` folder if needed.
6. Do not announce the update or show its contents unless the user asks. Continue with
   the work.

## What goes where

| Fact                                        | Section                 |
| ------------------------------------------- | ----------------------- |
| Why a library or pattern was chosen         | `Architecture record`   |
| A constraint that will outlive this session | `Architecture record`   |
| A known risk or piece of technical debt     | `Architecture record`   |
| What is half-finished right now             | `Handoff`               |
| The next concrete step                      | `Handoff`               |
| A blocker and what would unblock it         | `Handoff`               |

When a fact fits both, put it under `Architecture record` and reference it from
`Handoff` rather than writing it twice.
