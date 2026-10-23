/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  filterAgentsByAvailability,
  filterOpenSourceAgents,
  getAgentAvailabilityFilterStats,
  type AgentAvailabilityFilter,
} from '@/renderer/pages/settings/AgentSettings/agentFilters';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const agent = (id: string, status: ManagedAgent['status']): ManagedAgent =>
  ({
    id,
    name: id,
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    installed: status !== 'missing',
    status,
  }) as ManagedAgent;

describe('agent availability filters', () => {
  const agents = [agent('a', 'offline'), agent('b', 'online'), agent('c', 'missing'), agent('d', 'online')];

  it('counts all, available, and unavailable agents', () => {
    expect(getAgentAvailabilityFilterStats(agents)).toEqual({
      all: 4,
      available: 2,
      unavailable: 2,
      openSource: 0,
    });
  });

  it.each<[AgentAvailabilityFilter, string[]]>([
    ['all', ['a', 'b', 'c', 'd']],
    ['available', ['b', 'd']],
    ['unavailable', ['a', 'c']],
  ])('filters %s agents without changing relative order', (filter, expectedIds) => {
    expect(filterAgentsByAvailability(agents, filter).map((item) => item.id)).toEqual(expectedIds);
  });
});

const backendAgent = (
  id: string,
  backend: string | undefined,
  status: ManagedAgent['status'] = 'missing'
): ManagedAgent => ({ ...agent(id, status), name: id, backend }) as ManagedAgent;

describe('open-source agent filter', () => {
  // Names deliberately sort opposite to OPEN_SOURCE_CLIS order (openclaw, hermes, opencode, codex, ...).
  const agents = [
    backendAgent('aaa-codex', 'codex', 'online'),
    backendAgent('zzz-openclaw', 'openclaw'),
    backendAgent('claude', 'claude', 'online'),
    backendAgent('mmm-hermes', 'hermes'),
    backendAgent('no-backend', undefined),
  ];

  it('keeps only agents whose backend is listed in OPEN_SOURCE_CLIS', () => {
    const ids = filterOpenSourceAgents(agents).map((item) => item.id);
    expect(ids).not.toContain('claude');
    expect(ids).not.toContain('no-backend');
  });

  it('orders open-source agents by OPEN_SOURCE_CLIS position rather than by name or input order', () => {
    expect(filterOpenSourceAgents(agents).map((item) => item.id)).toEqual(['zzz-openclaw', 'mmm-hermes', 'aaa-codex']);
  });

  it('keeps every row that shares a backend, in their original relative order', () => {
    const rows = [
      backendAgent('codex-2', 'codex'),
      backendAgent('openclaw', 'openclaw'),
      backendAgent('codex-1', 'codex'),
    ];
    expect(filterOpenSourceAgents(rows).map((item) => item.id)).toEqual(['openclaw', 'codex-2', 'codex-1']);
  });

  it('routes the openSource availability filter through the open-source ordering', () => {
    expect(filterAgentsByAvailability(agents, 'openSource').map((item) => item.id)).toEqual([
      'zzz-openclaw',
      'mmm-hermes',
      'aaa-codex',
    ]);
  });

  it('counts open-source agents in the filter stats regardless of status', () => {
    expect(getAgentAvailabilityFilterStats(agents)).toEqual({ all: 5, available: 2, unavailable: 3, openSource: 3 });
  });

  it('returns an empty list and zero counts for an empty catalog', () => {
    expect(filterOpenSourceAgents([])).toEqual([]);
    expect(getAgentAvailabilityFilterStats([])).toEqual({ all: 0, available: 0, unavailable: 0, openSource: 0 });
  });

  it('does not mutate the input array when sorting', () => {
    const input = [...agents];
    filterOpenSourceAgents(input);
    expect(input.map((item) => item.id)).toEqual(agents.map((item) => item.id));
  });
});
