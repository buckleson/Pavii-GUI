/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { assistantGetMock, listAvailableSkillsMock } = vi.hoisted(() => ({
  assistantGetMock: vi.fn(),
  listAvailableSkillsMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { get: { invoke: assistantGetMock } },
    fs: { listAvailableSkills: { invoke: listAvailableSkillsMock } },
  },
}));

import { resolveAssistantSkillNames, useAssistantSlashSkills } from '@/renderer/hooks/chat/useAssistantSlashSkills';

type Capabilities = {
  default_skill_ids: string[];
  custom_skill_names: string[];
  default_disabled_builtin_skill_ids: string[];
};

const capabilities = (overrides: Partial<Capabilities> = {}) => ({
  capabilities: {
    default_skill_ids: [],
    custom_skill_names: [],
    default_disabled_builtin_skill_ids: [],
    ...overrides,
  },
});

const skillEntry = (name: string, overrides: Partial<{ description: string; is_auto_inject: boolean }> = {}) => ({
  name,
  description: name + ' description',
  location: '/skills/' + name,
  is_auto_inject: false,
  is_custom: false,
  source: 'builtin' as const,
  ...overrides,
});

const createWrapper = () => {
  const cache = new Map();
  return ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
  );
};

describe('resolveAssistantSkillNames', () => {
  it('returns nothing when there is neither an assistant nor a loaded skill', () => {
    // The composer mounts before the conversation assistant resolves; a crash
    // or a phantom entry here would break the menu on every conversation open.
    expect(resolveAssistantSkillNames(undefined, undefined)).toEqual([]);
    expect(resolveAssistantSkillNames(capabilities(), [])).toEqual([]);
  });

  it('offers the union of builtin ids and custom skill names', () => {
    // These are the two halves of what the user switched on in Settings; losing
    // either half makes the menu disagree with the assistant editor.
    expect(
      resolveAssistantSkillNames(
        capabilities({ default_skill_ids: ['cron'], custom_skill_names: ['my-skill'] }),
        undefined
      )
    ).toEqual(['cron', 'my-skill']);
  });

  it('lists a name appearing in both capability lists only once', () => {
    // A custom skill can shadow a builtin id; a duplicate would render two
    // identical rows in the menu and break keyboard navigation by index.
    expect(
      resolveAssistantSkillNames(capabilities({ default_skill_ids: ['cron'], custom_skill_names: ['cron'] }), undefined)
    ).toEqual(['cron']);
  });

  it('drops skills the assistant explicitly disabled', () => {
    // Turning a builtin off in Settings must actually remove it from the slash
    // menu -- the whole point of the disabled list.
    expect(
      resolveAssistantSkillNames(
        capabilities({ default_skill_ids: ['cron', 'pavii-cli'], default_disabled_builtin_skill_ids: ['cron'] }),
        undefined
      )
    ).toEqual(['pavii-cli']);
  });

  it('lets the disabled list win over a name that is also enabled', () => {
    // Subtraction runs after inclusion on purpose: if inclusion won, an "off"
    // switch would silently do nothing whenever the id was also in an enabled
    // list, which is the common state right after toggling.
    expect(
      resolveAssistantSkillNames(
        capabilities({
          default_skill_ids: ['cron'],
          custom_skill_names: ['cron'],
          default_disabled_builtin_skill_ids: ['cron'],
        }),
        undefined
      )
    ).toEqual([]);
  });

  it('keeps a skill already loaded into the conversation even when it is disabled', () => {
    // The skill is live in this session right now. If the assistant config
    // changed underneath the session, hiding it would leave the user unable to
    // reference something the agent is actively using.
    expect(
      resolveAssistantSkillNames(
        capabilities({ default_skill_ids: ['cron'], default_disabled_builtin_skill_ids: ['cron'] }),
        ['cron']
      )
    ).toEqual(['cron']);
  });

  it('adds loaded skills the assistant does not know about, without duplicating shared ones', () => {
    // Conversations can mount skills outside the assistant config; those must
    // appear exactly once alongside the configured ones.
    expect(resolveAssistantSkillNames(capabilities({ default_skill_ids: ['cron'] }), ['cron', 'session-only'])).toEqual(
      ['cron', 'session-only']
    );
  });

  it('offers loaded skills when there is no assistant at all', () => {
    // Some conversation kinds have no assistant record; the session own skills
    // still have to be reachable from the slash menu.
    expect(resolveAssistantSkillNames(undefined, ['session-only'])).toEqual(['session-only']);
  });
});

describe('useAssistantSlashSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assistantGetMock.mockResolvedValue(capabilities());
    listAvailableSkillsMock.mockResolvedValue([]);
  });

  it('fetches nothing when there is no assistant and no loaded skill', async () => {
    // Every composer mount would otherwise cost two IPC round-trips for a menu
    // that is guaranteed to be empty.
    const { result } = renderHook(() => useAssistantSlashSkills(undefined, undefined), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.names).toEqual([]);
    });
    expect(assistantGetMock).not.toHaveBeenCalled();
    expect(listAvailableSkillsMock).not.toHaveBeenCalled();
  });

  it('still loads the skills index when only loaded skills are present', async () => {
    // Without an assistant the index is the only source of descriptions for the
    // session own skills, so the fetch must not be gated on assistantId.
    const loaded = ['session-only'];
    listAvailableSkillsMock.mockResolvedValue([skillEntry('session-only', { description: 'Session skill' })]);

    const { result } = renderHook(() => useAssistantSlashSkills(undefined, loaded), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.descriptionByName.get('session-only')).toBe('Session skill');
    });
    expect(assistantGetMock).not.toHaveBeenCalled();
  });

  it('hides auto-inject skills that the assistant merely has enabled', async () => {
    // Auto-inject skills already apply to every turn. Listing them as commands
    // is noise that pushes the real choices off the visible menu.
    assistantGetMock.mockResolvedValue(capabilities({ default_skill_ids: ['always-on', 'cron'] }));
    listAvailableSkillsMock.mockResolvedValue([skillEntry('always-on', { is_auto_inject: true }), skillEntry('cron')]);

    const { result } = renderHook(() => useAssistantSlashSkills('assistant-1', undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.names).toEqual(['cron']);
    });
  });

  it('keeps an auto-inject skill that this conversation explicitly loaded', async () => {
    // If the session mounted it on purpose the user is working with it, so the
    // noise-reduction rule must not hide it.
    const loaded = ['always-on'];
    assistantGetMock.mockResolvedValue(capabilities({ default_skill_ids: ['always-on'] }));
    listAvailableSkillsMock.mockResolvedValue([skillEntry('always-on', { is_auto_inject: true })]);

    const { result } = renderHook(() => useAssistantSlashSkills('assistant-1', loaded), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.names).toEqual(['always-on']);
    });
  });

  it('shows candidates while the skills index is still loading', async () => {
    // The index request can resolve after the assistant request. Filtering
    // against an index that has not arrived would render an empty menu that
    // fills in a moment later -- a visible flicker every time slash is pressed.
    listAvailableSkillsMock.mockReturnValue(new Promise(() => {}));
    assistantGetMock.mockResolvedValue(capabilities({ default_skill_ids: ['cron'] }));

    const { result } = renderHook(() => useAssistantSlashSkills('assistant-1', undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.names).toEqual(['cron']);
    });
    expect(result.current.descriptionByName.size).toBe(0);
  });

  it('drops a candidate the loaded index does not know', async () => {
    // A stale id left in the assistant config points at a skill that no longer
    // exists; selecting it would insert a command the agent cannot run.
    assistantGetMock.mockResolvedValue(capabilities({ default_skill_ids: ['cron', 'deleted-skill'] }));
    listAvailableSkillsMock.mockResolvedValue([skillEntry('cron')]);

    const { result } = renderHook(() => useAssistantSlashSkills('assistant-1', undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.names).toEqual(['cron']);
    });
  });

  it('keeps an unindexed skill that this conversation loaded', async () => {
    // Conversation-scoped skills can be absent from the global index; they are
    // live in the session, so dropping them would make them unreachable.
    const loaded = ['session-only'];
    assistantGetMock.mockResolvedValue(capabilities({ default_skill_ids: ['cron'] }));
    listAvailableSkillsMock.mockResolvedValue([skillEntry('cron')]);

    const { result } = renderHook(() => useAssistantSlashSkills('assistant-1', loaded), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.names).toEqual(['cron', 'session-only']);
    });
  });

  it('maps descriptions only for the skills that survived filtering', async () => {
    // The menu secondary line is built from this map. Entries for filtered-out
    // skills are dead weight and a source of mismatched rows if the menu ever
    // iterates the map instead of the name list.
    assistantGetMock.mockResolvedValue(capabilities({ default_skill_ids: ['cron', 'always-on'] }));
    listAvailableSkillsMock.mockResolvedValue([
      skillEntry('cron', { description: 'Scheduled tasks' }),
      skillEntry('always-on', { description: 'Injected every turn', is_auto_inject: true }),
    ]);

    const { result } = renderHook(() => useAssistantSlashSkills('assistant-1', undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.names).toEqual(['cron']);
    });
    expect(Array.from(result.current.descriptionByName.entries())).toEqual([['cron', 'Scheduled tasks']]);
  });

  it('omits skills whose indexed description is empty', async () => {
    // An empty description must not become an empty secondary line; the menu
    // renders its fallback label instead when the map has no entry.
    assistantGetMock.mockResolvedValue(capabilities({ default_skill_ids: ['cron'] }));
    listAvailableSkillsMock.mockResolvedValue([skillEntry('cron', { description: '' })]);

    const { result } = renderHook(() => useAssistantSlashSkills('assistant-1', undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.names).toEqual(['cron']);
    });
    expect(result.current.descriptionByName.has('cron')).toBe(false);
  });

  it('returns an empty menu when the assistant lookup fails', async () => {
    // The assistant endpoint 404s for deleted assistants. The composer must
    // degrade to an empty skills section, not throw and take the input with it.
    assistantGetMock.mockRejectedValue(new Error('assistant not found'));

    const { result } = renderHook(() => useAssistantSlashSkills('missing-assistant', undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(assistantGetMock).toHaveBeenCalled();
    });
    expect(result.current.names).toEqual([]);
  });
});
