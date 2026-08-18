/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { PAVII_AVATAR_DATA_URI } from './paviiAvatarDataUri';

/**
 * Display-level branding overrides for names supplied by the aioncore backend.
 *
 * The backend catalog still ships the upstream identities ("AionUi Butler"
 * assistant with manifest id `aionui-assistant`, the built-in `aionrs` agent
 * named "Aion CLI"). Those ids are backend contracts and must not change, so
 * the rebrand is applied here — a single choke point on the HTTP adapter —
 * before any UI renders them.
 */

/** Backend manifest id of the built-in assistant (upstream contract — do not rename). */
export const BUTLER_ASSISTANT_ID = 'aionui-assistant';

/**
 * Id of the Pavii-owned replacement butler created at startup
 * (see process/startup/ensurePaviiButler.ts). The engine rejects rule writes
 * for builtin ids, so the Pavii identity lives on this user-owned twin and the
 * builtin butler is disabled.
 */
export const PAVII_BUTLER_ASSISTANT_ID = 'pavii-assistant';

/** Hidden assistant that gives bare "Pavii CLI" conversations their identity rule. */
export const PAVII_CLI_ASSISTANT_ID = 'pavii-cli';

/** Displayed name of the built-in assistant after the rebrand. */
export const BUTLER_DISPLAY_NAME = 'Your Pavii';

/** Displayed name of the built-in aionrs agent after the rebrand. */
export const BUILTIN_AGENT_DISPLAY_NAME = 'Pavii CLI';

/** Ordered upstream-brand replacements applied to backend-supplied display strings. */
const BRAND_SCRUB_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/AionUi Butler/g, BUTLER_DISPLAY_NAME],
  [/Aion ?CLI/g, BUILTIN_AGENT_DISPLAY_NAME],
  [/AionCore/g, 'Pavii Engine'],
  [/AionHub/g, 'Pavii Hub'],
  [/AionU[iI]/g, 'Pavii.Ai'],
];

/** Replace upstream brand names inside a backend-supplied display string. */
export const scrubBrandText = (text: string): string => {
  let out = text;
  for (const [pattern, replacement] of BRAND_SCRUB_RULES) out = out.replace(pattern, replacement);
  return out;
};

const scrubOptionalText = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : scrubBrandText(text);

const scrubTextMap = (map: Record<string, string> | undefined): Record<string, string> | undefined =>
  map ? Object.fromEntries(Object.entries(map).map(([key, value]) => [key, scrubBrandText(value)])) : map;

const constantTextMap = (map: Record<string, string> | undefined, value: string): Record<string, string> | undefined =>
  map ? Object.fromEntries(Object.keys(map).map((key) => [key, value])) : map;

/** True when the id belongs to the butler assistant — builtin or the Pavii twin (tolerates the `builtin-` prefix). */
export const isButlerAssistantId = (id: string | undefined): boolean => {
  if (!id) return false;
  const bare = id.replace(/^builtin-/, '');
  return bare === BUTLER_ASSISTANT_ID || bare === PAVII_BUTLER_ASSISTANT_ID;
};

type AssistantLike = {
  id: string;
  name: string;
  name_i18n?: Record<string, string>;
  description?: string;
  description_i18n?: Record<string, string>;
  avatar?: string;
};

/**
 * True when an avatar/icon URL points at an upstream Aion brand asset that
 * ships inside the engine (e.g. /api/assets/logos/brand/aion.svg). Matching on
 * the asset (not the engine type) matters: many assistants run on the aionrs
 * engine with their own avatars, and only the bare CLI row carries this logo.
 */
export const isUpstreamAionLogo = (url: string | undefined): boolean =>
  typeof url === 'string' && /logos\/brand\/aion[a-z_-]*\./i.test(url);

/**
 * Rebrand a backend-supplied assistant row: the butler gets the "Your Pavii"
 * identity and logo; every other row gets upstream brand names scrubbed from
 * its display strings (e.g. the built-in "Aion CLI" assistant).
 */
export const applyAssistantBranding = <T extends AssistantLike>(assistant: T): T => {
  if (isButlerAssistantId(assistant.id)) {
    return {
      ...assistant,
      name: BUTLER_DISPLAY_NAME,
      name_i18n: constantTextMap(assistant.name_i18n, BUTLER_DISPLAY_NAME),
      description: scrubOptionalText(assistant.description),
      description_i18n: scrubTextMap(assistant.description_i18n),
      avatar: PAVII_AVATAR_DATA_URI,
    };
  }
  const name = scrubBrandText(assistant.name);
  const name_i18n = scrubTextMap(assistant.name_i18n);
  const description = scrubOptionalText(assistant.description);
  const description_i18n = scrubTextMap(assistant.description_i18n);
  // The engine-CLI assistant keeps shipping the upstream Aion logo; replace it
  // everywhere it surfaces (home tabs, pickers, editors) with the Pavii mark.
  if (isUpstreamAionLogo(assistant.avatar)) {
    return { ...assistant, name, name_i18n, description, description_i18n, avatar: PAVII_AVATAR_DATA_URI };
  }
  if (
    name === assistant.name &&
    description === assistant.description &&
    JSON.stringify(name_i18n) === JSON.stringify(assistant.name_i18n) &&
    JSON.stringify(description_i18n) === JSON.stringify(assistant.description_i18n)
  ) {
    return assistant;
  }
  return { ...assistant, name, name_i18n, description, description_i18n };
};

/**
 * Builtin assistants removed from the product but possibly lingering as rows in
 * databases created before the removal (the engine only upserts definitions).
 */
const REMOVED_BUILTIN_ASSISTANT_IDS = new Set(['social-job-publisher']);

export const brandAssistants = <T extends AssistantLike>(assistants: T[]): T[] =>
  Array.isArray(assistants)
    ? assistants.filter((assistant) => !REMOVED_BUILTIN_ASSISTANT_IDS.has(assistant.id)).map(applyAssistantBranding)
    : assistants;

type AssistantDetailLike = {
  id: string;
  profile: {
    name: string;
    name_i18n: Record<string, string>;
    description?: string;
    description_i18n?: Record<string, string>;
    avatar?: string;
  };
};

/** Same override for the assistant-detail shape, where identity lives under `profile`. */
export const applyAssistantDetailBranding = <T extends AssistantDetailLike>(detail: T): T => {
  if (isButlerAssistantId(detail.id)) {
    return {
      ...detail,
      profile: {
        ...detail.profile,
        name: BUTLER_DISPLAY_NAME,
        name_i18n: constantTextMap(detail.profile.name_i18n, BUTLER_DISPLAY_NAME) ?? {},
        description: scrubOptionalText(detail.profile.description),
        description_i18n: scrubTextMap(detail.profile.description_i18n),
        avatar: PAVII_AVATAR_DATA_URI,
      },
    };
  }
  return {
    ...detail,
    profile: {
      ...detail.profile,
      name: scrubBrandText(detail.profile.name),
      name_i18n: scrubTextMap(detail.profile.name_i18n) ?? {},
      description: scrubOptionalText(detail.profile.description),
      description_i18n: scrubTextMap(detail.profile.description_i18n),
      ...(isUpstreamAionLogo(detail.profile.avatar) ? { avatar: PAVII_AVATAR_DATA_URI } : {}),
    },
  };
};

type AgentLike = {
  agent_type?: string;
  backend?: string;
  name: string;
  name_i18n?: Record<string, string>;
  description?: string;
  description_i18n?: Record<string, string>;
  icon?: string;
  avatar?: string;
};

/**
 * Rebrand a backend-supplied agent row: the built-in aionrs agent is renamed
 * to "Pavii CLI" and gets the Pavii logo; all rows get upstream brand names
 * scrubbed from display strings.
 */
export const applyAgentBranding = <T extends AgentLike>(agent: T): T => {
  // Some rows arrive keyed by `backend` instead of `agent_type` (e.g. ACP rows).
  if (agent.agent_type === 'aionrs' || agent.backend === 'aionrs') {
    return {
      ...agent,
      name: BUILTIN_AGENT_DISPLAY_NAME,
      name_i18n: constantTextMap(agent.name_i18n, BUILTIN_AGENT_DISPLAY_NAME),
      description: scrubOptionalText(agent.description),
      description_i18n: scrubTextMap(agent.description_i18n),
      icon: PAVII_AVATAR_DATA_URI,
      avatar: PAVII_AVATAR_DATA_URI,
    };
  }
  const name = scrubBrandText(agent.name);
  const description = scrubOptionalText(agent.description);
  if (name === agent.name && description === agent.description) return agent;
  return { ...agent, name, description };
};

export const brandAgents = <T extends AgentLike>(agents: T[]): T[] =>
  Array.isArray(agents) ? agents.map(applyAgentBranding) : agents;

type HubExtensionLike = {
  display_name: string;
  description: string;
  author?: string;
};

/** Scrub upstream brand names from an Agent Hub extension row. */
export const applyHubExtensionBranding = <T extends HubExtensionLike>(extension: T): T => {
  const display_name = scrubBrandText(extension.display_name);
  const description = scrubBrandText(extension.description);
  const author = scrubOptionalText(extension.author);
  if (display_name === extension.display_name && description === extension.description && author === extension.author) {
    return extension;
  }
  return { ...extension, display_name, description, author };
};

export const brandHubExtensions = <T extends HubExtensionLike>(extensions: T[]): T[] =>
  Array.isArray(extensions) ? extensions.map(applyHubExtensionBranding) : extensions;

/**
 * Defensive branding for loosely-typed rows (extension contributions):
 * scrubs the common display-string fields and swaps upstream Aion logos.
 */
export const brandGenericRows = <T extends Record<string, unknown>>(rows: T[]): T[] => {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const field of ['name', 'display_name', 'label', 'description']) {
      if (typeof next[field] === 'string') next[field] = scrubBrandText(next[field] as string);
    }
    for (const field of ['avatar', 'icon']) {
      if (isUpstreamAionLogo(next[field] as string | undefined)) next[field] = PAVII_AVATAR_DATA_URI;
    }
    return next as T;
  });
};
