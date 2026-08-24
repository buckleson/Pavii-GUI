/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every composer must offer the same app-level slash commands.
 *
 * This exists because of a real bug the user hit: `/new` and `/agents` were
 * registered in the conversation composer only. On the new-conversation screen
 * `/agents` therefore matched nothing, the menu never opened, Enter sent the
 * raw text to OpenCode, and the agent replied with nothing — the user saw
 * "This request produced no visible reply" and reasonably read it as the
 * feature being broken.
 *
 * The cause was two hand-maintained builtin lists drifting apart. A shared
 * builder fixes today's drift; this test is what stops the next one, by
 * failing the moment a command is added to the shared set and not surfaced by
 * one of the composers.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_SLASH_COMMAND_NAMES, buildAppSlashCommands } from '@/common/chat/slash/appSlashCommands';
import { buildGuidSlashCommands } from '@/common/chat/slash/guidSlashCommands';
import { mergeSlashCommands, orderSlashCommandsForDisplay } from '@/common/chat/slash/mergeSlashCommands';
import type { SlashCommandItem } from '@/common/chat/slash/types';

const repoRoot = join(__dirname, '..', '..', '..');
const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key;

const acp = (name: string): SlashCommandItem => ({
  name,
  description: `acp ${name}`,
  kind: 'template',
  source: 'acp',
});

describe('app-level slash commands', () => {
  it('builds every name declared in the shared set', () => {
    const built = buildAppSlashCommands(t).map((command) => command.name);
    expect(built).toEqual([...APP_SLASH_COMMAND_NAMES]);
  });

  it('marks them executable rather than insertable', () => {
    // `kind: 'template'` would insert "/agents " as text instead of running it,
    // which is exactly how the raw command reached the agent and produced an
    // empty reply.
    for (const command of buildAppSlashCommands(t)) {
      expect(command.kind, command.name).toBe('builtin');
      expect(command.selectionBehavior ?? 'execute', command.name).not.toBe('insert');
    }
  });

  it('gives each one a description that is not just its own name', () => {
    // A menu row with no meaningful description reads as a dead entry.
    for (const command of buildAppSlashCommands(t)) {
      expect(command.description.length, command.name).toBeGreaterThan(command.name.length);
    }
  });
});

describe('composer parity', () => {
  /**
   * Source-level assertion on purpose: the two composers are large React
   * components whose builtin lists are assembled inside `useMemo`s wired to
   * hooks. Rendering both just to read a list would test the harness more than
   * the wiring. What must hold is narrow and checkable — each composer feeds
   * the shared builder into the list it hands the slash menu.
   */
  const readsSharedBuilder = (relativePath: string) => {
    const source = readFileSync(join(repoRoot, relativePath), 'utf-8');
    return {
      imports: source.includes("from '@/common/chat/slash/appSlashCommands'"),
      spreads: source.includes('buildAppSlashCommands(t)'),
    };
  };

  it.each([
    ['conversation composer', 'packages/desktop/src/renderer/components/chat/SendBox/index.tsx'],
    ['new-conversation composer', 'packages/desktop/src/renderer/pages/guid/GuidPage.tsx'],
  ])('%s registers the shared app commands', (_label, relativePath) => {
    const { imports, spreads } = readsSharedBuilder(relativePath);
    expect(imports, `${relativePath} must import the shared builder`).toBe(true);
    expect(spreads, `${relativePath} must include the shared commands in its builtin list`).toBe(true);
  });

  it('keeps the app commands in the new-conversation menu even when the agent advertises its own', () => {
    // The guid composer used to drop whole groups when agent commands existed.
    // The app commands must never be the casualty of that kind of filtering.
    const commands = buildGuidSlashCommands({
      builtinCommands: buildAppSlashCommands(t),
      agentCommands: [acp('review'), acp('init')],
      selectedSkills: ['token-optimizer'],
      descriptionByName: new Map([['token-optimizer', 'Trim tokens']]),
      skillFallbackDescription: 'Skill',
    });

    const names = commands.map((command) => command.name);
    for (const appCommand of APP_SLASH_COMMAND_NAMES) {
      expect(names, `${appCommand} must survive the guid merge`).toContain(appCommand);
    }
  });

  it('keeps the app version on a name collision, without dropping the rest', () => {
    // If an agent ever advertises its own `/new`, the app's builtin wins the
    // name (mergeSlashCommands puts builtin first) so selecting it still runs
    // a real action rather than sending text to the agent. `/agents` must
    // survive regardless: collisions are resolved per-name, never per-group.
    const merged = orderSlashCommandsForDisplay(mergeSlashCommands(buildAppSlashCommands(t), [acp('new')], []));

    const byName = new Map(merged.map((command) => [command.name, command]));
    expect(byName.get('new')?.source).toBe('builtin');
    expect(byName.get('agents')?.source).toBe('builtin');
    expect(merged).toHaveLength(2);
  });
});
