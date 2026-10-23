/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Topic categories for the Skills page.
 *
 * The skill catalog ships ~117 categorisable entries (19 built-in folders plus
 * the 98-skill bundled pack), which renders as an unreadable flat list. Each
 * shipped skill is assigned a category here by its **raw backend name** — the
 * same key `display_name` is derived from — and anything unrecognised (a user
 * import, or a skill added after this file) falls back to `other`.
 *
 * A unit test asserts every shipped skill has an entry, so a new built-in or
 * bundled skill cannot silently land in `other`.
 */

export const SKILL_CATEGORY_IDS = [
  'documents',
  'development',
  'design',
  'writing',
  'research',
  'workflow',
  'setup',
  'integrations',
  'other',
] as const;

export type SkillCategoryId = (typeof SKILL_CATEGORY_IDS)[number];

/** i18n key and English fallback for each category heading. */
export const SKILL_CATEGORY_LABELS: Readonly<Record<SkillCategoryId, { key: string; defaultValue: string }>> = {
  documents: { key: 'settings.skillsHub.categoryDocuments', defaultValue: 'Documents & Slides' },
  development: { key: 'settings.skillsHub.categoryDevelopment', defaultValue: 'Development' },
  design: { key: 'settings.skillsHub.categoryDesign', defaultValue: 'Design & UI' },
  writing: { key: 'settings.skillsHub.categoryWriting', defaultValue: 'Writing & Specs' },
  research: { key: 'settings.skillsHub.categoryResearch', defaultValue: 'Research & Learning' },
  workflow: { key: 'settings.skillsHub.categoryWorkflow', defaultValue: 'Workflow & Context' },
  setup: { key: 'settings.skillsHub.categorySetup', defaultValue: 'Setup & Troubleshooting' },
  integrations: { key: 'settings.skillsHub.categoryIntegrations', defaultValue: 'Integrations' },
  other: { key: 'settings.skillsHub.categoryOther', defaultValue: 'Other' },
};

/**
 * Raw backend skill name to category. Auto-injected built-ins are deliberately
 * absent: they render as their own flat section, so categorising them would be
 * dead data.
 */
const SKILL_CATEGORY_BY_NAME: Readonly<Record<string, SkillCategoryId>> = {
  // Documents & Slides
  mermaid: 'documents',
  'morph-ppt': 'documents',
  'morph-ppt-3d': 'documents',
  'pavii-cli-academic-paper': 'documents',
  'pavii-cli-data-dashboard': 'documents',
  'pavii-cli-docx': 'documents',
  'pavii-cli-financial-model': 'documents',
  'pavii-cli-pitch-deck': 'documents',
  'pavii-cli-pptx': 'documents',
  'pavii-cli-word-form': 'documents',
  'pavii-cli-xlsx': 'documents',
  pdf: 'documents',

  // Development
  'code-review': 'development',
  'codebase-design': 'development',
  'diagnosing-bugs': 'development',
  'domain-modeling': 'development',
  'git-guardrails-claude-code': 'development',
  implement: 'development',
  'improve-codebase-architecture': 'development',
  'migrate-to-shoehorn': 'development',
  prototype: 'development',
  'resolving-merge-conflicts': 'development',
  'scaffold-exercises': 'development',
  'setup-pre-commit': 'development',
  'setup-ts-deep-modules': 'development',
  tdd: 'development',
  triage: 'development',

  // Writing & Specs
  'story-roleplay': 'writing',
  'to-questionnaire': 'writing',
  'to-spec': 'writing',
  'to-tickets': 'writing',
  'writing-beats': 'writing',
  'writing-for-agents': 'writing',
  'writing-fragments': 'writing',
  'writing-shape': 'writing',

  // Research & Learning
  'ask-matt': 'research',
  'grill-me': 'research',
  'grill-with-docs': 'research',
  grilling: 'research',
  research: 'research',
  teach: 'research',
  'wait-what': 'research',
  wayfinder: 'research',

  // Workflow & Context
  'claude-handoff': 'workflow',
  handoff: 'workflow',
  'loop-me': 'workflow',
  'token-optimizer': 'workflow',
  'ste100-replies': 'workflow',
  wizard: 'workflow',

  // Setup & Troubleshooting
  'openclaw-setup': 'setup',
  'pavii-troubleshooting': 'setup',
  'pavii-webui-public': 'setup',
  'pavii-webui-setup': 'setup',
  'setup-matt-pocock-skills': 'setup',

  // Integrations
  moltbook: 'integrations',
  'weixin-file-send': 'integrations',

  // ---- ECC pack (MIT, resources/bundled-skills/ecc) ----

  // Development
  'api-design': 'development',
  'architecture-decision-records': 'development',
  'backend-patterns': 'development',
  'browser-qa': 'development',
  'bun-runtime': 'development',
  'code-tour': 'development',
  'codebase-onboarding': 'development',
  'coding-standards': 'development',
  'contract-first': 'development',
  'database-migrations': 'development',
  'deployment-patterns': 'development',
  'e2e-testing': 'development',
  'error-handling': 'development',
  'frontend-patterns': 'development',
  'git-workflow': 'development',
  'github-ops': 'development',
  'golang-patterns': 'development',
  'hexagonal-architecture': 'development',
  'kubernetes-patterns': 'development',
  'nextjs-turbopack': 'development',
  'postgres-patterns': 'development',
  'python-patterns': 'development',
  'python-testing': 'development',
  'react-patterns': 'development',
  'react-performance': 'development',
  'react-testing': 'development',
  'redis-patterns': 'development',
  'repo-scan': 'development',
  'rust-patterns': 'development',
  'rust-testing': 'development',
  'security-review': 'development',
  'verification-loop': 'development',
  'vue-patterns': 'development',

  // Design & UI
  accessibility: 'design',
  'design-system': 'design',
  'frontend-a11y': 'design',
  'motion-foundations': 'design',
  taste: 'design',
  'ui-demo': 'design',

  // Writing & Specs
  'article-writing': 'writing',
  'brand-voice': 'writing',
  'content-engine': 'writing',
  crosspost: 'writing',
  'documentation-lookup': 'writing',
  seo: 'writing',

  // Research & Learning
  'competitive-platform-analysis': 'research',
  'deep-research': 'research',
  'literature-review': 'research',
  'market-research': 'research',
  'research-ops': 'research',
  'search-first': 'research',

  // Workflow & Context
  'context-budget': 'workflow',
  'continuous-learning': 'workflow',
  'knowledge-ops': 'workflow',
  'parallel-execution-optimizer': 'workflow',
  'plan-orchestrate': 'workflow',
  'prompt-optimizer': 'workflow',
  'token-budget-advisor': 'workflow',

  // Integrations
  'api-connector-builder': 'integrations',
  'google-workspace-ops': 'integrations',
  'jira-integration': 'integrations',
  'mcp-server-patterns': 'integrations',
};

/** Category for a skill, by its raw backend name. Unknown names land in `other`. */
export const skillCategory = (name: string): SkillCategoryId => SKILL_CATEGORY_BY_NAME[name] ?? 'other';

export interface SkillCategoryGroup<T> {
  id: SkillCategoryId;
  skills: T[];
}

/**
 * Group skills into categories, in `SKILL_CATEGORY_IDS` order and dropping
 * empty ones. Order within a category is the caller's order, unchanged.
 */
export const groupSkillsByCategory = <T extends { name: string }>(skills: T[]): Array<SkillCategoryGroup<T>> => {
  const buckets = new Map<SkillCategoryId, T[]>();
  for (const skill of skills) {
    const id = skillCategory(skill.name);
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.push(skill);
    } else {
      buckets.set(id, [skill]);
    }
  }
  return SKILL_CATEGORY_IDS.filter((id) => buckets.has(id)).map((id) => ({ id, skills: buckets.get(id) ?? [] }));
};
