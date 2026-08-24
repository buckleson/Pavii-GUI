/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildGuidSlashCommands } from '@/common/chat/slash/guidSlashCommands';
import {
  buildSkillSlashCommands,
  mergeSlashCommands,
  orderSlashCommandsForDisplay,
} from '@/common/chat/slash/mergeSlashCommands';
import type { SlashCommandItem } from '@/common/chat/slash/types';

const builtin = (name: string): SlashCommandItem => ({
  name,
  description: `builtin ${name}`,
  kind: 'builtin',
  source: 'builtin',
});
const acp = (name: string): SlashCommandItem => ({ name, description: `acp ${name}`, kind: 'template', source: 'acp' });
const skill = (name: string): SlashCommandItem => ({
  name,
  description: `skill ${name}`,
  kind: 'template',
  source: 'skill',
  selectionBehavior: 'insert',
});

describe('buildSkillSlashCommands', () => {
  it('returns nothing when no skills are loaded', () => {
    expect(buildSkillSlashCommands(undefined, new Map(), 'Skill')).toEqual([]);
    expect(buildSkillSlashCommands([], new Map(), 'Skill')).toEqual([]);
  });

  it('maps each loaded skill to an insert-style template command', () => {
    const commands = buildSkillSlashCommands(['cron', 'pavii-cli'], new Map([['cron', 'Scheduled tasks']]), 'Skill');

    expect(commands).toEqual([
      { name: 'cron', description: 'Scheduled tasks', kind: 'template', source: 'skill', selectionBehavior: 'insert' },
      // No indexed description → falls back to the provided label.
      { name: 'pavii-cli', description: 'Skill', kind: 'template', source: 'skill', selectionBehavior: 'insert' },
    ]);
  });
});

describe('mergeSlashCommands', () => {
  it('keeps priority builtin > acp > skills on name collisions', () => {
    const skills = buildSkillSlashCommands(['copy', 'cron'], new Map(), 'Skill');
    const merged = mergeSlashCommands([builtin('copy')], [acp('copy'), acp('review')], skills);

    // `copy` exists in all three groups; builtin wins.
    expect(merged.find((c) => c.name === 'copy')?.source).toBe('builtin');
    // ACP-only command survives.
    expect(merged.find((c) => c.name === 'review')?.source).toBe('acp');
    // Skill-only command is appended.
    expect(merged.find((c) => c.name === 'cron')?.source).toBe('skill');
    // No duplicates.
    expect(merged.map((c) => c.name)).toEqual(['copy', 'review', 'cron']);
  });

  it('surfaces session skills when there are no other commands', () => {
    const skills = buildSkillSlashCommands(['cron'], new Map([['cron', 'Scheduled tasks']]), 'Skill');
    const merged = mergeSlashCommands([], [], skills);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: 'cron', source: 'skill', selectionBehavior: 'insert' });
  });
});

describe('orderSlashCommandsForDisplay', () => {
  it('puts the agent commands first, then builtins, then skills', () => {
    const ordered = orderSlashCommandsForDisplay([builtin('open'), skill('cron'), acp('review')]);

    // The agent's own commands are what users reach for; burying them under
    // builtins and skills is what made the menu feel wrong.
    expect(ordered.map((command) => `${command.source}:${command.name}`)).toEqual([
      'acp:review',
      'builtin:open',
      'skill:cron',
    ]);
  });

  it('keeps the incoming order within each source group', () => {
    // The agent advertises its commands in a deliberate order. An unstable sort
    // would shuffle the menu between renders for no reason.
    const ordered = orderSlashCommandsForDisplay([
      acp('review'),
      builtin('open'),
      acp('cron'),
      skill('tdd'),
      builtin('copy'),
      skill('pavii-cli'),
    ]);

    expect(ordered.map((command) => command.name)).toEqual(['review', 'cron', 'open', 'copy', 'tdd', 'pavii-cli']);
  });

  it('returns an empty list unchanged and does not mutate its input', () => {
    // Called on every keystroke that opens the menu; mutating the merged array
    // in place would corrupt the caller's snapshot.
    const commands = [skill('cron'), acp('review')];
    const ordered = orderSlashCommandsForDisplay(commands);

    expect(orderSlashCommandsForDisplay([])).toEqual([]);
    expect(commands.map((command) => command.name)).toEqual(['cron', 'review']);
    expect(ordered).not.toBe(commands);
  });

  it('orders display by source while merge still resolves collisions builtin-first', () => {
    // The two rules point in opposite directions on purpose. If ordering ever
    // leaked into merging, a skill named `copy` would shadow the builtin `/copy`
    // and the wrong command would run.
    const merged = mergeSlashCommands([builtin('copy')], [acp('review')], [skill('copy'), skill('cron')]);
    const ordered = orderSlashCommandsForDisplay(merged);

    expect(ordered.map((command) => `${command.source}:${command.name}`)).toEqual([
      'acp:review',
      'builtin:copy',
      'skill:cron',
    ]);
  });
});

describe('buildGuidSlashCommands', () => {
  it('lists agent commands first and still keeps the non-colliding skills', () => {
    const commands = buildGuidSlashCommands({
      builtinCommands: [builtin('open')],
      agentCommands: [acp('review'), acp('cron')],
      selectedSkills: ['cron', 'pavii-cli'],
      descriptionByName: new Map([
        ['cron', 'Scheduled tasks'],
        ['pavii-cli', 'Office automation'],
      ]),
      skillFallbackDescription: 'Skill',
    });

    // Skills used to be dropped entirely whenever the agent advertised any
    // command, so on every real agent the skills half of the menu was empty.
    // `cron` collides with an agent command and loses; `pavii-cli` must survive.
    expect(commands.map((command) => `${command.source}:${command.name}`)).toEqual([
      'acp:review',
      'acp:cron',
      'builtin:open',
      'skill:pavii-cli',
    ]);
  });

  it('falls back to selected skills when agent metadata has no commands', () => {
    const commands = buildGuidSlashCommands({
      builtinCommands: [builtin('open')],
      agentCommands: [],
      selectedSkills: ['cron'],
      descriptionByName: new Map([['cron', 'Scheduled tasks']]),
      skillFallbackDescription: 'Skill',
    });

    expect(commands.map((command) => `${command.source}:${command.name}`)).toEqual(['builtin:open', 'skill:cron']);
  });
});
