/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads past Claude Code sessions from `~/.claude/projects/<dir>/<sessionId>.jsonl`.
 *
 * Line format (verified against Claude Code 2.1.300 transcripts): every line is
 * a JSON object with `type`, and most carry `sessionId`, `cwd` and `timestamp`.
 * `type: "user" | "assistant"` lines hold `message.content` as a string or an
 * array of parts (`text`, `thinking`, `tool_use`, `tool_result`, ...);
 * `type: "ai-title"` lines hold the generated title in `aiTitle` (the last one
 * wins).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { ExternalSession } from '@/common/types/agent/paviiData';
import { isRecord } from './engineApi';

/** Bytes read from one transcript at most. */
export const MAX_TRANSCRIPT_BYTES = 50 * 1024 * 1024;
const FALLBACK_TITLE_CHARS = 80;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ImportedMessage = { role: 'user' | 'assistant'; text: string; created_at: number };

/** Comparable form of a folder path: resolved, no trailing separator, case-folded on Windows. */
export function normalizeFolder(folder: string): string {
  // A Windows extended-length prefix (`\\?\C:\...`) names the same folder.
  let resolved = path.resolve(folder.replace(/^\\\\\?\\/, ''));
  const root = path.parse(resolved).root;
  while (resolved.length > root.length && /[\\/]$/.test(resolved)) resolved = resolved.slice(0, -1);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export const getClaudeProjectsDir = (): string => path.join(os.homedir(), '.claude', 'projects');

/** Claude's project directory name for a cwd: every non-alphanumeric character becomes `-`. */
const encodeProjectDir = (folder: string): string => path.resolve(folder).replace(/[^a-zA-Z0-9]/g, '-');

const parseTimestamp = (value: unknown): number => {
  if (typeof value !== 'string') return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * The visible text of one transcript line, or null when the line is not a
 * user/assistant text message (sidechains, meta lines, tool results, thinking
 * and tool calls are left out).
 */
export function claudeLineMessage(line: Record<string, unknown>): ImportedMessage | null {
  if (line.type !== 'user' && line.type !== 'assistant') return null;
  if (line.isSidechain === true || line.isMeta === true) return null;
  const message = line.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((part): part is { type: 'text'; text: string } => {
        return isRecord(part) && part.type === 'text' && typeof part.text === 'string';
      })
      .map((part) => part.text)
      .join('\n\n');
  }
  text = text.trim();
  if (!text) return null;
  return { role: line.type, text, created_at: parseTimestamp(line.timestamp) };
}

type ScanResult = { session: ExternalSession; messages: ImportedMessage[] };

/**
 * Stream one transcript. Stops at the first `cwd` that is not `folder`; returns
 * null for non-matching or unreadable files.
 */
async function scanTranscript(file: string, folder: string, keepMessages: boolean): Promise<ScanResult | null> {
  const wanted = normalizeFolder(folder);
  const stream = fs.createReadStream(file, { encoding: 'utf8', end: MAX_TRANSCRIPT_BYTES - 1 });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let cwdMatched = false;
  let sessionId = path.basename(file, '.jsonl');
  let title = '';
  let firstUserText = '';
  let startedAt = 0;
  let updatedAt = 0;
  let messageCount = 0;
  let lastAssistantId: string | undefined;
  const messages: ImportedMessage[] = [];
  try {
    for await (const raw of lines) {
      if (!raw.trim()) continue;
      let line: unknown;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isRecord(line)) continue;
      if (!cwdMatched) {
        if (typeof line.cwd !== 'string') continue;
        if (normalizeFolder(line.cwd) !== wanted) return null;
        cwdMatched = true;
      }
      if (typeof line.sessionId === 'string' && line.sessionId) sessionId = line.sessionId;
      const at = parseTimestamp(line.timestamp);
      if (at) {
        if (!startedAt) startedAt = at;
        updatedAt = at;
      }
      if (line.type === 'ai-title' && typeof line.aiTitle === 'string' && line.aiTitle.trim()) {
        title = line.aiTitle.trim();
        continue;
      }
      const message = claudeLineMessage(line);
      if (!message) continue;
      // One assistant reply is streamed as several lines sharing `message.id`.
      const messageId = isRecord(line.message) && typeof line.message.id === 'string' ? line.message.id : undefined;
      if (message.role === 'assistant' && messageId && messageId === lastAssistantId) {
        const last = messages[messages.length - 1];
        if (keepMessages && last) last.text = `${last.text}\n\n${message.text}`;
        continue;
      }
      lastAssistantId = message.role === 'assistant' ? messageId : undefined;
      if (message.role === 'user' && !firstUserText) firstUserText = message.text;
      messageCount += 1;
      if (keepMessages) messages.push(message);
    }
  } catch {
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }
  if (!cwdMatched) return null;
  const fallbackTitle = firstUserText.replace(/\s+/g, ' ').slice(0, FALLBACK_TITLE_CHARS);
  return {
    session: {
      backend: 'claude',
      sessionId,
      title: title || fallbackTitle || 'Claude session',
      cwd: folder,
      startedAt,
      updatedAt,
      messageCount,
    },
    messages,
  };
}

const listDir = async (dir: string): Promise<fs.Dirent[]> => {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * Project directories worth scanning for `folder`: the one Claude names after
 * the folder when it exists, otherwise all of them (the name is lossy, and
 * long paths are shortened).
 */
async function candidateProjectDirs(folder: string): Promise<string[]> {
  const root = getClaudeProjectsDir();
  const dirs = (await listDir(root)).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const encoded = encodeProjectDir(folder).toLowerCase();
  const exact = dirs.filter((name) => name.toLowerCase() === encoded);
  return (exact.length > 0 ? exact : dirs).map((name) => path.join(root, name));
}

/** Claude Code sessions recorded with `cwd` equal to `folder`, newest first. */
export async function listClaudeSessions(folder: string): Promise<ExternalSession[]> {
  const sessions: ExternalSession[] = [];
  for (const dir of await candidateProjectDirs(folder)) {
    for (const entry of await listDir(dir)) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const result = await scanTranscript(path.join(dir, entry.name), folder, false);
      if (result && result.session.messageCount > 0) sessions.push(result.session);
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One Claude session and its user/assistant text messages, or null when not found for `folder`. */
export async function readClaudeSession(folder: string, sessionId: string): Promise<ScanResult | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;
  for (const dir of await candidateProjectDirs(folder)) {
    const file = path.join(dir, `${sessionId}.jsonl`);
    try {
      if (!(await fs.promises.stat(file)).isFile()) continue;
    } catch {
      continue;
    }
    const result = await scanTranscript(file, folder, true);
    if (result) return result;
  }
  return null;
}
