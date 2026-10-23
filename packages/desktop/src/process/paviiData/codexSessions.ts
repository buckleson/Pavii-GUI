/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads past Codex threads through `codex app-server` (newline-delimited
 * JSON-RPC over stdio). Wire shapes follow the app-server schema generated
 * from codex-cli 0.147 (`ClientRequest.json`, `ClientNotification.json`,
 * `codex_app_server_protocol.v2.schemas.json`):
 *
 * - `initialize` (InitializeParams: `clientInfo`, `capabilities`), then the
 *   `initialized` notification (ClientNotification / InitializedNotification),
 *   matching the engine's handshake in `aionui-session/src/backend/codex_conn.rs`.
 * - `thread/list` (ThreadListParams: `cwd` filter, `cursor`, `limit`) →
 *   ThreadListResponse `{ data: Thread[], nextCursor }`.
 * - `thread/read` (ThreadReadParams: `threadId`, `includeTurns`) →
 *   ThreadReadResponse `{ thread: Thread }` with `thread.turns: Turn[]`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type { ExternalSession } from '@/common/types/agent/paviiData';
import type { ImportedMessage } from './claudeSessions';
import { asArray, isRecord } from './engineApi';

export const CODEX_TIMEOUT_MS = 30_000;
export const MAX_CODEX_THREADS = 200;
const PAGE_SIZE = 50;

type Rpc = (method: string, params: unknown) => Promise<unknown>;

/** Spawn `codex app-server`; Windows `.cmd`/`.bat` shims need `cmd.exe`. */
function spawnAppServer(binary: string): ChildProcessWithoutNullStreams {
  const isShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary);
  if (isShim) {
    return spawn('cmd.exe', ['/d', '/s', '/c', `""${binary}" app-server"`], {
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(binary, ['app-server'], { windowsHide: true });
}

/** Kill the app-server and, on Windows, the process tree behind a `cmd.exe` shim. */
function killTree(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
    return;
  }
  child.kill();
}

/**
 * Run `work` against a fresh app-server connection, then kill the process.
 * Rejects on spawn failure, early exit, a JSON-RPC error, or after
 * {@link CODEX_TIMEOUT_MS}.
 */
export async function withCodexAppServer<T>(binary: string, work: (rpc: Rpc) => Promise<T>): Promise<T> {
  const child = spawnAppServer(binary);
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let failure: Error | undefined;
  const failAll = (error: Error): void => {
    failure ??= error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  child.on('error', (error) => failAll(error));
  child.on('exit', (code) => failAll(new Error(`codex app-server exited (${code ?? 'signal'})`)));
  child.stderr.resume();
  // A dead process turns writes into EPIPE; the exit/error handlers already fail the calls.
  child.stdin.on('error', () => {});
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.id !== 'number' || 'method' in message) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (isRecord(message.error)) {
      entry.reject(new Error(typeof message.error.message === 'string' ? message.error.message : 'JSON-RPC error'));
    } else {
      entry.resolve(message.result);
    }
  });

  const write = (frame: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
  };
  const rpc: Rpc = (method, params) =>
    new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      write({ id, method, params });
    });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('codex app-server timed out');
      // Settle in-flight requests too, even if killing the process fails.
      failAll(error);
      reject(error);
    }, CODEX_TIMEOUT_MS);
  });
  try {
    const run = async (): Promise<T> => {
      await rpc('initialize', {
        clientInfo: { name: 'pavii-desktop', version: '1.0.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      write({ method: 'initialized' });
      return work(rpc);
    };
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    lines.close();
    child.stdin.destroy();
    killTree(child);
  }
}

const secondsToMs = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value * 1000 : 0;

/** Thread (v2 schema) → ExternalSession; `messageCount` is unknown without reading turns. */
function threadToSession(thread: Record<string, unknown>, folder: string): ExternalSession | null {
  if (typeof thread.id !== 'string' || !thread.id) return null;
  const name = typeof thread.name === 'string' ? thread.name.trim() : '';
  const preview = typeof thread.preview === 'string' ? thread.preview.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return {
    backend: 'codex',
    sessionId: thread.id,
    title: name || preview || 'Codex session',
    cwd: folder,
    startedAt: secondsToMs(thread.createdAt),
    updatedAt: secondsToMs(thread.updatedAt),
    messageCount: 0,
  };
}

async function listThreadPages(rpc: Rpc, folder: string, useStateDbOnly: boolean): Promise<ExternalSession[]> {
  const sessions: ExternalSession[] = [];
  let cursor: string | null = null;
  do {
    const page: unknown = await rpc('thread/list', { cwd: [folder], cursor, limit: PAGE_SIZE, useStateDbOnly });
    if (!isRecord(page)) break;
    for (const thread of asArray(page.data)) {
      const session = isRecord(thread) ? threadToSession(thread, folder) : null;
      if (session) sessions.push(session);
      if (sessions.length >= MAX_CODEX_THREADS) return sessions;
    }
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
  } while (cursor);
  return sessions;
}

/**
 * Threads whose session cwd matches `folder` (ThreadListParams.cwd), newest
 * first, at most {@link MAX_CODEX_THREADS}. Reads codex's state DB first
 * (ThreadListParams.useStateDbOnly: milliseconds instead of a rollout scan
 * that took ~13 s on a real profile) and only scans rollouts when the DB has
 * nothing for the folder.
 */
export async function listCodexThreads(rpc: Rpc, folder: string): Promise<ExternalSession[]> {
  const fromStateDb = await listThreadPages(rpc, folder, true);
  return fromStateDb.length > 0 ? fromStateDb : listThreadPages(rpc, folder, false);
}

/** Visible text of a UserMessageThreadItem: its `text` UserInput parts. */
const userItemText = (item: Record<string, unknown>): string =>
  asArray(item.content)
    .filter((input): input is { type: 'text'; text: string } => {
      return isRecord(input) && input.type === 'text' && typeof input.text === 'string';
    })
    .map((input) => input.text)
    .join('\n\n')
    .trim();

/**
 * User/assistant text from Thread.turns: Turn.items holds ThreadItem values;
 * only `userMessage` (UserMessageThreadItem) and `agentMessage`
 * (AgentMessageThreadItem.text) carry chat text. Reasoning, plans, commands,
 * file changes and tool calls are left out.
 */
export function codexThreadMessages(thread: Record<string, unknown>): ImportedMessage[] {
  const messages: ImportedMessage[] = [];
  const fallbackAt = secondsToMs(thread.createdAt);
  for (const turn of asArray(thread.turns)) {
    if (!isRecord(turn)) continue;
    const startedAt = secondsToMs(turn.startedAt) || fallbackAt;
    const completedAt = secondsToMs(turn.completedAt) || startedAt;
    for (const item of asArray(turn.items)) {
      if (!isRecord(item)) continue;
      if (item.type === 'userMessage') {
        const text = userItemText(item);
        if (text) messages.push({ role: 'user', text, created_at: startedAt });
      } else if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
        messages.push({ role: 'assistant', text: item.text.trim(), created_at: completedAt });
      }
    }
  }
  return messages;
}

/** `thread/read` with turns; null when the thread is unknown or recorded in another folder. */
export async function readCodexThread(
  rpc: Rpc,
  folder: string,
  threadId: string,
  sameFolder: (a: string, b: string) => boolean
): Promise<{ session: ExternalSession; messages: ImportedMessage[] } | null> {
  const response: unknown = await rpc('thread/read', { threadId, includeTurns: true });
  if (!isRecord(response) || !isRecord(response.thread)) return null;
  const thread = response.thread;
  if (typeof thread.cwd === 'string' && !sameFolder(thread.cwd, folder)) return null;
  const session = threadToSession(thread, folder);
  if (!session) return null;
  const messages = codexThreadMessages(thread);
  return { session: { ...session, messageCount: messages.length }, messages };
}
