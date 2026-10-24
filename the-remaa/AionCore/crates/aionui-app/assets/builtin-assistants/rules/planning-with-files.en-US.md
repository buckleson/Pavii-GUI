# Planning with Files - Manus-Style File-Based Planning

Use persistent markdown files as "working memory on disk": the context window is volatile and limited; the filesystem is persistent. Anything important gets written to disk.

## The 3-File Pattern

For every complex task, create three files in the project directory (templates below):

| File           | Purpose                     | When to update      |
| -------------- | --------------------------- | ------------------- |
| `task_plan.md` | Phases, progress, decisions | After each phase    |
| `findings.md`  | Research, discoveries       | After ANY discovery |
| `progress.md`  | Session log, test results   | Throughout session  |

Use for: multi-step tasks (3+ steps), research, building projects, tasks spanning many tool calls. Skip for: simple questions, single-file edits, quick lookups.

## Timing Rules

- **Task start:** MUST create all three files FIRST, before any other work, and fill in the Goal in `task_plan.md`.
- **Before major decisions** (writing/editing files, running commands, architectural decisions, implementing features): MUST re-read `task_plan.md` with the Read tool.
- **After file operations / completing a phase:** MUST immediately update phase status in `task_plan.md` (`pending` → `in_progress` → `complete`), log errors, note files created/modified.
- **Before task end:** MUST verify all phases are `complete`, review deliverables, ensure no unresolved errors.

## Rules

1. Never start a complex task without `task_plan.md`.
2. **2-Action Rule:** after every 2 view/browser/search operations, IMMEDIATELY save key findings to `findings.md` (multimodal info is lost otherwise).
3. Read the plan before major decisions.
4. Update after acting.
5. Log ALL errors in the plan file.
6. Never repeat a failed action; track attempts and change the approach.
7. Use these files, not TodoWrite, for persistence; store large content in files, not context.

Read vs write:

- Just wrote a file → don't re-read it.
- Viewed image/PDF or browser returned data → write findings now.
- Starting a new phase or handling an error → read plan/findings or the relevant file.
- Resuming after a gap → read all planning files.

## 3-Strike Error Protocol

1. Diagnose and fix: read the error, find the root cause, apply a targeted fix.
2. Alternative approach: different method/tool/library. NEVER repeat the exact failing action.
3. Broader rethink: question assumptions, search for solutions, consider updating the plan.
4. After 3 failures: escalate to the user — explain what you tried, share the specific error, ask for guidance.

## 5-Question Reboot Test

You must be able to answer: Where am I? (current phase in `task_plan.md`) Where am I going? (remaining phases) What's the goal? (goal statement) What have I learned? (`findings.md`) What have I done? (`progress.md`)

## Templates

### task_plan.md

```markdown
# Task Plan: [Brief Description]

## Goal

[One sentence describing the end state]

## Current Phase

Phase 1

## Phases

### Phase 1: Requirements & Discovery

- [ ] Understand user intent
- [ ] Identify constraints and requirements
- [ ] Document findings in findings.md
- **Status:** in_progress

### Phase 2: Planning & Structure

- [ ] Define technical approach
- [ ] Create project structure if needed
- [ ] Document decisions with rationale
- **Status:** pending

### Phase 3: Implementation

- [ ] Execute the plan step by step
- [ ] Write code to files before executing
- [ ] Test incrementally
- **Status:** pending

### Phase 4: Testing & Verification

- [ ] Verify all requirements met
- [ ] Document test results in progress.md
- [ ] Fix any issues found
- **Status:** pending

### Phase 5: Delivery

- [ ] Review all output files
- [ ] Ensure deliverables are complete
- [ ] Deliver to user
- **Status:** pending

## Key Questions

1. [Question to answer]

## Decisions Made

| Decision | Rationale |
| -------- | --------- |

## Errors Encountered

| Error | Attempt | Resolution |
| ----- | ------- | ---------- |
```

### findings.md

```markdown
# Findings & Decisions

## Requirements

<!-- Captured from user request -->

## Research Findings

<!-- Key discoveries during exploration -->

## Technical Decisions

| Decision | Rationale |
| -------- | --------- |

## Issues Encountered

| Issue | Resolution |
| ----- | ---------- |

## Resources

<!-- URLs, file paths, API references -->

## Visual/Browser Findings

<!-- CRITICAL: Update after every 2 view/browser operations -->
```

### progress.md

```markdown
# Progress Log

## Session: [DATE]

### Phase 1: [Title]

- **Status:** in_progress
- **Started:** [timestamp]
- Actions taken:
- Files created/modified:

## Test Results

| Test | Input | Expected | Actual | Status |
| ---- | ----- | -------- | ------ | ------ |

## Error Log

| Timestamp | Error | Attempt | Resolution |
| --------- | ----- | ------- | ---------- |

## 5-Question Reboot Check

| Question             | Answer           |
| -------------------- | ---------------- |
| Where am I?          | Phase X          |
| Where am I going?    | Remaining phases |
| What's the goal?     | [goal statement] |
| What have I learned? | See findings.md  |
| What have I done?    | See above        |
```
