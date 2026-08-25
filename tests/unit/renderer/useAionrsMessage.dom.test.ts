/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAionrsMessage } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { resetConversationTurnClockForTests } from '@/renderer/pages/conversation/utils/conversationTurnClock';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';

const {
  addOrUpdateMessageMock,
  conversationUpdateInvokeMock,
  recordUsageInvokeMock,
  responseStreamOnMock,
  responseStreamHandlerRef,
} = vi.hoisted(() => ({
  addOrUpdateMessageMock: vi.fn(),
  conversationUpdateInvokeMock: vi.fn(),
  recordUsageInvokeMock: vi.fn(),
  responseStreamOnMock: vi.fn(),
  responseStreamHandlerRef: {
    current: undefined as ((message: IResponseMessage) => void) | undefined,
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => addOrUpdateMessageMock,
  useMergeLiveMessage: () => addOrUpdateMessageMock,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    // Kept in the mock deliberately: if the renderer ever starts recording
    // usage again this spy will catch it, rather than the call vanishing into
    // an undefined-property error that reads like an unrelated failure.
    paviiUsage: {
      record: { invoke: recordUsageInvokeMock },
    },
    conversation: {
      responseStream: {
        on: responseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
      update: {
        invoke: conversationUpdateInvokeMock,
      },
    },
  },
}));

describe('useAionrsMessage turn clock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationTurnClockForTests();
    conversationUpdateInvokeMock.mockResolvedValue(undefined);
    responseStreamHandlerRef.current = undefined;
  });

  it('preserves the turn start timestamp when switching away and back to a running conversation', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result, rerender } = renderHook(({ id }) => useAionrsMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBeNull();

    // User sends a message at t=100s — the send box flips waitingResponse on.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);

    // Switch to another conversation while the backend keeps processing conv-1.
    vi.mocked(getConversationOrNull).mockImplementation((id: string) =>
      Promise.resolve(id === 'conv-1' ? ({ runtime: { is_processing: true } } as never) : null)
    );
    nowSpy.mockReturnValue(200_000);
    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(false);
    });
    expect(result.current.turnStartedAtMs).toBeNull();

    // Switch back — hydration restores processing state with the ORIGINAL start
    // time, so the elapsed indicator does not restart from zero.
    rerender({ id: 'conv-1' });
    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();
  });

  it('keeps the persisted origin when entering a running conversation from an idle one', async () => {
    // conv-2 recorded an origin during its own send earlier in the session.
    vi.mocked(getConversationOrNull).mockImplementation((id: string) =>
      Promise.resolve(id === 'conv-2' ? ({ runtime: { is_processing: true } } as never) : null)
    );

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const first = renderHook(() => useAionrsMessage('conv-2'));
    await waitFor(() => {
      expect(first.result.current.running).toBe(true);
    });
    expect(first.result.current.turnStartedAtMs).toBe(100_000);
    first.unmount();

    // A fresh mount starts on an idle conversation, then navigates to conv-2.
    nowSpy.mockReturnValue(250_000);
    const { result, rerender } = renderHook(({ id }) => useAionrsMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.running).toBe(false);

    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();
  });

  it('drops a stale turn start timestamp when hydration reports the conversation idle', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result, rerender } = renderHook(({ id }) => useAionrsMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();

    // Turn ends while the user is on another conversation: switching back finds
    // the backend idle, so the recorded origin must be discarded.
    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(false);
    });
    rerender({ id: 'conv-1' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.running).toBe(false);
    expect(result.current.turnStartedAtMs).toBeNull();

    // A later turn starts from its own send time, not the stale origin.
    const nowSpy2 = vi.spyOn(Date, 'now').mockReturnValue(500_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(500_000);
    nowSpy2.mockRestore();
  });

  it('clears the turn start timestamp when the turn finishes', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result } = renderHook(() => useAionrsMessage('conv-1'));
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        conversation_id: 'conv-1',
      } as unknown as IResponseMessage);
    });
    expect(result.current.running).toBe(false);
    expect(result.current.turnStartedAtMs).toBeNull();

    // The next turn gets a fresh origin instead of inheriting the stale one.
    nowSpy.mockReturnValue(300_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(300_000);
    nowSpy.mockRestore();
  });
});

describe('useAionrsMessage token accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationTurnClockForTests();
    conversationUpdateInvokeMock.mockResolvedValue(undefined);
    responseStreamHandlerRef.current = undefined;
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
  });

  const finishWithUsage = (input_tokens: number, output_tokens: number, conversation_id = 'conv-1') =>
    ({
      type: 'finish',
      data: { input_tokens, output_tokens },
      msg_id: 'msg-1',
      conversation_id,
    }) as unknown as IResponseMessage;

  it('never records usage from the renderer', async () => {
    // The engine owns the ledger now. Recording here saw only conversations
    // this window had open, and this frame carries the session RUNNING TOTAL,
    // so every turn re-submitted tokens already counted.
    const { result } = renderHook(() => useAionrsMessage('conv-1'));
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      responseStreamHandlerRef.current?.(finishWithUsage(40_000, 12_000));
    });

    // The usage branch really ran — otherwise this assertion would pass
    // vacuously and guard nothing.
    expect(result.current.tokenUsage).toEqual({ total_tokens: 52_000 });
    expect(recordUsageInvokeMock).not.toHaveBeenCalled();
  });

  it('shows the latest session total rather than a sum across turns', async () => {
    // aionrs reports a cumulative session total on every finish. Accumulating
    // those frames inflated superlinearly (turn 3 counted turn 1 three times);
    // the indicator must track the newest figure, never their sum.
    const { result } = renderHook(() => useAionrsMessage('conv-1'));
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      responseStreamHandlerRef.current?.(finishWithUsage(10_000, 2_000));
      responseStreamHandlerRef.current?.(finishWithUsage(17_000, 3_000));
      responseStreamHandlerRef.current?.(finishWithUsage(26_000, 5_000));
    });

    expect(result.current.tokenUsage).toEqual({ total_tokens: 31_000 });
    expect(recordUsageInvokeMock).not.toHaveBeenCalled();
  });

  it('ignores a finish frame carrying usage for a different conversation', async () => {
    // Every mounted hook shares one response stream. Attributing another
    // chat's totals here would show a figure the user never spent in this chat
    // and persist it onto the wrong conversation row.
    const { result } = renderHook(() => useAionrsMessage('conv-1'));
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      responseStreamHandlerRef.current?.(finishWithUsage(40_000, 12_000, 'conv-2'));
    });

    expect(result.current.tokenUsage).toBeNull();
    expect(conversationUpdateInvokeMock).not.toHaveBeenCalled();
  });

  it('leaves the indicator untouched when a finish frame carries no token figures', async () => {
    // A plain terminal frame (`data: null`) must not be treated as usage:
    // persisting `total_tokens: 0` would blank a real figure on every turn
    // that ends without a usage payload.
    const { result } = renderHook(() => useAionrsMessage('conv-1'));
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      responseStreamHandlerRef.current?.(finishWithUsage(40_000, 12_000));
    });
    expect(result.current.tokenUsage).toEqual({ total_tokens: 52_000 });

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        msg_id: 'msg-2',
        conversation_id: 'conv-1',
      } as unknown as IResponseMessage);
    });

    expect(result.current.tokenUsage).toEqual({ total_tokens: 52_000 });
    expect(recordUsageInvokeMock).not.toHaveBeenCalled();
  });
});
