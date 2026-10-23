/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Claude Code transcript reader: folder matching, titles, message extraction
 * and session id validation, over an in-memory `~/.claude/projects` tree.
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { files, unreadable, state } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  unreadable: new Set<string>(),
  state: { home: '' },
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const fake = { ...actual, homedir: () => state.home };
  return { ...fake, default: fake };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const nodePath = await import('node:path');
  const { Readable } = await import('node:stream');
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  const dirent = (name: string, isDir: boolean) => ({ name, isFile: () => !isDir, isDirectory: () => isDir });
  const readdir = async (dir: string) => {
    const entries = new Map<string, boolean>();
    for (const key of files.keys()) {
      if (!key.startsWith(dir + nodePath.sep)) continue;
      const [first, ...rest] = key.slice(dir.length + 1).split(nodePath.sep);
      entries.set(first, rest.length > 0 || entries.get(first) === true);
    }
    if (entries.size === 0) throw enoent(dir);
    return [...entries].map(([name, isDir]) => dirent(name, isDir));
  };
  const stat = async (p: string) => {
    if (files.has(p)) return { isFile: () => true };
    throw enoent(p);
  };
  const createReadStream = (p: string) => {
    if (!files.has(p) || unreadable.has(p)) {
      return new Readable({
        read() {
          this.destroy(enoent(p));
        },
      });
    }
    return Readable.from([files.get(p) as string]);
  };
  const fake = { ...actual, createReadStream, promises: { ...actual.promises, readdir, stat } };
  return { ...fake, default: fake };
});

import {
  claudeLineMessage,
  getClaudeProjectsDir,
  listClaudeSessions,
  normalizeFolder,
  readClaudeSession,
} from '@process/paviiData/claudeSessions';

const FOLDER = path.resolve('/work/demo');
const OTHER_FOLDER = path.resolve('/work/other');
const HOME = path.resolve('/home/tester');
const originalPlatform = process.platform;

const projectsDir = () => path.join(HOME, '.claude', 'projects');
const encodedDir = (folder: string) => path.resolve(folder).replace(/[^a-zA-Z0-9]/g, '-');
const addFile = (dir: string, name: string, lines: unknown[]) => {
  files.set(path.join(projectsDir(), dir, name), lines.map((l) => JSON.stringify(l)).join('\n'));
};
const userLine = (text: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  sessionId: 'sess-1',
  cwd: FOLDER,
  timestamp: '2026-01-01T00:00:00.000Z',
  message: { role: 'user', content: text },
  ...extra,
});
const assistantLine = (text: string, extra: Record<string, unknown> = {}) => ({
  type: 'assistant',
  sessionId: 'sess-1',
  cwd: FOLDER,
  timestamp: '2026-01-01T00:00:01.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  ...extra,
});

const loadFixture = async (): Promise<string> => {
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
  const raw = actualFs.readFileSync(
    path.resolve(__dirname, '../../../fixtures/paviiData/claude-session.jsonl'),
    'utf8'
  );
  return raw.replaceAll('__CWD__', JSON.stringify(FOLDER).slice(1, -1));
};

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

beforeEach(() => {
  files.clear();
  unreadable.clear();
  state.home = HOME;
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('normalizeFolder', () => {
  it('drops a trailing separator', () => {
    expect(normalizeFolder(FOLDER + path.sep)).toBe(normalizeFolder(FOLDER));
  });

  it('compares case-insensitively on Windows', () => {
    setPlatform('win32');

    expect(normalizeFolder(FOLDER.toUpperCase())).toBe(normalizeFolder(FOLDER.toLowerCase()));
  });

  it('keeps case on other platforms', () => {
    setPlatform('linux');

    expect(normalizeFolder(path.resolve('/Work/Demo'))).not.toBe(normalizeFolder(path.resolve('/work/demo')));
  });

  it('treats a Windows extended-length prefix as the same folder', () => {
    expect(normalizeFolder(`\\\\?\\${FOLDER}`)).toBe(normalizeFolder(FOLDER));
  });

  it('never strips the filesystem root itself', () => {
    const root = path.parse(FOLDER).root;

    expect(normalizeFolder(root).length).toBeGreaterThan(0);
  });
});

describe('claudeLineMessage', () => {
  it('joins only the text parts of an assistant message', () => {
    const line = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hidden' },
          { type: 'text', text: 'one' },
          { type: 'tool_use', id: 't', name: 'Read', input: {} },
          { type: 'text', text: 'two' },
        ],
      },
    };

    expect(claudeLineMessage(line)?.text).toBe('one\n\ntwo');
  });

  it('returns null for a tool_result-only user line', () => {
    expect(claudeLineMessage(userLine([{ type: 'tool_result', content: 'ok' }]))).toBeNull();
  });

  it('returns null for sidechain and meta lines', () => {
    expect(claudeLineMessage(userLine('x', { isSidechain: true }))).toBeNull();
    expect(claudeLineMessage(userLine('x', { isMeta: true }))).toBeNull();
  });

  it('returns null for whitespace-only text and non-message lines', () => {
    expect(claudeLineMessage(userLine('   '))).toBeNull();
    expect(claudeLineMessage({ type: 'system', message: { content: 'x' } })).toBeNull();
    expect(claudeLineMessage({ type: 'user', message: 'not a record' })).toBeNull();
  });

  it('parses the timestamp and falls back to 0 when it is invalid', () => {
    expect(claudeLineMessage(userLine('hi'))?.created_at).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(claudeLineMessage(userLine('hi', { timestamp: 'nope' }))?.created_at).toBe(0);
  });
});

describe('getClaudeProjectsDir', () => {
  it('points at ~/.claude/projects', () => {
    expect(getClaudeProjectsDir()).toBe(path.join(HOME, '.claude', 'projects'));
  });
});

describe('readClaudeSession', () => {
  it('extracts user and assistant text, merging parts that share message.id', async () => {
    files.set(path.join(projectsDir(), 'proj', 'sess-alpha.jsonl'), await loadFixture());

    const result = await readClaudeSession(FOLDER, 'sess-alpha');

    expect(result?.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Please add a greeting helper'],
      ['assistant', 'Sure, adding it now.\n\nDone.'],
      ['user', 'Thanks'],
    ]);
  });

  it('uses the last ai-title and counts merged replies once', async () => {
    files.set(path.join(projectsDir(), 'proj', 'sess-alpha.jsonl'), await loadFixture());

    const result = await readClaudeSession(FOLDER, 'sess-alpha');

    expect(result?.session.title).toBe('Greeting helper');
    expect(result?.session.messageCount).toBe(3);
  });

  it('records the first and last timestamps as startedAt and updatedAt', async () => {
    files.set(path.join(projectsDir(), 'proj', 'sess-alpha.jsonl'), await loadFixture());

    const result = await readClaudeSession(FOLDER, 'sess-alpha');

    expect(result?.session.startedAt).toBe(Date.parse('2026-01-02T10:00:00.000Z'));
    expect(result?.session.updatedAt).toBe(Date.parse('2026-01-02T10:05:00.000Z'));
  });

  it('keeps separate assistant replies with different message ids apart', async () => {
    addFile('proj', 'sess-1.jsonl', [
      userLine('q'),
      assistantLine('a1', { message: { id: 'm1', content: [{ type: 'text', text: 'a1' }] } }),
      assistantLine('a2', { message: { id: 'm2', content: [{ type: 'text', text: 'a2' }] } }),
    ]);

    const result = await readClaudeSession(FOLDER, 'sess-1');

    expect(result?.messages.map((m) => m.text)).toEqual(['q', 'a1', 'a2']);
  });

  it('falls back to the first user text, whitespace-collapsed and truncated to 80 chars', async () => {
    const long = `Fix   the\nbuild ${'x'.repeat(200)}`;
    addFile('proj', 'sess-1.jsonl', [userLine(long), assistantLine('ok')]);

    const result = await readClaudeSession(FOLDER, 'sess-1');

    expect(result?.session.title).toBe(`Fix the build ${'x'.repeat(200)}`.slice(0, 80));
  });

  it('falls back to a default title without ai-title or user text', async () => {
    addFile('proj', 'sess-1.jsonl', [assistantLine('only the assistant spoke')]);

    const result = await readClaudeSession(FOLDER, 'sess-1');

    expect(result?.session.title).toBe('Claude session');
  });

  it('matches the folder ignoring a trailing separator in the query', async () => {
    addFile('proj', 'sess-1.jsonl', [userLine('hi')]);

    const result = await readClaudeSession(FOLDER + path.sep, 'sess-1');

    expect(result?.session.sessionId).toBe('sess-1');
  });

  it('rejects a session id that tries to escape the projects folder', async () => {
    addFile('proj', 'sess-1.jsonl', [userLine('hi')]);
    files.set(path.join(projectsDir(), 'x.jsonl'), JSON.stringify(userLine('escaped')));

    await expect(readClaudeSession(FOLDER, '../x')).resolves.toBeNull();
    await expect(readClaudeSession(FOLDER, 'a/b')).resolves.toBeNull();
  });

  it('returns null for a session recorded in another folder', async () => {
    addFile('proj', 'sess-1.jsonl', [userLine('hi', { cwd: OTHER_FOLDER })]);

    await expect(readClaudeSession(FOLDER, 'sess-1')).resolves.toBeNull();
  });

  it('returns null when the transcript cannot be read', async () => {
    addFile('proj', 'sess-1.jsonl', [userLine('hi')]);
    unreadable.add(path.join(projectsDir(), 'proj', 'sess-1.jsonl'));

    await expect(readClaudeSession(FOLDER, 'sess-1')).resolves.toBeNull();
  });

  it('returns null for an unknown session id', async () => {
    addFile('proj', 'sess-1.jsonl', [userLine('hi')]);

    await expect(readClaudeSession(FOLDER, 'missing')).resolves.toBeNull();
  });
});

describe('listClaudeSessions', () => {
  it('returns an empty list when ~/.claude/projects does not exist', async () => {
    await expect(listClaudeSessions(FOLDER)).resolves.toEqual([]);
  });

  it('lists only sessions whose cwd matches the folder', async () => {
    addFile('proj', 'mine.jsonl', [userLine('mine', { sessionId: 'mine' })]);
    addFile('proj', 'theirs.jsonl', [userLine('theirs', { sessionId: 'theirs', cwd: OTHER_FOLDER })]);

    const sessions = await listClaudeSessions(FOLDER);

    expect(sessions.map((s) => s.sessionId)).toEqual(['mine']);
  });

  it('hides sessions without any user or assistant text', async () => {
    addFile('proj', 'empty.jsonl', [userLine([{ type: 'tool_result', content: 'x' }], { sessionId: 'empty' })]);
    addFile('proj', 'full.jsonl', [userLine('hello', { sessionId: 'full' })]);

    const sessions = await listClaudeSessions(FOLDER);

    expect(sessions.map((s) => s.sessionId)).toEqual(['full']);
  });

  it('skips malformed lines and non-jsonl files', async () => {
    files.set(
      path.join(projectsDir(), 'proj', 'a.jsonl'),
      `{broken\n${JSON.stringify(userLine('ok', { sessionId: 'a' }))}`
    );
    files.set(path.join(projectsDir(), 'proj', 'notes.txt'), JSON.stringify(userLine('ignored')));

    const sessions = await listClaudeSessions(FOLDER);

    expect(sessions.map((s) => [s.sessionId, s.messageCount])).toEqual([['a', 1]]);
  });

  it('sorts sessions newest first', async () => {
    addFile('proj', 'old.jsonl', [userLine('old', { sessionId: 'old', timestamp: '2026-01-01T00:00:00Z' })]);
    addFile('proj', 'new.jsonl', [userLine('new', { sessionId: 'new', timestamp: '2026-03-01T00:00:00Z' })]);

    const sessions = await listClaudeSessions(FOLDER);

    expect(sessions.map((s) => s.sessionId)).toEqual(['new', 'old']);
  });

  it('scans only the project dir named after the folder when it exists', async () => {
    addFile(encodedDir(FOLDER), 'exact.jsonl', [userLine('a', { sessionId: 'exact' })]);
    addFile('unrelated-dir', 'stray.jsonl', [userLine('b', { sessionId: 'stray' })]);

    const sessions = await listClaudeSessions(FOLDER);

    expect(sessions.map((s) => s.sessionId)).toEqual(['exact']);
  });

  it('reports the queried folder as cwd and the transcript sessionId', async () => {
    addFile('proj', 'file-name.jsonl', [userLine('hi', { sessionId: 'inner-id' })]);

    const [session] = await listClaudeSessions(FOLDER);

    expect(session).toMatchObject({ backend: 'claude', sessionId: 'inner-id', cwd: FOLDER });
  });
});
