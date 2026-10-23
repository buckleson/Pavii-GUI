/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Codex thread reader: the app-server JSON-RPC client (handshake, errors,
 * exit, timeout, process cleanup), thread/list paging with the state-DB
 * fallback, and Thread / turn item conversion.
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Frame = { id?: number; method?: string; params?: unknown };
type Responder = (frame: Frame, child: FakeChild) => void;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  frames: Frame[] = [];
  exitCode: number | null = null;
  signalCode: string | null = null;
  pid = 4242;
  kill = vi.fn();
  stdin: Writable;

  constructor(private responder: Responder) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        for (const raw of chunk.toString().split('\n').filter(Boolean)) {
          const frame = JSON.parse(raw) as Frame;
          this.frames.push(frame);
          this.responder(frame, this);
        }
        callback();
      },
    });
  }

  reply(id: number | undefined, payload: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...payload })}\n`);
  }
}

const { spawn, state } = vi.hoisted(() => ({
  spawn: vi.fn(),
  state: { responder: undefined as unknown as Responder, children: [] as unknown[] },
}));

vi.mock('node:child_process', () => ({ spawn, default: { spawn } }));

import {
  CODEX_TIMEOUT_MS,
  codexThreadMessages,
  listCodexThreads,
  MAX_CODEX_THREADS,
  readCodexThread,
  withCodexAppServer,
} from '@process/paviiData/codexSessions';

const FOLDER = path.resolve('/work/demo');
const originalPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

/** Answers `initialize` and the given methods; anything else stays unanswered. */
const answer =
  (results: Record<string, unknown> = {}): Responder =>
  (frame, child) => {
    if (frame.id === undefined) return;
    if (frame.method === 'initialize') child.reply(frame.id, { result: {} });
    else if (frame.method && frame.method in results) child.reply(frame.id, { result: results[frame.method] });
  };

const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Thread ${id}`,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_100,
  ...extra,
});

const sameFolder = (a: string, b: string) => a === b;

const lastChild = (): FakeChild => state.children[state.children.length - 1] as FakeChild;

beforeEach(() => {
  vi.clearAllMocks();
  state.children = [];
  state.responder = answer();
  setPlatform('linux');
  spawn.mockImplementation((command: string) => {
    if (command === 'taskkill') return new EventEmitter();
    const child = new FakeChild((frame, c) => state.responder(frame, c));
    state.children.push(child);
    return child;
  });
});

afterEach(() => {
  vi.useRealTimers();
  setPlatform(originalPlatform);
});

describe('withCodexAppServer', () => {
  it('sends initialize, then the initialized notification, before the work', async () => {
    state.responder = answer({ 'thread/list': { data: [] } });

    await withCodexAppServer('codex', (rpc) => rpc('thread/list', {}));

    expect(lastChild().frames.map((f) => [f.method, f.id])).toEqual([
      ['initialize', 1],
      ['initialized', undefined],
      ['thread/list', 2],
    ]);
  });

  it('resolves with the work result and kills the app-server afterwards', async () => {
    state.responder = answer({ ping: 'pong' });

    const result = await withCodexAppServer('codex', (rpc) => rpc('ping', {}));

    expect(result).toBe('pong');
    expect(lastChild().kill).toHaveBeenCalledTimes(1);
  });

  it('ignores non-JSON output and server notifications while waiting for a reply', async () => {
    state.responder = (frame, child) => {
      if (frame.id === undefined) return;
      child.stdout.write('not json\n');
      child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, method: 'note', params: {} })}\n`);
      child.reply(frame.id, { result: frame.method });
    };

    await expect(withCodexAppServer('codex', (rpc) => rpc('echo', {}))).resolves.toBe('echo');
  });

  it('rejects with the JSON-RPC error message', async () => {
    state.responder = (frame, child) => {
      if (frame.method === 'initialize') child.reply(frame.id, { result: {} });
      else if (frame.id !== undefined) child.reply(frame.id, { error: { code: -32600, message: 'bad request' } });
    };

    await expect(withCodexAppServer('codex', (rpc) => rpc('thread/list', {}))).rejects.toThrow('bad request');
  });

  it('rejects when the binary cannot be spawned', async () => {
    state.responder = () => {};
    const run = withCodexAppServer('codex', (rpc) => rpc('x', {}));
    lastChild().emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));

    await expect(run).rejects.toThrow('ENOENT');
  });

  it('rejects when the app-server exits early', async () => {
    state.responder = () => {};
    const run = withCodexAppServer('codex', (rpc) => rpc('x', {}));
    lastChild().emit('exit', 1);

    await expect(run).rejects.toThrow('codex app-server exited (1)');
  });

  it('times out and kills a silent app-server', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    state.responder = () => {};
    const run = withCodexAppServer('codex', (rpc) => rpc('x', {}));
    const assertion = expect(run).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(CODEX_TIMEOUT_MS);

    await assertion;
    expect(lastChild().kill).toHaveBeenCalled();
  });

  it('rejects in-flight requests on timeout even when the process never exits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    state.responder = answer();
    let inFlight: Promise<unknown> | undefined;
    const run = withCodexAppServer('codex', (rpc) => {
      inFlight = rpc('never', {});
      return inFlight;
    });
    const runAssertion = expect(run).rejects.toThrow('codex app-server timed out');

    await vi.advanceTimersByTimeAsync(CODEX_TIMEOUT_MS - 1);
    expect(inFlight).toBeDefined();
    const inFlightSettled = vi.fn();
    void inFlight?.then(inFlightSettled, inFlightSettled);
    await Promise.resolve();
    expect(inFlightSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    await runAssertion;
    await expect(inFlight).rejects.toThrow('codex app-server timed out');
    expect(lastChild().kill).toHaveBeenCalled();
  });

  it('does not kill a process that has already exited', async () => {
    state.responder = (frame, child) => {
      if (frame.method === 'initialize') child.reply(frame.id, { result: {} });
      if (frame.method === 'bye') {
        child.exitCode = 0;
        child.reply(frame.id, { result: 'ok' });
      }
    };

    await withCodexAppServer('codex', (rpc) => rpc('bye', {}));

    expect(lastChild().kill).not.toHaveBeenCalled();
  });

  it('runs Windows .cmd shims through cmd.exe and kills the process tree with taskkill', async () => {
    setPlatform('win32');
    state.responder = answer({ ping: 'pong' });

    await withCodexAppServer('C:\\tools\\codex.cmd', (rpc) => rpc('ping', {}));

    expect(spawn.mock.calls[0][0]).toBe('cmd.exe');
    expect(spawn.mock.calls[1].slice(0, 2)).toEqual(['taskkill', ['/pid', '4242', '/T', '/F']]);
  });
});

describe('listCodexThreads', () => {
  it('follows nextCursor across pages', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread('a'), thread('b')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ data: [thread('c')], nextCursor: null });

    const sessions = await listCodexThreads(rpc, FOLDER);

    expect(sessions.map((s) => s.sessionId)).toEqual(['a', 'b', 'c']);
    expect(rpc.mock.calls[1]).toEqual([
      'thread/list',
      { cwd: [FOLDER], cursor: 'c2', limit: 50, useStateDbOnly: true },
    ]);
  });

  it(`stops at ${MAX_CODEX_THREADS} threads even when more pages exist`, async () => {
    let page = 0;
    const rpc = vi.fn(async () => {
      page += 1;
      return { data: Array.from({ length: 50 }, (_v, i) => thread(`t${page}-${i}`)), nextCursor: `p${page}` };
    });

    const sessions = await listCodexThreads(rpc, FOLDER);

    expect(sessions).toHaveLength(MAX_CODEX_THREADS);
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it('falls back to a full rollout scan when the state DB has no threads', async () => {
    const rpc = vi.fn(async (_method: string, params: unknown) =>
      (params as { useStateDbOnly: boolean }).useStateDbOnly ? { data: [] } : { data: [thread('scan')] }
    );

    const sessions = await listCodexThreads(rpc, FOLDER);

    expect(sessions.map((s) => s.sessionId)).toEqual(['scan']);
    expect(rpc.mock.calls.map((c) => (c[1] as { useStateDbOnly: boolean }).useStateDbOnly)).toEqual([true, false]);
  });

  it('skips the full scan when the state DB already has threads', async () => {
    const rpc = vi.fn(async () => ({ data: [thread('db')] }));

    await listCodexThreads(rpc, FOLDER);

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('maps Thread fields to an ExternalSession with ms timestamps', async () => {
    const rpc = vi.fn(async () => ({ data: [thread('a', { name: '  Named  ' })] }));

    const [session] = await listCodexThreads(rpc, FOLDER);

    expect(session).toEqual({
      backend: 'codex',
      sessionId: 'a',
      title: 'Named',
      cwd: FOLDER,
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      messageCount: 0,
    });
  });

  it('titles a thread from its preview, then a default', async () => {
    const preview = `Fix\n\nthe   tests ${'y'.repeat(100)}`;
    const rpc = vi.fn(async () => ({
      data: [thread('a', { name: '', preview }), thread('b', { name: null, preview: '   ' })],
    }));

    const sessions = await listCodexThreads(rpc, FOLDER);

    expect(sessions.map((s) => s.title)).toEqual([`Fix the tests ${'y'.repeat(100)}`.slice(0, 80), 'Codex session']);
  });

  it('drops threads without an id and survives a malformed page', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ name: 'no id' }, 'junk', thread('ok')], nextCursor: 'more' })
      .mockResolvedValueOnce(null);

    const sessions = await listCodexThreads(rpc, FOLDER);

    expect(sessions.map((s) => s.sessionId)).toEqual(['ok']);
  });

  it('propagates an rpc failure', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('rpc broke');
    });

    await expect(listCodexThreads(rpc, FOLDER)).rejects.toThrow('rpc broke');
  });
});

describe('codexThreadMessages', () => {
  it('keeps userMessage text parts and agentMessage text, ignoring other items', () => {
    const messages = codexThreadMessages({
      turns: [
        {
          startedAt: 10,
          completedAt: 20,
          items: [
            {
              type: 'userMessage',
              content: [
                { type: 'text', text: 'hi' },
                { type: 'image', url: 'x' },
              ],
            },
            { type: 'reasoning', text: 'secret thoughts' },
            { type: 'commandExecution', command: 'ls' },
            { type: 'agentMessage', text: ' hello back ' },
          ],
        },
      ],
    });

    expect(messages).toEqual([
      { role: 'user', text: 'hi', created_at: 10_000 },
      { role: 'assistant', text: 'hello back', created_at: 20_000 },
    ]);
  });

  it('joins several user text parts with a blank line', () => {
    const messages = codexThreadMessages({
      turns: [
        {
          items: [
            {
              type: 'userMessage',
              content: [
                { type: 'text', text: 'a' },
                { type: 'text', text: 'b' },
              ],
            },
          ],
        },
      ],
    });

    expect(messages[0].text).toBe('a\n\nb');
  });

  it('falls back to the thread createdAt when a turn has no times', () => {
    const messages = codexThreadMessages({
      createdAt: 5,
      turns: [{ items: [{ type: 'agentMessage', text: 'x' }] }],
    });

    expect(messages[0].created_at).toBe(5_000);
  });

  it('returns no messages for empty, blank or malformed turns', () => {
    const messages = codexThreadMessages({
      turns: [
        null,
        { items: 'nope' },
        {
          items: [
            { type: 'userMessage', content: [] },
            { type: 'agentMessage', text: ' ' },
          ],
        },
      ],
    });

    expect(messages).toEqual([]);
  });
});

describe('readCodexThread', () => {
  it('reads turns and counts the converted messages', async () => {
    const rpc = vi.fn(async () => ({
      thread: { id: 't1', cwd: FOLDER, turns: [{ items: [{ type: 'agentMessage', text: 'x' }] }] },
    }));

    const result = await readCodexThread(rpc, FOLDER, 't1', sameFolder);

    expect(rpc).toHaveBeenCalledWith('thread/read', { threadId: 't1', includeTurns: true });
    expect(result?.session.messageCount).toBe(1);
  });

  it('returns null for a thread recorded in another folder', async () => {
    const rpc = vi.fn(async () => ({ thread: { id: 't1', cwd: path.resolve('/elsewhere'), turns: [] } }));

    await expect(readCodexThread(rpc, FOLDER, 't1', sameFolder)).resolves.toBeNull();
  });

  it('returns null for an unknown thread or a response without one', async () => {
    await expect(
      readCodexThread(
        vi.fn(async () => null),
        FOLDER,
        't1',
        sameFolder
      )
    ).resolves.toBeNull();
    await expect(
      readCodexThread(
        vi.fn(async () => ({ thread: { cwd: FOLDER } })),
        FOLDER,
        't1',
        sameFolder
      )
    ).resolves.toBeNull();
  });
});
