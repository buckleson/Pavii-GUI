/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import {
  awaitTurnCompleted,
  closeBridgeWs,
  createBridgeConversation,
  pickBridgeAssistant,
  replyTextFromTurnCompleted,
  sendBridgeMessage,
} from '@process/services/channels/backendConversationClient';

type GlobalWithPort = { __backendPort?: number };

const setBackendPort = (port: number | undefined): void => {
  (globalThis as GlobalWithPort).__backendPort = port;
};

afterEach(() => {
  closeBridgeWs();
  setBackendPort(undefined);
  vi.unstubAllGlobals();
});

describe('replyTextFromTurnCompleted', () => {
  it('returns string content directly', () => {
    expect(replyTextFromTurnCompleted({ last_message: { content: 'hello' } })).toBe('hello');
  });

  it('returns text field of an object content', () => {
    expect(replyTextFromTurnCompleted({ last_message: { content: { text: 'from text' } } })).toBe('from text');
  });

  it('returns content field of an object content', () => {
    expect(replyTextFromTurnCompleted({ last_message: { content: { content: 'nested' } } })).toBe('nested');
  });

  it('stringifies other object content shapes', () => {
    expect(replyTextFromTurnCompleted({ last_message: { content: { parts: [1, 2] } } })).toBe(
      JSON.stringify({ parts: [1, 2] })
    );
  });

  it('returns empty string when content is missing', () => {
    expect(replyTextFromTurnCompleted({ last_message: {} })).toBe('');
    expect(replyTextFromTurnCompleted({})).toBe('');
    expect(replyTextFromTurnCompleted(null)).toBe('');
    expect(replyTextFromTurnCompleted(undefined)).toBe('');
  });
});

describe('awaitTurnCompleted over a real WebSocket', () => {
  let server: WebSocketServer | null = null;

  const startServer = async (): Promise<void> => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    setBackendPort((server!.address() as AddressInfo).port);
  };

  const nextConnection = (): Promise<WebSocket> => new Promise((resolve) => server!.once('connection', resolve));

  afterEach(async () => {
    closeBridgeWs();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('resolves the waiter when a matching turn.completed frame arrives', async () => {
    await startServer();
    const connection = nextConnection();
    const pending = awaitTurnCompleted('conv-1', 'turn-1', 5000);
    const socket = await connection;
    socket.send(
      JSON.stringify({
        name: 'turn.completed',
        data: { session_id: 'conv-1', turn_id: 'turn-1', status: 'done', last_message: { content: 'hi' } },
      })
    );
    const completion = await pending;
    expect(completion.replyText).toBe('hi');
    expect(completion.conversationId).toBe('conv-1');
    expect(completion.turnId).toBe('turn-1');
    expect(completion.status).toBe('done');
  });

  it('ignores frames with a mismatched turn_id', async () => {
    await startServer();
    const connection = nextConnection();
    const pending = awaitTurnCompleted('conv-1', 'turn-1', 5000);
    const socket = await connection;
    socket.send(
      JSON.stringify({
        name: 'turn.completed',
        data: { session_id: 'conv-1', turn_id: 'other-turn', last_message: { content: 'wrong' } },
      })
    );
    socket.send(
      JSON.stringify({
        name: 'turn.completed',
        data: { session_id: 'conv-1', turn_id: 'turn-1', last_message: { content: 'right' } },
      })
    );
    const completion = await pending;
    expect(completion.replyText).toBe('right');
    expect(completion.turnId).toBe('turn-1');
  });

  it('resolves a turn-id-less waiter for a frame without turn_id', async () => {
    await startServer();
    const connection = nextConnection();
    const pending = awaitTurnCompleted('conv-1', undefined, 5000);
    const socket = await connection;
    socket.send(
      JSON.stringify({
        name: 'turn.completed',
        data: { session_id: 'conv-1', last_message: { content: 'no turn id' } },
      })
    );
    const completion = await pending;
    expect(completion.replyText).toBe('no turn id');
    expect(completion.turnId).toBeUndefined();
  });

  it('ignores frames for a different conversation', async () => {
    await startServer();
    const connection = nextConnection();
    const pending = awaitTurnCompleted('conv-1', undefined, 5000);
    const socket = await connection;
    socket.send(
      JSON.stringify({
        name: 'turn.completed',
        data: { session_id: 'conv-2', last_message: { content: 'wrong room' } },
      })
    );
    socket.send(
      JSON.stringify({
        name: 'turn.completed',
        data: { session_id: 'conv-1', last_message: { content: 'right room' } },
      })
    );
    const completion = await pending;
    expect(completion.replyText).toBe('right room');
    expect(completion.conversationId).toBe('conv-1');
  });

  it('rejects when no completion arrives within timeoutMs', async () => {
    await startServer();
    await expect(awaitTurnCompleted('conv-1', 'turn-1', 50)).rejects.toThrow(
      'Timed out waiting for the assistant reply'
    );
  });
});

describe('HTTP helpers', () => {
  const jsonResponse = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: () => Promise.resolve(body),
  });

  const stubFetch = (impl: (url: string, init?: RequestInit) => unknown): ReturnType<typeof vi.fn> => {
    const mock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  it('pickBridgeAssistant prefers an online enabled assistant', async () => {
    setBackendPort(45999);
    stubFetch(() =>
      jsonResponse({
        success: true,
        data: [
          { id: 'offline-1', enabled: true, agent_status: 'offline' },
          { id: 'online-1', enabled: true, agent_status: 'online' },
          { id: 'disabled-online', enabled: false, agent_status: 'online' },
        ],
      })
    );
    const assistant = await pickBridgeAssistant();
    expect(assistant.id).toBe('online-1');
  });

  it('pickBridgeAssistant falls back to any enabled assistant when none is online', async () => {
    setBackendPort(45999);
    stubFetch(() =>
      jsonResponse({
        success: true,
        data: [
          { id: 'disabled', enabled: false, agent_status: 'offline' },
          { id: 'enabled-offline', agent_status: 'offline' },
        ],
      })
    );
    const assistant = await pickBridgeAssistant();
    expect(assistant.id).toBe('enabled-offline');
  });

  it('pickBridgeAssistant throws when no assistant is usable', async () => {
    setBackendPort(45999);
    stubFetch(() => jsonResponse({ success: true, data: [{ id: 'off', enabled: false }] }));
    await expect(pickBridgeAssistant()).rejects.toThrow('No assistant available for channel bridge');
  });

  it('throws on an envelope with success:false', async () => {
    setBackendPort(45999);
    stubFetch(() => jsonResponse({ success: false, error: 'nope' }));
    await expect(pickBridgeAssistant()).rejects.toThrow('Backend /api/assistants failed (200): nope');
  });

  it('throws on a non-2xx response', async () => {
    setBackendPort(45999);
    stubFetch(() => jsonResponse({ success: true, data: [] }, false, 503));
    await expect(pickBridgeAssistant()).rejects.toThrow('failed (503)');
  });

  it('throws when the backend port is not available', async () => {
    setBackendPort(undefined);
    await expect(pickBridgeAssistant()).rejects.toThrow('Backend port not available yet');
  });

  it('createBridgeConversation unwraps the id and swallows runtime/ensure failures', async () => {
    setBackendPort(45999);
    const mock = stubFetch((url) => {
      if (url.endsWith('/api/conversations')) return jsonResponse({ success: true, data: { id: 'conv-9' } });
      // runtime/ensure fails; must not block conversation creation.
      return jsonResponse({ success: false, error: 'runtime down' }, false, 500);
    });
    const id = await createBridgeConversation('assistant-1', 'Slack C123');
    expect(id).toBe('conv-9');
    expect(mock).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = mock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe('http://127.0.0.1:45999/api/conversations');
    expect(JSON.parse(String(createInit.body))).toEqual({ name: 'Slack C123', assistant: { id: 'assistant-1' } });
    const [ensureUrl] = mock.mock.calls[1] as [string];
    expect(ensureUrl).toBe('http://127.0.0.1:45999/api/conversations/conv-9/runtime/ensure');
  });

  it('sendBridgeMessage posts the content and returns the turn id', async () => {
    setBackendPort(45999);
    const mock = stubFetch(() => jsonResponse({ success: true, data: { msg_id: 'm1', turn_id: 't7' } }));
    const result = await sendBridgeMessage('conv-9', 'hello backend');
    expect(result.turn_id).toBe('t7');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:45999/api/conversations/conv-9/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ content: 'hello backend' });
  });
});
