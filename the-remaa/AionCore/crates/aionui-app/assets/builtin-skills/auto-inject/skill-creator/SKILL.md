---
name: skill-creator
description: Guide for creating or updating skills (SKILL.md with scripts, references, assets) that add specialized knowledge, workflows, or tool integrations. Use when the user wants to create, edit, or package a skill.
license: Complete terms in LICENSE.txt
---

> **Platform note.** Commands are written for macOS / Linux. On **Windows**: use `python` (or `py`) instead of `python3`, `$env:USERPROFILE\…` and backslashes instead of `~/…`, and translate pipes/redirects (`|`, `>`, `&&`) to PowerShell. The scripts are cross-platform.

# Skill Creator

A skill is a self-contained package of specialized workflows, tool integrations, domain expertise, and bundled resources that turns a general agent into a specialized one.

## Core principles

- **Concise is key.** The context window is shared with the system prompt, history, other skills' metadata, and the request. Assume the agent is already smart: add only what it does not know. Prefer concise examples over verbose explanation.
- **Degrees of freedom** — match specificity to fragility: high freedom (text instructions) when many approaches are valid; medium (pseudocode or parameterized scripts) when a preferred pattern exists; low (specific scripts, few parameters) when operations are fragile, consistency is critical, or a fixed sequence is required.
- **Progressive disclosure**: metadata always loaded; body loaded on trigger; resources as needed. Keep the body under 500 lines. Patterns and examples: `references/progressive-disclosure.md`.

## Anatomy

```
skill-name/
├── SKILL.md (required: YAML frontmatter with name + description, then Markdown instructions)
└── optional: scripts/ (executable code), references/ (docs loaded into context as needed), assets/ (files used in output: templates, icons, fonts)
```

- **Frontmatter** `name` and `description` are the only fields the agent reads to decide when to use the skill. The **body** loads only after the skill triggers.
- `scripts/`: for code rewritten repeatedly or needing deterministic reliability.
- `references/`: for documentation the agent consults while working. Keep detail here, not duplicated in SKILL.md.
- `assets/`: for files used in the final output, not loaded into context.
- Do NOT add extraneous files (README.md, INSTALLATION_GUIDE.md, QUICK_REFERENCE.md, CHANGELOG.md, etc.) or context about how the skill was created, setup/testing procedures, or user-facing docs.

## Creation process

Follow in order; skip a step only with a clear reason.

1. **Understand with concrete examples.** Skip only if usage is already clear (still useful for existing skills). Ask what the skill should support, for usage examples, and what a user would say to trigger it. Do not ask too many questions in one message; start with the most important. Finish when the functionality is clear.
2. **Plan reusable contents.** For each example, consider how to execute it from scratch and which scripts, references, and assets would help when repeating it. List them.
3. **Initialize.** For a new skill, always run `scripts/init_skill.py <skill-name> --path <output-directory>`. It creates the directory, a SKILL.md template with frontmatter and TODO placeholders, and example `scripts/`, `references/`, `assets/` files. Skip only if the skill already exists.
4. **Edit.** Write for another agent instance: include non-obvious procedural knowledge, domain details, and reusable assets.
   - For multi-step processes see `references/workflows.md`; for output formats or quality standards see `references/output-patterns.md`.
   - Start with the planned resources (may need user input, e.g. brand assets). Test added scripts by actually running them (a representative sample if many are similar). Delete unneeded example files.
   - Use imperative/infinitive form.
   - Frontmatter: only `name` and `description`. The description is the primary trigger: state what the skill does and the specific triggers/contexts. Put all "when to use" information there, not in the body.
   - Body: instructions for using the skill and its bundled resources.
5. **Package.** Run `scripts/package_skill.py <path/to/skill-folder> [output-dir]` (e.g. `./dist`). It validates first (frontmatter format and required fields, naming and directory structure, description completeness, file organization and resource references), then writes `<skill-name>.skill` (a zip with all files and structure). On validation failure it reports errors and creates nothing: fix and rerun.
6. **Iterate.** Use the skill on real tasks, notice struggles or inefficiencies, update SKILL.md or resources, and test again.
