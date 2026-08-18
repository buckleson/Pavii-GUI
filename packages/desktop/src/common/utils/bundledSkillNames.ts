/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Frontmatter names of the Pavii-curated skill pack shipped under
 * `resources/bundled-skills/` and auto-imported at startup
 * (process/startup/ensureBundledSkills.ts). The backend stores them as
 * `source: 'custom'` imports, but the Skills tab presents them as Official
 * pack content — `applySkillBranding` tags rows in this set with
 * `display_source: 'official'`.
 *
 * Source of truth is the folder listing; a unit test asserts this constant
 * matches the SKILL.md frontmatter names on disk so the list cannot drift.
 */
export const BUNDLED_SKILL_NAMES: ReadonlySet<string> = new Set([
  'ask-matt',
  'claude-handoff',
  'code-review',
  'codebase-design',
  'diagnosing-bugs',
  'domain-modeling',
  'git-guardrails-claude-code',
  'grill-me',
  'grill-with-docs',
  'grilling',
  'handoff',
  'implement',
  'improve-codebase-architecture',
  'loop-me',
  'migrate-to-shoehorn',
  'prototype',
  'research',
  'resolving-merge-conflicts',
  'scaffold-exercises',
  'setup-matt-pocock-skills',
  'setup-pre-commit',
  'setup-ts-deep-modules',
  'tdd',
  'teach',
  'to-questionnaire',
  'to-spec',
  'to-tickets',
  'token-optimizer',
  'triage',
  'wait-what',
  'wayfinder',
  'wizard',
  'writing-beats',
  'writing-for-agents',
  'writing-fragments',
  'writing-shape',
]);
