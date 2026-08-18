---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: 'What will the next session be used for?'
disable-model-invocation: true
---

# Handoff

Write a concise handoff document that lets a fresh agent continue the current work without rereading the conversation.

## Output

- Write the handoff to `docs/agent-context/handoff.md` unless the user specifies another path under this repository.
- Keep all generated files under `D:\pavii-a\special-enigma`. Do not use another drive or any path outside this repository for artifacts, caches, or temporary working files.
- Replace the existing handoff document when refreshing it so there is one current source of truth.

## Content

Include only information needed to resume effectively:

- Current objective and scope.
- Work completed and current state.
- Decisions, constraints, assumptions, and unresolved questions.
- Relevant file paths, commands, validation results, and known failures.
- Concrete next steps, ordered by dependency.
- A `Suggested skills` section naming project or installed skills the next agent should invoke and why.

If arguments are provided, treat them as the next session's intended focus. Tailor the summary, next steps, and suggested skills to that focus.

## Avoid Duplication

Do not reproduce details already captured in specifications, plans, architecture decision records, issues, commits, or diffs. Reference each existing artifact by repository-relative path, commit identifier, issue URL, or pull request URL and summarize only why it matters to the next agent.

Do not invent completed work, test results, decisions, or artifact locations. Clearly label uncertainty and blockers.
