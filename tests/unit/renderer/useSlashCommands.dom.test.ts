/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';

const { ensureRuntimeInvokeMock, getSlashCommandsInvokeMock } = vi.hoisted(() => ({
  ensureRuntimeInvokeMock: vi.fn(),
  getSlashCommandsInvokeMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      ensureRuntime: {
        invoke: ensureRuntimeInvokeMock,
      },
      getSlashCommands: {
        invoke: getSlashCommandsInvokeMock,
      },
    },
  },
}));

describe('useSlashCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureRuntimeInvokeMock.mockResolvedValue({ recovered: false, config_options: [], runtime: null });
    getSlashCommandsInvokeMock.mockResolvedValue([]);
  });

  it('preserves ACP slash-command metadata from the HTTP command list', async () => {
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
        completion_behavior: 'neutral_tip_on_empty',
        empty_turn_tip_code: 'acp.empty_turn.choose_command',
        empty_turn_tip_params: {
          command_count: 1,
        },
      },
    ]);

    const { result } = renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
      })
    );

    await waitFor(() => {
      expect(result.current).toEqual([
        {
          name: 'review',
          description: 'Review the current diff',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
          completionBehavior: 'neutral_tip_on_empty',
          emptyTurnTipCode: 'acp.empty_turn.choose_command',
          emptyTurnTipParams: {
            command_count: 1,
          },
        },
      ]);
    });
  });

  it('preserves ACP slash-command metadata from camelCase HTTP fields', async () => {
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
        hint: '⌘R',
        completionBehavior: 'neutral_tip_on_empty',
        emptyTurnTipCode: 'acp.empty_turn.choose_command',
        emptyTurnTipParams: {
          command_count: 1,
        },
      },
    ]);

    const { result } = renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
      })
    );

    await waitFor(() => {
      expect(result.current).toEqual([
        {
          name: 'review',
          description: 'Review the current diff',
          hint: '⌘R',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
          completionBehavior: 'neutral_tip_on_empty',
          emptyTurnTipCode: 'acp.empty_turn.choose_command',
          emptyTurnTipParams: {
            command_count: 1,
          },
        },
      ]);
    });
  });

  it('ensures the conversation runtime before loading slash commands', async () => {
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
      },
    ]);

    renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
      })
    );

    await waitFor(() => {
      expect(ensureRuntimeInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    expect(ensureRuntimeInvokeMock.mock.invocationCallOrder[0]).toBeLessThan(
      getSlashCommandsInvokeMock.mock.invocationCallOrder[0]
    );
  });

  it('uses injected runtime preparation instead of standalone ensure', async () => {
    const prepareRuntime = vi.fn().mockResolvedValue(undefined);
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
      },
    ]);

    renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
        prepareRuntime,
      })
    );

    await waitFor(() => {
      expect(prepareRuntime).toHaveBeenCalled();
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    expect(ensureRuntimeInvokeMock).not.toHaveBeenCalled();
    expect(prepareRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      getSlashCommandsInvokeMock.mock.invocationCallOrder[0]
    );
  });

  describe('fetch-failure resilience', () => {
    // The module-level LRU cache in useSlashCommands persists across tests in
    // this file, so every test below uses its own conversation id to stay
    // isolated. The hook logs fetch failures via console.error; silence it so
    // intentional rejections do not pollute the test output.
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    /** Flush the promise chain so a settled fetch (including a rejection,
     *  which never triggers a re-render on its own) has run its handlers. */
    const flushFetchHandlers = async () => {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    it('keeps the last known commands when a re-fetch rejects after a success', async () => {
      // Regression guard: the slash endpoint 404s for idle conversations, and
      // the old `.catch(() => setCommands([]))` blanked the menu between turns
      // even though the cache still held a good list.
      getSlashCommandsInvokeMock
        .mockResolvedValueOnce([{ command: 'review', description: 'Review the current diff' }])
        .mockRejectedValueOnce(new Error('slash endpoint unavailable'));

      const { result, rerender } = renderHook(
        ({ agentStatus }: { agentStatus: string }) =>
          useSlashCommands('conv-keep-on-error', { conversation_type: 'acp', agentStatus }),
        { initialProps: { agentStatus: 'session_active' } }
      );

      await waitFor(() => {
        expect(result.current).toHaveLength(1);
      });

      // agentStatus change re-runs the effect and triggers the failing fetch.
      rerender({ agentStatus: 'session_resumed' });

      await waitFor(() => {
        expect(getSlashCommandsInvokeMock).toHaveBeenCalledTimes(2);
      });
      await flushFetchHandlers();

      expect(result.current).toEqual([expect.objectContaining({ name: 'review', source: 'acp' })]);
    });

    it('stays empty without throwing when the first fetch rejects on a cold cache', async () => {
      // First load with nothing cached: there is no "last known" list to keep,
      // so the menu must simply stay empty (and the rejection must be handled).
      getSlashCommandsInvokeMock.mockRejectedValueOnce(new Error('engine not warmed up'));

      const { result } = renderHook(() =>
        useSlashCommands('conv-cold-error', { conversation_type: 'acp', agentStatus: 'session_active' })
      );

      await waitFor(() => {
        expect(getSlashCommandsInvokeMock).toHaveBeenCalledTimes(1);
      });
      await flushFetchHandlers();

      expect(result.current).toEqual([]);
      // The catch branch ran (rejection handled, not swallowed by an unhandled
      // rejection warning elsewhere).
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('clears the menu on a genuinely empty successful fetch even when the cache had items', async () => {
      // Keeping commands is only for FAILED fetches — an agent that reports an
      // empty catalog must not keep showing stale cached entries.
      getSlashCommandsInvokeMock
        .mockResolvedValueOnce([{ command: 'review', description: 'Review the current diff' }])
        .mockResolvedValueOnce([]);

      const { result, rerender } = renderHook(
        ({ agentStatus }: { agentStatus: string }) =>
          useSlashCommands('conv-empty-success', { conversation_type: 'acp', agentStatus }),
        { initialProps: { agentStatus: 'session_active' } }
      );

      await waitFor(() => {
        expect(result.current).toHaveLength(1);
      });

      rerender({ agentStatus: 'session_resumed' });

      await waitFor(() => {
        expect(result.current).toEqual([]);
      });
    });

    it('serves the per-conversation cached list when switching back to a conversation whose fetch fails', async () => {
      // Keeping the last known commands must not leak across conversations:
      // switching ids re-seeds from the cache keyed by the NEW id, so after
      // A → B → A with A's re-fetch failing, the menu shows A's commands (from
      // cache), never B's.
      getSlashCommandsInvokeMock
        .mockResolvedValueOnce([{ command: 'alpha', description: 'Command of conversation A' }])
        .mockResolvedValueOnce([{ command: 'beta', description: 'Command of conversation B' }])
        .mockRejectedValueOnce(new Error('re-fetch failed'));

      const { result, rerender } = renderHook(
        ({ id }: { id: string }) => useSlashCommands(id, { conversation_type: 'acp', agentStatus: 'session_active' }),
        { initialProps: { id: 'conv-swap-a' } }
      );

      await waitFor(() => {
        expect(result.current).toEqual([expect.objectContaining({ name: 'alpha' })]);
      });

      rerender({ id: 'conv-swap-b' });
      await waitFor(() => {
        expect(result.current).toEqual([expect.objectContaining({ name: 'beta' })]);
      });

      rerender({ id: 'conv-swap-a' });
      await waitFor(() => {
        expect(getSlashCommandsInvokeMock).toHaveBeenCalledTimes(3);
      });
      await flushFetchHandlers();

      expect(result.current).toEqual([expect.objectContaining({ name: 'alpha' })]);
    });

    it('recovers with fresh commands after a rejected fetch once a later fetch succeeds', async () => {
      // A rejection must not poison the flow: the next successful fetch still
      // repopulates both the menu and the cache.
      getSlashCommandsInvokeMock
        .mockRejectedValueOnce(new Error('first fetch failed'))
        .mockResolvedValueOnce([{ command: 'gamma', description: 'Recovered command' }]);

      const { result, rerender } = renderHook(
        ({ agentStatus }: { agentStatus: string }) =>
          useSlashCommands('conv-recover', { conversation_type: 'acp', agentStatus }),
        { initialProps: { agentStatus: 'session_active' } }
      );

      await waitFor(() => {
        expect(getSlashCommandsInvokeMock).toHaveBeenCalledTimes(1);
      });
      await flushFetchHandlers();
      expect(result.current).toEqual([]);

      rerender({ agentStatus: 'session_resumed' });

      await waitFor(() => {
        expect(result.current).toEqual([expect.objectContaining({ name: 'gamma' })]);
      });
    });
  });
});
