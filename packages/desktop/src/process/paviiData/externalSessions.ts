/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Past Claude Code / Codex sessions for a folder, and importing one into a
 * Pavii conversation (create → import messages → bind the CLI session id so
 * the next turn resumes it).
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ExternalSession,
  ExternalSessionList,
  ImportExternalSessionResult,
  PaviiSessionEntry,
} from '@/common/types/agent/paviiData';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { listClaudeSessions, normalizeFolder, readClaudeSession, type ImportedMessage } from './claudeSessions';
import { listCodexThreads, readCodexThread, withCodexAppServer } from './codexSessions';
import { asArray, describeError, engine, isRecord } from './engineApi';

type Backend = 'claude' | 'codex';

/** Builtin agent ids in the engine catalog. */
export const BUILTIN_AGENT_IDS: Record<Backend, string> = { claude: '2d23ff1c', codex: '8e1acf31' };
const IMPORT_SOURCE: Record<Backend, 'claude-import' | 'codex-import'> = {
  claude: 'claude-import',
  codex: 'codex-import',
};

const sameFolder = (a: string, b: string): boolean => normalizeFolder(a) === normalizeFolder(b);

/** Entries of `<folder>/.pavii/sessions.json`; empty when missing or malformed. */
export async function readPaviiSessions(folder: string): Promise<PaviiSessionEntry[]> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(path.join(folder, '.pavii', 'sessions.json'), 'utf8'));
    if (!isRecord(raw) || raw.version !== 1) return [];
    return asArray(raw.sessions).filter(
      (entry): entry is PaviiSessionEntry => isRecord(entry) && typeof entry.conversationId === 'string'
    );
  } catch {
    return [];
  }
}

const findCodexBinary = async (): Promise<string | undefined> =>
  (await import('../agentCli/cliUpdateService')).findBinary('codex');

/** Every past session recorded for `folder`, newest first; unreadable sources go to `unavailable`. */
export async function listExternalSessions(folder: string): Promise<ExternalSessionList> {
  const unavailable: ExternalSessionList['unavailable'] = [];
  const [claude, codex, paviiSessions] = await Promise.all([
    listClaudeSessions(folder).catch((error: unknown): ExternalSession[] => {
      unavailable.push({ backend: 'claude', reason: describeError(error) });
      return [];
    }),
    (async (): Promise<ExternalSession[]> => {
      try {
        const binary = await findCodexBinary();
        if (!binary) {
          unavailable.push({ backend: 'codex', reason: 'codex is not installed' });
          return [];
        }
        return await withCodexAppServer(binary, (rpc) => listCodexThreads(rpc, folder));
      } catch (error) {
        unavailable.push({ backend: 'codex', reason: describeError(error) });
        return [];
      }
    })(),
    readPaviiSessions(folder),
  ]);

  const imported = new Map<string, string>();
  for (const entry of paviiSessions) {
    const backend = entryBackend(entry);
    if (entry.backendSessionId && backend) imported.set(`${backend}:${entry.backendSessionId}`, entry.conversationId);
  }
  const sessions = [...claude, ...codex]
    .map((session) => {
      const conversationId = imported.get(`${session.backend}:${session.sessionId}`);
      return conversationId ? { ...session, conversationId } : session;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { sessions, unavailable, paviiSessions };
}

/** Which CLI an index entry belongs to: its backend, or the import source when the backend is unknown. */
function entryBackend(entry: PaviiSessionEntry): Backend | null {
  if (entry.backend === 'claude' || entry.source === 'claude-import') return 'claude';
  if (entry.backend === 'codex' || entry.source === 'codex-import') return 'codex';
  return null;
}

type ReadResult = { session: ExternalSession; messages: ImportedMessage[] } | null;

async function readSession(folder: string, backend: Backend, sessionId: string): Promise<ReadResult> {
  if (backend === 'claude') return readClaudeSession(folder, sessionId);
  const binary = await findCodexBinary();
  if (!binary) throw new Error('codex is not installed');
  return withCodexAppServer(binary, (rpc) => readCodexThread(rpc, folder, sessionId, sameFolder));
}

/**
 * The assistant that wraps a builtin agent: the engine generates one per
 * agent (`source: 'generated'`, id `bare:<agentId>`). Null when the agent's
 * CLI is missing on this machine.
 */
async function resolveAgentAssistant(agentId: string): Promise<string | null> {
  const assistants = asArray(await engine.get<unknown>('/api/assistants')).filter(isRecord);
  const match =
    assistants.find((a) => a.source === 'generated' && a.agent_id === agentId) ??
    assistants.find((a) => a.agent_id === agentId);
  if (!match) return `bare:${agentId}`;
  if (match.agent_status === 'missing') return null;
  return typeof match.id === 'string' ? match.id : `bare:${agentId}`;
}

/** Import one past session as a new conversation bound to the CLI session. */
export async function importExternalSession(params: {
  folder: string;
  backend: Backend;
  sessionId: string;
}): Promise<ImportExternalSessionResult> {
  const { folder, backend, sessionId } = params;
  if (backend !== 'claude' && backend !== 'codex') return { success: false, error: 'not-found' };

  const existing = (await readPaviiSessions(folder)).find(
    (entry) => entry.backendSessionId === sessionId && entryBackend(entry) === backend
  );
  if (existing) return { success: true, conversationId: existing.conversationId, importedMessages: 0 };

  let found: ReadResult;
  try {
    found = await readSession(folder, backend, sessionId);
  } catch (error) {
    return { success: false, error: 'read-failed', message: describeError(error) };
  }
  if (!found) return { success: false, error: 'not-found' };

  let assistantId: string | null;
  try {
    assistantId = await resolveAgentAssistant(BUILTIN_AGENT_IDS[backend]);
  } catch (error) {
    return { success: false, error: 'import-failed', message: describeError(error) };
  }
  if (!assistantId) return { success: false, error: 'agent-unavailable' };

  let conversationId: string;
  try {
    const created = await engine.post<unknown>('/api/conversations', {
      name: found.session.title,
      assistant: { id: assistantId },
      extra: { workspace: folder, custom_workspace: true, import_source: IMPORT_SOURCE[backend] },
    });
    if (!isRecord(created) || typeof created.id !== 'string') {
      return { success: false, error: 'import-failed', message: 'engine returned no conversation id' };
    }
    conversationId = created.id;
  } catch (error) {
    const agentRejected = isBackendHttpError(error) && error.status === 400 && /agent/i.test(error.backendMessage);
    return {
      success: false,
      error: agentRejected ? 'agent-unavailable' : 'import-failed',
      message: describeError(error),
    };
  }

  try {
    const base = `/api/conversations/${encodeURIComponent(conversationId)}`;
    const result = await engine.post<unknown>(`${base}/messages/import`, { messages: found.messages });
    const importedMessages =
      isRecord(result) && typeof result.imported === 'number' ? result.imported : found.messages.length;
    await engine.put<unknown>(`${base}/backend-session`, { session_id: sessionId });
    return { success: true, conversationId, importedMessages };
  } catch (error) {
    await engine
      .delete<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}`)
      .catch((): void => undefined);
    return { success: false, error: 'import-failed', message: describeError(error) };
  }
}
