/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';

/**
 * Minimal main-process client for driving aioncore conversations on behalf of
 * channel bridges (Slack/Discord). The backend trusts its own local process:
 * plain HTTP on 127.0.0.1, no auth (spawned with --local), events on /ws.
 *
 * Kept independent of the renderer's httpBridge singleton, which is
 * renderer-only (returns early without `window`).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60 * 1000;

type Envelope<T> = { success: boolean; data?: T; error?: string };

export type TurnCompletion = {
  conversationId: string;
  turnId?: string;
  status?: string;
  replyText: string;
};

const backendPort = (): number => {
  const port = (globalThis as { __backendPort?: number }).__backendPort;
  if (!port) throw new Error('Backend port not available yet');
  return port;
};

const baseUrl = (): string => `http://127.0.0.1:${backendPort()}`;

async function backendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, init);
  const body = (await response.json().catch((): null => null)) as Envelope<T> | null;
  if (!response.ok || !body || body.success === false) {
    throw new Error(`Backend ${path} failed (${response.status}): ${body?.error ?? 'unknown'}`);
  }
  return body.data as T;
}

type AssistantRow = { id: string; enabled?: boolean; agent_status?: string; name?: string };

/** Pick the assistant new bridge conversations run on: online OpenCode first. */
export async function pickBridgeAssistant(): Promise<AssistantRow> {
  const assistants = await backendFetch<AssistantRow[]>('/api/assistants');
  const online = assistants.filter((a) => a.enabled !== false && a.agent_status === 'online');
  const usable = online.length > 0 ? online : assistants.filter((a) => a.enabled !== false);
  if (usable.length === 0) throw new Error('No assistant available for channel bridge');
  return usable[0];
}

export async function createBridgeConversation(assistantId: string, name: string): Promise<string> {
  const data = await backendFetch<{ id: string }>('/api/conversations', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, assistant: { id: assistantId } }),
  });
  await backendFetch(`/api/conversations/${data.id}/runtime/ensure`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '{}',
  }).catch(() => {
    // Lazy runtime: a failure here surfaces again on send; don't block.
  });
  return data.id;
}

export async function sendBridgeMessage(conversationId: string, content: string): Promise<{ turn_id?: string }> {
  return backendFetch<{ msg_id: string; turn_id?: string }>(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  });
}

type WsFrame = { name?: string; event?: string; data?: unknown; payload?: unknown };

type TurnWaiter = {
  conversationId: string;
  turnId?: string;
  resolve: (completion: TurnCompletion) => void;
  timer: NodeJS.Timeout;
};

let ws: WebSocket | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;
const turnWaiters = new Set<TurnWaiter>();

/** Extract the assistant's final reply text from a turn.completed payload. */
export function replyTextFromTurnCompleted(data: unknown): string {
  const turn = data as { last_message?: { content?: unknown } } | null;
  const content = turn?.last_message?.content;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    const rich = content as { text?: string; content?: string };
    if (typeof rich.text === 'string') return rich.text;
    if (typeof rich.content === 'string') return rich.content;
    return JSON.stringify(content);
  }
  return '';
}

function dispatchFrame(frame: WsFrame): void {
  const name = frame.name ?? frame.event;
  if (name !== 'turn.completed') return;
  const data = (frame.data ?? frame.payload) as {
    session_id?: string;
    conversation_id?: string;
    turn_id?: string;
    status?: string;
  } | null;
  if (!data) return;
  const conversationId = data.session_id ?? data.conversation_id ?? '';
  const waiters = Array.from(turnWaiters);
  for (const waiter of waiters) {
    const turnMatch = waiter.turnId && data.turn_id ? waiter.turnId === data.turn_id : true;
    if (waiter.conversationId === conversationId && turnMatch) {
      turnWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve({
        conversationId,
        turnId: data.turn_id,
        status: data.status,
        replyText: replyTextFromTurnCompleted(data),
      });
    }
  }
}

function ensureBridgeWs(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  // Port can change across backend restarts: resolve on every (re)connect.
  const socket = new WebSocket(`ws://127.0.0.1:${backendPort()}/ws`);
  ws = socket;
  socket.on('message', (raw) => {
    try {
      dispatchFrame(JSON.parse(String(raw)) as WsFrame);
    } catch {
      // Non-JSON frames are not ours to handle.
    }
  });
  const scheduleReconnect = () => {
    if (ws !== socket) return;
    ws = null;
    if (turnWaiters.size === 0) return;
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      try {
        ensureBridgeWs();
      } catch {
        // Backend down; the next awaitTurn call retries.
      }
    }, 2000);
    wsReconnectTimer.unref?.();
  };
  socket.on('close', scheduleReconnect);
  socket.on('error', scheduleReconnect);
}

/**
 * Resolve with the assistant's reply once the conversation's turn completes.
 * Call BEFORE sending the message when possible; matching tolerates a missing
 * turn id (first completion for the conversation wins).
 */
export function awaitTurnCompleted(
  conversationId: string,
  turnId?: string,
  timeoutMs: number = DEFAULT_TURN_TIMEOUT_MS
): Promise<TurnCompletion> {
  ensureBridgeWs();
  return new Promise<TurnCompletion>((resolve, reject) => {
    const waiter: TurnWaiter = {
      conversationId,
      turnId,
      resolve,
      timer: setTimeout(() => {
        turnWaiters.delete(waiter);
        reject(new Error('Timed out waiting for the assistant reply'));
      }, timeoutMs),
    };
    waiter.timer.unref?.();
    turnWaiters.add(waiter);
  });
}

/** Close the shared bridge WS (app shutdown, tests). */
export function closeBridgeWs(): void {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  for (const waiter of turnWaiters) clearTimeout(waiter.timer);
  turnWaiters.clear();
  ws?.close();
  ws = null;
}
