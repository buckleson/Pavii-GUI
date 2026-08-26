/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Supabase issue sink: reports and their attachments go straight into the
 * project with the shipped insert-only key, and every failure falls back to
 * the GitHub paths instead of losing the report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const openPath = vi.hoisted(() => vi.fn().mockResolvedValue(''));
const getPath = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    getVersion: () => '2.2.0-test',
    getLocale: () => 'en-US',
    getPath,
  },
  shell: { openExternal, openPath },
}));

import * as os from 'os';
import * as path from 'path';
import { deliverIssueReport } from '@/process/feedback/issueDelivery';
import { SUPABASE_ISSUE_BUCKET, SUPABASE_ISSUE_TABLE, SUPABASE_ISSUE_URL } from '@/common/config/issueReporting';

type FetchCall = { body?: BodyInit | null; headers: Record<string, string>; method?: string; url: string };

function mockFetch(handler: (call: FetchCall) => { body?: string; ok: boolean; status: number }) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: FetchCall = {
        url: String(url),
        method: init?.method,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body,
      };
      calls.push(call);
      const result = handler(call);
      return {
        ok: result.ok,
        status: result.status,
        text: async () => result.body ?? '',
        json: async () => JSON.parse(result.body ?? '{}'),
      } as Response;
    })
  );
  return calls;
}

describe('deliverIssueReport via Supabase', () => {
  beforeEach(() => {
    openExternal.mockClear();
    openPath.mockClear();
    getPath.mockReturnValue(path.join(os.tmpdir(), 'pavii-issue-test'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads attachments then inserts the row, and opens nothing', async () => {
    const calls = mockFetch(() => ({ ok: true, status: 201 }));

    const result = await deliverIssueReport({
      title: '[Chat] broken thing',
      body: 'composed markdown body',
      description: 'raw description text',
      module: 'Chat',
      attachments: [{ filename: 'shot.png', data: [1, 2, 3] }],
    });

    expect(result.mode).toBe('supabase');
    expect(result.reportId).toMatch(/^[0-9a-f-]{36}$/);
    // No browser, no local bundle folder: the attachments actually uploaded.
    expect(openExternal).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();

    expect(calls[0].url).toBe(
      `${SUPABASE_ISSUE_URL}/storage/v1/object/${SUPABASE_ISSUE_BUCKET}/${result.reportId}/shot.png`
    );
    expect(calls[1].url).toBe(`${SUPABASE_ISSUE_URL}/rest/v1/${SUPABASE_ISSUE_TABLE}`);
    // Insert-only key: PostgREST must not be asked to echo the row back.
    expect(calls[1].headers.Prefer).toBe('return=minimal');

    const row = JSON.parse(String(calls[1].body));
    expect(row.description).toBe('raw description text');
    expect(row.module).toBe('Chat');
    expect(row.app_version).toBe('2.2.0-test');
    expect(row.attachment_paths).toEqual([`${result.reportId}/shot.png`]);
  });

  it('still files the report when an attachment upload is refused', async () => {
    const calls = mockFetch((call) =>
      call.url.includes('/storage/') ? { ok: false, status: 403 } : { ok: true, status: 201 }
    );

    const result = await deliverIssueReport({
      title: 't',
      body: 'b',
      attachments: [{ filename: 'shot.png', data: [1] }],
    });

    expect(result.mode).toBe('supabase');
    const row = JSON.parse(String(calls.at(-1)?.body));
    expect(row.attachment_paths).toEqual([]);
  });

  it('falls back to the browser form when the insert is refused', async () => {
    mockFetch(() => ({ ok: false, status: 401, body: 'nope' }));

    const result = await deliverIssueReport({ title: 'title', body: 'body' });

    expect(result.mode).toBe('browser');
    expect(result.supabaseError).toContain('401');
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('issues/new'));
  });

  it('stores the composed title and body when raw fields are absent', async () => {
    const calls = mockFetch(() => ({ ok: true, status: 201 }));

    await deliverIssueReport({ title: '[Other] fallback', body: 'full body' });

    const row = JSON.parse(String(calls.at(-1)?.body));
    expect(row.description).toBe('full body');
    expect(row.module).toBe('[Other] fallback');
  });
});
