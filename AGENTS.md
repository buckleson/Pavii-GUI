# Pavii.Ai - Project Guide

All contributors (human and AI) must follow [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. ([Chinese version](CONTRIBUTING.zh.md))

## Code Conventions

### File & Directory Structure

- **Directory size limit**: Prefer ≤ **10** direct children per directory; new or substantially reorganized directories must satisfy this.

See [docs/contributing/file-structure.md](docs/contributing/file-structure.md) for complete rules. Agents must also follow the `architecture` skill (`.claude/skills/architecture/SKILL.md`) when creating files or modules.

### Naming

- **Components**: PascalCase (`Button.tsx`, `Modal.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Hooks**: camelCase with `use` prefix (`useTheme.ts`)
- **Constants files**: camelCase (`constants.ts`) — values inside use UPPER_SNAKE_CASE
- **Type files**: camelCase (`types.ts`)
- **Style files**: kebab-case or `ComponentName.module.css`
- **Unused params**: prefix with `_`

### UI Library & Icons

- **Components**: `@arco-design/web-react` — no raw interactive HTML (`<button>`, `<input>`, `<select>`, etc.)
- **Icons**: `@icon-park/react`

### CSS

- Prefer **UnoCSS utility classes**; complex styles use **CSS Modules** (`ComponentName.module.css`)
- Colors must use **semantic tokens** from `uno.config.ts` or CSS variables — no hardcoded values
- Arco theme overrides go in `packages/desktop/src/renderer/styles/arco-override.css`; component-scoped Arco overrides use CSS Module with `:global()`
- Global styles only in `packages/desktop/src/renderer/styles/`

Formatting rules (Oxfmt, Prettier-compatible):

- Single-element arrays that fit on one line → inline: `[{ id: 'a', value: 'b' }]`
- Trailing commas required in multi-line arrays/objects
- Single quotes for strings

### TypeScript

- Strict mode enabled — no `any`, no implicit returns
- Use path aliases: `@/*`, `@process/*`, `@renderer/*`
- Prefer `type` over `interface` (per Oxlint config)
- English for code comments; JSDoc for public functions

### Internationalization (i18n)

New or changed user-facing text must use i18n keys; do not introduce hardcoded strings. Languages and modules are defined in `packages/desktop/src/common/config/i18n-config.json`.

See the `i18n` skill (`.claude/skills/i18n/SKILL.md`) for complete workflow, key naming, and validation steps.

## Architecture

Two process types — never mix their APIs:

| Process  | Path                             | Restriction     |
| -------- | -------------------------------- | --------------- |
| Main     | `packages/desktop/src/process/`  | No DOM APIs     |
| Renderer | `packages/desktop/src/renderer/` | No Node.js APIs |

Cross-process communication must go through the IPC bridge (`packages/desktop/src/preload/`).
See [docs/architecture/overview.md](docs/architecture/overview.md) for details.

## Testing

**Framework**: Vitest 4 (`vitest.config.ts`). Project coverage target is ≥ 80%; ordinary changes should add focused tests for changed behavior.

```bash
bun run test              # run all tests
bun run test:coverage     # with coverage report
```

See the `testing` skill (`.claude/skills/testing/SKILL.md`) for complete workflow and quality rules.

## Workflow

### Scope & Enforcement

- **Hard blockers**: process boundary violations, TypeScript errors, failing tests, unsafe IPC usage, missing i18n for new or changed user-facing text, and raw interactive HTML in new UI.
- **Current-change requirements**: naming, CSS, file placement, tests, docs, directory size, and single-file-directory rules apply to files created or meaningfully modified by the current change.
- **Ratchet rules**: existing directory size or single-file-directory violations do not require cleanup during ordinary feature work or bugfixes, but the current change must not make them worse.
- **No scope expansion**: implementation plans and reviews must not create extra tasks, phases, or acceptance criteria for cleanup unless the user asks for that scope.
- **Ignored working docs**: `docs/superpowers/` is intentionally gitignored for local Superpowers specs and plans. Do not force-add or otherwise commit files from this directory.

### During Development

Auto-fix as you edit:

```bash
bun run lint:fix       # auto-fix lint issues (oxlint)
bun run format         # auto-format all files (oxfmt)
bunx tsc --noEmit      # verify no type errors
```

If your changes touch `packages/desktop/src/renderer/`, `locales/`, or `packages/desktop/src/common/config/i18n`, also run:

```bash
bun run i18n:types
node scripts/check-i18n.js
```

### Before Pushing

AI agents must not push unless explicitly asked. When pushing, use `just push`, never `git push`:

```bash
just push                          # lint → format-check → typecheck → test → git push
just push -u origin feat/branch    # same checks, with extra git push args
```

Any step that fails aborts the push. Fix the issue, commit, then retry.

> **Note for AI agents**: `just push` uses `--quiet` for lint — only errors cause failure. The project has many pre-existing lint _warnings_ which do NOT indicate failure. Judge success by exit code, not by output volume.

### Before PR (optional stricter check)

`prek` replicates the **exact CI pipeline** (includes end-of-file, trailing whitespace checks on all file types):

```bash
# One-time setup
npm install -g @j178/prek

# Run
prek run --from-ref origin/main --to-ref HEAD
```

> `prek` is read-only — it reports but does not fix. If it reports issues, run the auto-fix commands above, commit, then re-run.

### Commit & PR Format

Commits and PR titles must follow the Conventional Commit format defined in [CONTRIBUTING.md](CONTRIBUTING.md):

```text
<type>(<scope>): <subject>
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`, `ci`, `build`.

When opening a PR, fill in the PR body using [.github/pull_request_template.md](.github/pull_request_template.md) and complete its checklists honestly (only check items you actually ran or verified).

**NEVER add AI signatures** (Co-Authored-By, Generated with, etc.).

## Skills Index

| Skill                     | Purpose                                                                     | Triggers                                                                                               |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **architecture**          | File & directory structure conventions for all process types                | Creating files, adding modules, architectural decisions                                                |
| **i18n**                  | Internationalization workflow and standards                                 | Adding or changing user-facing text, modifying `locales/` or `packages/desktop/src/common/config/i18n` |
| **testing**               | Testing workflow and quality standards                                      | Writing tests, changing runtime behavior, fixing bugs, or claiming behavior is verified                |
| **bump-version**          | Version bump workflow: update package.json, checks, branch, PR, tag release | Bumping version, `/bump-version`                                                                       |
| **architecture-recorder** | Maintain concise architectural decisions, context, and codebase navigation  | After material design, implementation, workflow, or repository-structure changes                       |
| **handoff**               | Prepare a compact continuation document for another agent or session        | Before transferring work or ending a session that will be continued                                    |

> Skills are located in `.claude/skills/` and contain project conventions that apply to **all** agents and contributors.

## Deterministic Agent Workflow

These rules apply to every task in this repository.

### Scope and Storage

- Apply YAGNI: implement only behavior required by the current request and its acceptance criteria. Do not add speculative abstractions, cleanup, compatibility layers, or future-facing options.
- Write files, downloads, caches, temporary data, dependency data, build output, and generated artifacts only inside `D:\pavii-a\special-enigma`.
- Do not write to any other drive or directory outside the repository. If a tool cannot be redirected to the repository, do not use it; choose a repository-local alternative or report the blocker.
- Read-only access outside the repository is allowed only when required to use installed system tooling. It must not create or modify files there.

### Task Decomposition and Test Gates

1. Split each request into the smallest independently verifiable tasks that preserve useful behavior without creating procedural busywork. Keep one explicit current task and complete tasks in dependency order.
2. Before implementing a task, define its observable completion condition and the narrowest relevant validation.
3. For every runtime behavior change or bug fix, assign a dedicated **test-author** subagent to write or update focused tests, including applicable boundary, empty, nullish, failure, async, and regression cases from `.claude/skills/testing/SKILL.md`.
4. After implementation and test authoring are complete, assign a separate **test-runner** subagent to run the narrowest relevant tests first, followed by the required broader checks for the touched area. The test-runner must not edit files and must report exact commands, exit codes, and failing test names. Run `bun run test` before completing or committing a runtime change.
5. If any check fails, assign a separate **failure-analyst** subagent to identify the root cause, distinguish current-change regressions from unrelated pre-existing failures, and produce a minimal repair plan. The failure-analyst must not edit files. Do not begin a later implementation task until the current task's relevant checks pass.
6. Apply the repair plan, then have the test-runner rerun the failed checks and any affected regression tests. Repeat until they pass or a genuine external blocker is documented.
7. Documentation-only, configuration-only, and instruction-only tasks do not require application runtime tests when behavior cannot change. They still require a separate validation pass for syntax, structure, links/paths, and internal consistency.

The environment supports four concurrent agents including the primary agent. Run roles in deterministic waves instead of weakening role separation:

- **Wave A:** primary implementation and test-author may work in parallel only when their file ownership does not overlap.
- **Wave B:** test-runner works only after the implementation and tests for the current task are ready.
- **Wave C (failures only):** failure-analyst examines failures; implementation and rerun follow its repair plan.
- **Wave D:** architecture-recorder updates durable context only after behavior and validation stabilize.
- **Session boundary:** handoff runs after current validation results and the architecture record are up to date.

### Context Management

- Use `.claude/skills/architecture-recorder/SKILL.md` after material design or implementation decisions. Maintain `docs/agent-context/architecture-record.md` as a concise map of decisions, constraints, changed areas, and where supporting details live.
- Use `.claude/skills/handoff/SKILL.md` when preparing another session or agent to continue. Maintain `docs/agent-context/handoff.md`, tailored to the next session's stated focus.
- Context documents must reference existing specs, plans, ADRs, issues, commits, and diffs by repository path or URL instead of duplicating their content.
- Never claim a task or area is complete until its required validation gate has passed and the result is recorded for the next agent.
