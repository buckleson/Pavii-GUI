import { describe, expect, it } from 'vitest';

import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  pickDefaultAssistantSelectionKey,
  resolveAssistantSelectionKey,
} from '@/renderer/pages/guid/hooks/useGuidAssistantSelection';

describe('guid assistant selection helpers', () => {
  const assistants: Assistant[] = [
    assistant({ id: 'builtin-writer', source: 'builtin', runtimeKey: 'claude', sort_order: 20 }),
    assistant({ id: 'bare-aionrs', source: 'generated', runtimeKey: 'aionrs', sort_order: 10 }),
    assistant({ id: 'user-research', source: 'user', runtimeKey: 'gemini', sort_order: 30 }),
  ];

  it('prefers explicit custom assistant keys when the assistant exists', () => {
    expect(resolveAssistantSelectionKey('custom:user-research', assistants)).toBe('user-research');
  });

  it('does not accept legacy backend keys as assistant selection ids', () => {
    expect(resolveAssistantSelectionKey('claude', assistants)).toBeUndefined();
    expect(resolveAssistantSelectionKey('aionrs', assistants)).toBeUndefined();
  });

  it('defaults to the generated aionrs assistant when no opencode assistant exists', () => {
    expect(pickDefaultAssistantSelectionKey(assistants)).toBe('bare-aionrs');
  });

  it('prefers a generated opencode assistant over a generated aionrs one', () => {
    const list = [
      ...assistants,
      assistant({ id: 'gen-opencode', source: 'generated', runtimeKey: 'opencode', sort_order: 40 }),
    ];
    expect(pickDefaultAssistantSelectionKey(list)).toBe('gen-opencode');
  });

  it('prefers a non-generated opencode assistant over a generated aionrs one', () => {
    const list = [
      ...assistants,
      assistant({ id: 'user-opencode', source: 'user', runtimeKey: 'opencode', sort_order: 40 }),
    ];
    expect(pickDefaultAssistantSelectionKey(list)).toBe('user-opencode');
  });

  it('prefers the generated opencode assistant over a non-generated one', () => {
    const list = [
      assistant({ id: 'user-opencode', source: 'user', runtimeKey: 'opencode', sort_order: 10 }),
      assistant({ id: 'gen-opencode', source: 'generated', runtimeKey: 'opencode', sort_order: 20 }),
    ];
    expect(pickDefaultAssistantSelectionKey(list)).toBe('gen-opencode');
  });

  it('ignores disabled opencode assistants and falls back to aionrs', () => {
    const list = [
      ...assistants,
      assistant({ id: 'off-opencode', source: 'generated', runtimeKey: 'opencode', enabled: false }),
    ];
    expect(pickDefaultAssistantSelectionKey(list)).toBe('bare-aionrs');
  });

  it('falls back to a non-generated aionrs assistant when no generated one exists', () => {
    const list = [
      assistant({ id: 'builtin-writer', source: 'builtin', runtimeKey: 'claude', sort_order: 10 }),
      assistant({ id: 'user-aionrs', source: 'user', runtimeKey: 'aionrs', sort_order: 20 }),
    ];
    expect(pickDefaultAssistantSelectionKey(list)).toBe('user-aionrs');
  });

  it('falls back to the first enabled assistant when neither opencode nor aionrs exists', () => {
    const list = [
      assistant({ id: 'off-writer', source: 'builtin', runtimeKey: 'claude', enabled: false }),
      assistant({ id: 'user-research', source: 'user', runtimeKey: 'gemini' }),
    ];
    expect(pickDefaultAssistantSelectionKey(list)).toBe('user-research');
  });

  it('returns null when no assistants are available', () => {
    expect(pickDefaultAssistantSelectionKey([])).toBeNull();
  });
});

function assistant(
  overrides: Partial<Assistant> & { id: string; source: Assistant['source']; runtimeKey: string }
): Assistant {
  const agentId = `agent-${overrides.runtimeKey}`;
  const isAionrs = overrides.runtimeKey === 'aionrs';
  return {
    id: overrides.id,
    source: overrides.source,
    name: overrides.id,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: overrides.sort_order ?? 0,
    agent_id: agentId,
    agent: isAionrs
      ? { type: 'aionrs', source: 'internal' }
      : { type: 'acp', source: 'builtin', acp_backend: overrides.runtimeKey },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: overrides.source === 'user',
    ...overrides,
  };
}
