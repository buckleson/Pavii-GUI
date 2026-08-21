/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { scrubBrandText } from './assistantBranding';
import { BUNDLED_SKILL_NAMES } from './bundledSkillNames';

/**
 * Display-level branding for skills supplied by the aioncore backend.
 *
 * Skill names are backend contracts: enable/disable, delete, materialize and
 * conversation overrides all key on the raw `name`, so the raw value must keep
 * flowing back unchanged. The rebrand therefore adds a `display_name` for the
 * UI to render and rewrites only the description copy (upstream brand names
 * scrubbed, Chinese-only builtin descriptions replaced with English).
 */

/** Upstream tool-brand replacements applied to skill display strings. */
const SKILL_TEXT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bofficecli-/g, 'pavii-cli-'],
  [/\bofficecli\b/g, 'pavii-cli'],
  [/\baionui-/g, 'pavii-'],
  [/OfficeCLI/g, 'Pavii CLI'],
  [/iOfficeAI/g, 'Pavii'],
  [/\baioncore\b/g, 'Pavii Engine'],
];

/**
 * English display descriptions for builtin skills whose backend copy ships in
 * Chinese. Keyed by the raw backend skill name.
 */
const SKILL_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  // x-recruiter / xiaohongshu-recruiter were removed from the engine's builtin
  // skills entirely; only weixin-file-send still ships with Chinese copy.
  'weixin-file-send': "Send a local file or image back to the user in chat, e.g. when they ask 'send me the file'.",
};

const applySkillTextRules = (text: string): string => {
  let out = text;
  for (const [pattern, replacement] of SKILL_TEXT_RULES) out = out.replace(pattern, replacement);
  return scrubBrandText(out);
};

/** Rebranded name shown in the UI; the raw backend name stays the operative key. */
export const skillDisplayName = (name: string): string => applySkillTextRules(name);

/** Rebranded description: per-skill English override first, then brand scrub. */
export const brandSkillDescription = (name: string, description: string | undefined): string | undefined => {
  const override = SKILL_DESCRIPTION_OVERRIDES[name];
  if (override !== undefined) return override;
  return description === undefined ? undefined : applySkillTextRules(description);
};

type SkillRowLike = {
  name: string;
  description?: string;
  source?: string;
};

export type BrandedSkillExtras = {
  display_name: string;
  /**
   * Display-level grouping override: the bundled Pavii pack is imported as
   * `source: 'custom'` but presented on the Official tab. The raw `source`
   * stays untouched (delete/import flows still key on it).
   */
  display_source?: 'official';
};

/** Add `display_name`/`display_source` and rebrand the description on a backend skill row. */
export const applySkillBranding = <T extends SkillRowLike>(skill: T): T & BrandedSkillExtras => ({
  ...skill,
  display_name: skillDisplayName(skill.name),
  description: brandSkillDescription(skill.name, skill.description),
  ...(skill.source === 'custom' && BUNDLED_SKILL_NAMES.has(skill.name) ? { display_source: 'official' as const } : {}),
});

/**
 * Builtin skill names that no longer exist under that name.
 *
 * The engine indexes builtin skills into its database and does not prune
 * entries whose folders disappear, so an install created before the change
 * keeps the stale row. Two things land here:
 *
 * - skills removed from the product outright (`x-recruiter`,
 *   `xiaohongshu-recruiter`);
 * - skills renamed for the Pavii rebrand, whose folders now ship as `pavii-*`.
 *   Without this the slash-command menu would list BOTH `/aionui-config` and
 *   `/pavii-config` on every pre-rename install -- the old row still indexed,
 *   the new row freshly added.
 *
 * `SKILL_TEXT_RULES` deliberately still maps the old names: a stale row can
 * reach the UI through paths that do not go through `brandSkills`, and rendering
 * it branded is better than rendering it raw.
 */
const RETIRED_BUILTIN_SKILL_NAMES: ReadonlySet<string> = new Set([
  'x-recruiter',
  'xiaohongshu-recruiter',
  // Renamed in the Pavii rebrand; the folders now ship as `pavii-*`.
  'aionui-config',
  'aionui-troubleshooting',
  'aionui-webui-public',
  'aionui-webui-setup',
  'officecli',
  'officecli-academic-paper',
  'officecli-data-dashboard',
  'officecli-docx',
  'officecli-financial-model',
  'officecli-pitch-deck',
  'officecli-pptx',
  'officecli-word-form',
  'officecli-xlsx',
]);

export const brandSkills = <T extends SkillRowLike>(skills: T[]): Array<T & BrandedSkillExtras> =>
  Array.isArray(skills)
    ? skills.filter((skill) => !RETIRED_BUILTIN_SKILL_NAMES.has(skill.name)).map(applySkillBranding)
    : skills;
