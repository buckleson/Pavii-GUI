---
name: architecture-recorder
description: Maintain the project-local architecture and agent context record after code, architecture, workflow, or repository-structure changes. Use when an agent needs to preserve architectural decisions, implementation context, changed-area navigation, or concise codebase-map updates for later agents in docs/agent-context/architecture-record.md.
---

# Architecture Recorder

Maintain exactly this record:

`D:\pavii-a\special-enigma\docs\agent-context\architecture-record.md`

Keep all reads, writes, commands, temporary output, and generated artifacts inside
`D:\pavii-a\special-enigma`. Never use the C drive. Apply YAGNI: record only context that a later agent needs to make or verify the current change.

## Deterministic Workflow

1. Read `AGENTS.md`, the existing architecture record if present, and the authoritative artifacts relevant to the completed change.
2. Inspect the final repository diff and status. Treat committed code, the current diff, tests, and referenced artifacts as authoritative; never infer decisions that the evidence does not support.
3. Update the record in place with `apply_patch`. Create its parent directory only when it does not exist.
4. Preserve unrelated valid entries. Replace stale facts rather than appending contradictory notes.
5. Sort entries in each list lexicographically by repository-relative path, then by title. Use repository-relative paths with forward slashes.
6. Run a final read-only check that the record matches the diff, contains no duplicated source material, and references only paths that exist or are explicitly marked as planned.

Do not change application code, tests, plans, ADRs, or other documentation while acting solely as the recorder.

## Record Structure

Use these headings in this order, omitting empty optional subsections:

```markdown
# Architecture Record

## Current Architecture

### Codebase Map

### Process and Module Boundaries

## Active Decisions

## Implementation Context

## Verification Pointers

## Referenced Artifacts
```

Under `Active Decisions`, use one compact entry per decision:

```markdown
### <stable decision title>

- Status: accepted | superseded
- Decision: <one sentence>
- Rationale: <only the constraint or tradeoff needed later>
- Affects: `<repository-relative path>`
- Evidence: `<path to ADR, spec, plan, commit, or diff-relevant file>`
```

Do not add dates, sequence numbers, author names, session IDs, or generated identifiers. Stable titles and ordering make repeated runs produce the same result for the same repository state.

## Content Rules

- Keep the codebase map concise: identify changed or architecturally important areas and their responsibilities, not every file.
- Capture process boundaries, public contracts, invariants, migration constraints, and non-obvious coupling only when supported by repository evidence.
- Record important coding context as short facts that affect future work, including where implementation and focused tests live.
- Reference existing specs, plans, ADRs, issues, commits, diffs, and test reports by path or URL. Do not restate their contents.
- Prefer a pointer to source code over copied signatures or code excerpts.
- Remove obsolete implementation notes once the code or a durable artifact makes them redundant.
- Mark uncertainty explicitly as `Unknown`; do not speculate.
- Never include secrets, credentials, personal data, full command logs, conversational narration, or transient debugging details.
- Do not create a decision merely to document formatting, routine refactoring, or an implementation detail with no future architectural consequence.

## Completion Check

Before reporting completion, verify:

- only the architecture record was changed by the recorder;
- every new claim has an authoritative evidence pointer;
- referenced paths use repository-relative forward-slash form;
- headings and list ordering follow this skill;
- no existing artifact content was duplicated;
- the record remains concise and useful to an agent entering the changed area.

Report which record sections changed and identify any unresolved `Unknown` entries. Do not claim architectural coverage beyond the areas evidenced by the current change.
