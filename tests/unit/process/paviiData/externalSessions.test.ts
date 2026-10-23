/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Past-session listing (Claude + Codex + `.pavii/sessions.json`) and the
 * import flow: create conversation → import messages → bind backend session.
 */

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpRequest, readFile, claude, codex, findBinary } = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  readFile: vi.fn(),
  claude: { listClaudeSessions: vi.fn(), readClaudeSession: vi.fn() },
  codex: { listCodexThreads: vi.fn(), readCodexThread: vi.fn(), withCodexAppServer: vi.fn() },
  findBinary: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpRequest,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const fake = { ...actual, promises: { ...actual.promises, readFile } };
  return { ...fake, default: fake };
});
vi.mock('@process/paviiData/claudeSessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@process/paviiData/claudeSessions')>()),
  ...claude,
}));
vi.mock('@process/paviiData/codexSessions', () => codex);
vi.mock('@process/agentCli/cliUpdateService', () => ({ findBinary }));

import { BackendHttpError } from '@/common/adapter/httpBridge';
import {
  BUILTIN_AGENT_IDS,
  importExternalSession,
  listExternalSessions,
  readPaviiSessions,
} from '@process/paviiData/externalSessions';

const FOLDER = path.resolve('/work/demo');
const session = (backend: 'claude' | 'codex', sessionId: string, updatedAt: number) => ({
  backend,
  sessionId,
  title: `${backend} ${sessionId}`,
  cwd: FOLDER,
  startedAt: 1,
  updatedAt,
  messageCount: 2,
});
const MESSAGES = [
  { role: 'user', text: 'hi', created_at: 1 },
  { role: 'assistant', text: 'hello', created_at: 2 },
];
const paviiFile = (sessions: unknown[]) => JSON.stringify({ version: 1, sessions });
const entry = (conversationId: string, backendSessionId: string | null) => ({
  conversationId,
  title: 't',
  agentId: null as string | null,
  backend: 'claude',
  backendSessionId,
  source: 'claude-import',
  createdAt: 1,
  lastActiveAt: 1,
});

type Route = (body: unknown) => unknown;
let routes: Record<string, Route>;
const calls = () => httpRequest.mock.calls.map(([method, url]) => `${method} ${url}`);

beforeEach(() => {
  vi.clearAllMocks();
  readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  claude.listClaudeSessions.mockResolvedValue([]);
  claude.readClaudeSession.mockResolvedValue({ session: session('claude', 's1', 5), messages: MESSAGES });
  codex.withCodexAppServer.mockImplementation((_binary: string, work: (rpc: unknown) => unknown) => work('rpc'));
  codex.listCodexThreads.mockResolvedValue([]);
  findBinary.mockReturnValue('/usr/bin/codex');
  routes = {
    'GET /api/assistants': () => [
      { id: 'user-asst', source: 'user', agent_id: BUILTIN_AGENT_IDS.claude },
      { id: 'gen-claude', source: 'generated', agent_id: BUILTIN_AGENT_IDS.claude, agent_status: 'ok' },
    ],
    'POST /api/conversations': () => ({ id: 'conv-1' }),
    'POST /api/conversations/conv-1/messages/import': () => ({ imported: 2 }),
    'PUT /api/conversations/conv-1/backend-session': () => undefined,
    'DELETE /api/conversations/conv-1': () => undefined,
  };
  httpRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    return route(body);
  });
});

describe('readPaviiSessions', () => {
  it('reads entries from <folder>/.pavii/sessions.json', async () => {
    readFile.mockResolvedValue(paviiFile([entry('c1', 's1'), { title: 'no id' }]));

    const entries = await readPaviiSessions(FOLDER);

    expect(readFile).toHaveBeenCalledWith(path.join(FOLDER, '.pavii', 'sessions.json'), 'utf8');
    expect(entries.map((e) => e.conversationId)).toEqual(['c1']);
  });

  it('returns an empty list for malformed JSON or another version', async () => {
    readFile.mockResolvedValueOnce('{oops');
    await expect(readPaviiSessions(FOLDER)).resolves.toEqual([]);

    readFile.mockResolvedValueOnce(JSON.stringify({ version: 2, sessions: [entry('c1', 's1')] }));
    await expect(readPaviiSessions(FOLDER)).resolves.toEqual([]);
  });
});

describe('listExternalSessions', () => {
  it('merges Claude and Codex sessions newest first', async () => {
    claude.listClaudeSessions.mockResolvedValue([session('claude', 'c-old', 10)]);
    codex.listCodexThreads.mockResolvedValue([session('codex', 'x-new', 20)]);

    const result = await listExternalSessions(FOLDER);

    expect(result.sessions.map((s) => s.sessionId)).toEqual(['x-new', 'c-old']);
  });

  it('marks sessions already imported through .pavii/sessions.json', async () => {
    claude.listClaudeSessions.mockResolvedValue([session('claude', 's1', 10), session('claude', 's2', 5)]);
    readFile.mockResolvedValue(paviiFile([entry('conv-9', 's1'), entry('conv-8', null)]));

    const result = await listExternalSessions(FOLDER);

    expect(result.sessions.map((s) => s.conversationId)).toEqual(['conv-9', undefined]);
    expect(result.paviiSessions).toHaveLength(2);
  });

  it('does not mark a Codex session imported when only a Claude entry has its id', async () => {
    codex.listCodexThreads.mockResolvedValue([session('codex', 'shared', 10)]);
    readFile.mockResolvedValue(paviiFile([entry('conv-claude', 'shared')]));

    const result = await listExternalSessions(FOLDER);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].conversationId).toBeUndefined();
  });

  it('counts an entry with a null backend but codex-import source for codex', async () => {
    codex.listCodexThreads.mockResolvedValue([session('codex', 't9', 10)]);
    claude.listClaudeSessions.mockResolvedValue([session('claude', 't9', 5)]);
    readFile.mockResolvedValue(paviiFile([{ ...entry('conv-codex', 't9'), backend: null, source: 'codex-import' }]));

    const result = await listExternalSessions(FOLDER);

    expect(result.sessions.map((s) => [s.backend, s.conversationId])).toEqual([
      ['codex', 'conv-codex'],
      ['claude', undefined],
    ]);
  });

  it('reports codex as unavailable when it is not installed', async () => {
    findBinary.mockReturnValue(undefined);
    claude.listClaudeSessions.mockResolvedValue([session('claude', 's1', 10)]);

    const result = await listExternalSessions(FOLDER);

    expect(result.unavailable).toEqual([{ backend: 'codex', reason: 'codex is not installed' }]);
    expect(result.sessions).toHaveLength(1);
  });

  it('reports a failing app-server as unavailable instead of throwing', async () => {
    codex.withCodexAppServer.mockRejectedValue(new Error('codex app-server timed out'));

    const result = await listExternalSessions(FOLDER);

    expect(result.unavailable).toEqual([{ backend: 'codex', reason: 'codex app-server timed out' }]);
  });

  it('reports a failing Claude scan as unavailable', async () => {
    claude.listClaudeSessions.mockRejectedValue(new Error('EACCES'));

    const result = await listExternalSessions(FOLDER);

    expect(result.unavailable).toEqual([{ backend: 'claude', reason: 'EACCES' }]);
  });
});

describe('importExternalSession', () => {
  const importClaude = () => importExternalSession({ folder: FOLDER, backend: 'claude', sessionId: 's1' });

  it('returns the existing conversation without creating a new one', async () => {
    readFile.mockResolvedValue(paviiFile([entry('conv-existing', 's1')]));

    const result = await importClaude();

    expect(result).toEqual({ success: true, conversationId: 'conv-existing', importedMessages: 0 });
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('creates the conversation, imports messages, then binds the backend session', async () => {
    const result = await importClaude();

    expect(result).toEqual({ success: true, conversationId: 'conv-1', importedMessages: 2 });
    expect(calls()).toEqual([
      'GET /api/assistants',
      'POST /api/conversations',
      'POST /api/conversations/conv-1/messages/import',
      'PUT /api/conversations/conv-1/backend-session',
    ]);
  });

  it('creates the conversation in the folder with the generated assistant and import source', async () => {
    await importClaude();

    expect(httpRequest).toHaveBeenCalledWith('POST', '/api/conversations', {
      name: 'claude s1',
      assistant: { id: 'gen-claude' },
      extra: { workspace: FOLDER, custom_workspace: true, import_source: 'claude-import' },
    });
  });

  it('sends the messages and the CLI session id', async () => {
    await importClaude();

    expect(httpRequest).toHaveBeenCalledWith('POST', '/api/conversations/conv-1/messages/import', {
      messages: MESSAGES,
    });
    expect(httpRequest).toHaveBeenCalledWith('PUT', '/api/conversations/conv-1/backend-session', {
      session_id: 's1',
    });
  });

  it("falls back to 'bare:<agentId>' when no assistant wraps the agent", async () => {
    routes['GET /api/assistants'] = () => [];

    await importClaude();

    expect(httpRequest.mock.calls[1][2]).toMatchObject({ assistant: { id: `bare:${BUILTIN_AGENT_IDS.claude}` } });
  });

  it('imports a Codex thread with codex-import and the Codex agent', async () => {
    codex.readCodexThread.mockResolvedValue({ session: session('codex', 't1', 5), messages: MESSAGES });
    routes['GET /api/assistants'] = () => [{ id: 'gen-codex', source: 'generated', agent_id: BUILTIN_AGENT_IDS.codex }];

    await importExternalSession({ folder: FOLDER, backend: 'codex', sessionId: 't1' });

    expect(httpRequest.mock.calls[1][2]).toMatchObject({
      assistant: { id: 'gen-codex' },
      extra: { import_source: 'codex-import' },
    });
  });

  it('creates a new Codex conversation when the id only matches a Claude entry', async () => {
    readFile.mockResolvedValue(paviiFile([entry('conv-claude', 't1')]));
    codex.readCodexThread.mockResolvedValue({ session: session('codex', 't1', 5), messages: MESSAGES });

    const result = await importExternalSession({ folder: FOLDER, backend: 'codex', sessionId: 't1' });

    expect(result).toEqual({ success: true, conversationId: 'conv-1', importedMessages: 2 });
    expect(calls()).toContain('POST /api/conversations');
  });

  it('returns the existing Codex conversation for a null-backend codex-import entry', async () => {
    readFile.mockResolvedValue(paviiFile([{ ...entry('conv-codex', 't1'), backend: null, source: 'codex-import' }]));

    const result = await importExternalSession({ folder: FOLDER, backend: 'codex', sessionId: 't1' });

    expect(result).toEqual({ success: true, conversationId: 'conv-codex', importedMessages: 0 });
    expect(httpRequest).not.toHaveBeenCalled();
    expect(codex.withCodexAppServer).not.toHaveBeenCalled();
  });

  it('returns agent-unavailable when the agent CLI is missing', async () => {
    routes['GET /api/assistants'] = () => [
      { id: 'gen-claude', source: 'generated', agent_id: BUILTIN_AGENT_IDS.claude, agent_status: 'missing' },
    ];

    const result = await importClaude();

    expect(result).toEqual({ success: false, error: 'agent-unavailable' });
    expect(calls()).not.toContain('POST /api/conversations');
  });

  it('returns agent-unavailable when the engine rejects the agent on create', async () => {
    routes['POST /api/conversations'] = () => {
      throw new BackendHttpError({
        method: 'POST',
        path: '/api/conversations',
        status: 400,
        body: { error: 'agent not available' },
      });
    };

    const result = await importClaude();

    expect(result).toMatchObject({ success: false, error: 'agent-unavailable' });
  });

  it('deletes the created conversation when importing messages fails', async () => {
    routes['POST /api/conversations/conv-1/messages/import'] = () => {
      throw new Error('import exploded');
    };

    const result = await importClaude();

    expect(result).toEqual({ success: false, error: 'import-failed', message: 'import exploded' });
    expect(calls()).toContain('DELETE /api/conversations/conv-1');
    expect(calls()).not.toContain('PUT /api/conversations/conv-1/backend-session');
  });

  it('still reports import-failed when the cleanup delete also fails', async () => {
    routes['PUT /api/conversations/conv-1/backend-session'] = () => {
      throw new Error('bind failed');
    };
    routes['DELETE /api/conversations/conv-1'] = () => {
      throw new Error('delete failed');
    };

    await expect(importClaude()).resolves.toMatchObject({ success: false, error: 'import-failed' });
  });

  it('returns import-failed when the engine returns no conversation id', async () => {
    routes['POST /api/conversations'] = () => ({});

    await expect(importClaude()).resolves.toMatchObject({ success: false, error: 'import-failed' });
  });

  it('returns not-found when the session does not exist for the folder', async () => {
    claude.readClaudeSession.mockResolvedValue(null);

    await expect(importClaude()).resolves.toEqual({ success: false, error: 'not-found' });
  });

  it('returns read-failed when reading the session throws', async () => {
    claude.readClaudeSession.mockRejectedValue(new Error('disk gone'));

    await expect(importClaude()).resolves.toEqual({ success: false, error: 'read-failed', message: 'disk gone' });
  });

  it('returns read-failed for a Codex import when codex is not installed', async () => {
    findBinary.mockReturnValue(undefined);

    const result = await importExternalSession({ folder: FOLDER, backend: 'codex', sessionId: 't1' });

    expect(result).toEqual({ success: false, error: 'read-failed', message: 'codex is not installed' });
  });

  it('returns not-found for an unknown backend', async () => {
    const result = await importExternalSession({
      folder: FOLDER,
      backend: 'gemini' as unknown as 'claude',
      sessionId: 's1',
    });

    expect(result).toEqual({ success: false, error: 'not-found' });
  });
});
