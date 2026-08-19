/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for renderer/hooks/agent/useManagedAgents.ts.
 *
 * The Agent settings management surface must read the
 * `include_disabled=true` view (a SEPARATE SWR key from any detected-agent
 * cache). Diagnostics-only actions can refresh the management cache only;
 * catalog-changing or health actions that affect generated assistants must also
 * invalidate assistant list caches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: [], error: null, isLoading: false })),
  mutate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/common', () => ({
  ipcBridge: { acpConversation: {} },
}));

vi.mock('@/renderer/utils/model/agentTypes', () => ({
  MANAGED_AGENTS_SWR_KEY: 'agents.managed',
  fetchManagedAgents: vi.fn(),
}));

import { getManagedAgents, useManagedAgents } from '@/renderer/hooks/agent/useManagedAgents';
import { ipcBridge } from '@/common';
import useSWR, { mutate } from 'swr';
import { fetchManagedAgents } from '@/renderer/utils/model/agentTypes';

describe('useManagedAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to the management SWR key with the managed fetcher', () => {
    (useSWR as any).mockReturnValue({ data: [], error: null, isLoading: false });

    renderHook(() => useManagedAgents());

    expect(useSWR).toHaveBeenCalledWith('agents.managed', fetchManagedAgents);
  });

  it('exposes the agents returned by SWR', () => {
    const agents = [
      { id: 'x', name: 'X', agent_type: 'acp', agent_source: 'custom', enabled: false, available: false },
    ];
    (useSWR as any).mockReturnValue({ data: agents, error: null, isLoading: false });

    const { result } = renderHook(() => useManagedAgents());

    expect(result.current.agents).toEqual(agents);
  });

  it('falls back to an empty list when SWR has no data yet', () => {
    (useSWR as any).mockReturnValue({ data: undefined, error: null, isLoading: true });

    const { result } = renderHook(() => useManagedAgents());

    expect(result.current.agents).toEqual([]);
  });

  it('revalidate refreshes only the management key', async () => {
    (useSWR as any).mockReturnValue({ data: [], error: null, isLoading: false });

    const { result } = renderHook(() => useManagedAgents());

    await act(async () => {
      await result.current.revalidate();
    });

    expect(mutate).toHaveBeenCalledWith('agents.managed');
    expect(mutate).not.toHaveBeenCalledWith('agents.detected');
  });

  it('refreshCatalog refreshes the management key and assistant list caches', async () => {
    (useSWR as any).mockReturnValue({ data: [], error: null, isLoading: false });

    const { result } = renderHook(() => useManagedAgents());

    await act(async () => {
      await result.current.refreshCatalog();
    });

    expect(mutate).toHaveBeenCalledWith('agents.managed');
    expect(mutate).toHaveBeenCalledWith('assistants.list');
  });

  it('exposes no backend-rescan action, because the engine has no such route', () => {
    // `POST /api/agents/refresh` is a legacy endpoint the engine deliberately
    // removed — `acp_e2e.rs::legacy_refresh_agents_endpoint_is_not_found`
    // asserts it 404s. The hook used to call it, so the action always rejected.
    // Detection runs at launch instead; `refreshCatalog` is the real action.
    (useSWR as any).mockReturnValue({ data: [], error: null, isLoading: false });

    const { result } = renderHook(() => useManagedAgents());

    expect('refreshCustomAgents' in result.current).toBe(false);
    expect(typeof result.current.refreshCatalog).toBe('function');
  });

  it('getManagedAgents fetches the management catalog without invalidating the detected cache', async () => {
    const managedAgents = [
      { id: 'managed-1', name: 'Managed Agent', agent_type: 'acp', agent_source: 'builtin', enabled: true },
    ];
    (fetchManagedAgents as any).mockResolvedValue(managedAgents);

    const result = await getManagedAgents();

    expect(fetchManagedAgents).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith('agents.managed', managedAgents, { revalidate: false });
    expect(mutate).not.toHaveBeenCalledWith('agents.detected');
    expect(result).toEqual(managedAgents);
  });
});
