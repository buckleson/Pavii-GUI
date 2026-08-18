# Handoff

## Next-session Focus

No follow-up implementation task has been specified yet. Start from the user's next request.

## Current State

- Deterministic workflow requirements are recorded in [`AGENTS.md`](../../AGENTS.md#deterministic-agent-workflow).
- The current architectural context and codebase map are in [`docs/agent-context/architecture-record.md`](architecture-record.md).
- Two project-local context skills are available: `.claude/skills/architecture-recorder/SKILL.md` and `.claude/skills/handoff/SKILL.md`.

## Required Continuation Rules

- Keep all writes and generated artifacts inside `D:\pavii-a\special-enigma`.
- Apply YAGNI and decompose work into the smallest independently verifiable tasks.
- Use separate test-author, test-runner, and failure-analyst subagent roles as gated in `AGENTS.md`.
- Do not move to the next task until the current area's required checks pass.

## Suggested Skills

- `architecture` when creating or moving files/modules.
- `testing` for behavior changes, test design, and completion verification.
- `i18n` for new or changed user-facing text.
- `architecture-recorder` after material technical decisions or implementation changes.
- `handoff` before transferring work to another session or agent.

## Validation Status

- Passed independent checks for intended diff scope, skill frontmatter, heading order, repository-local paths, Markdown references, and formatting sanity.
- Application tests were not run because this change modifies instructions and documentation only.
