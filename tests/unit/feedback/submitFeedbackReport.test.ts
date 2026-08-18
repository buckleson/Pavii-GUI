/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitFeedbackReport } from '@/renderer/services/feedback/submitFeedbackReport';

/**
 * Reports used to go to Sentry, which was gated on a DSN that was never
 * configured - every submission was silently discarded. They now become GitHub
 * issues, so these tests assert on the delivery bridge instead.
 */

type SubmitIssuePayload = {
  attachments?: Array<{ data: number[]; filename: string }>;
  body: string;
  title: string;
};

const baseInput = {
  description: '  Engine   cannot start  ',
  module: 'installation-integrity',
  moduleLabel: 'Installation is incomplete',
};

function stubElectronAPI(overrides: Record<string, unknown> = {}) {
  const submitIssueReport = vi.fn(async () => ({ mode: 'browser' as const, issueUrl: 'https://github.example/issue/1' }));
  const logFeedbackEvent = vi.fn();
  const getIssueEnvironment = vi.fn(async () => ({ appVersion: '2.1.52', arch: 'x64', platform: 'win32' }));

  vi.stubGlobal('window', {
    electronAPI: { emit: vi.fn(), on: vi.fn(), submitIssueReport, logFeedbackEvent, getIssueEnvironment, ...overrides },
  });

  return { submitIssueReport, logFeedbackEvent, getIssueEnvironment };
}

describe('submitFeedbackReport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('delivers the report through the issue bridge and returns the result', async () => {
    const { submitIssueReport } = stubElectronAPI();

    const result = await submitFeedbackReport(baseInput);

    expect(submitIssueReport).toHaveBeenCalledOnce();
    const payload = submitIssueReport.mock.calls[0][0] as unknown as SubmitIssuePayload;
    expect(payload.title).toBe('[Installation is incomplete] Engine cannot start');
    expect(payload.body).toContain('Engine cannot start');
    expect(payload.body).toContain('| App version | 2.1.52 |');
    expect(result.mode).toBe('browser');
    expect(result.issueUrl).toBe('https://github.example/issue/1');
  });

  it('collects logs and puts them ahead of caller attachments', async () => {
    const collectFeedbackLogs = vi.fn().mockResolvedValue({ filename: 'pavii-logs.log.gz', data: [1, 2, 3] });
    const { submitIssueReport } = stubElectronAPI({ collectFeedbackLogs });

    await submitFeedbackReport({
      ...baseInput,
      collectLogs: true,
      attachments: [{ filename: 'screenshot.png', data: new Uint8Array([4, 5, 6]), contentType: 'image/png' }],
    });

    expect(collectFeedbackLogs).toHaveBeenCalledOnce();
    const payload = submitIssueReport.mock.calls[0][0] as unknown as SubmitIssuePayload;
    expect(payload.attachments?.map((a) => a.filename)).toEqual(['pavii-logs.log.gz', 'screenshot.png']);
    // The body must name the files, since neither delivery path can upload them.
    expect(payload.body).toContain('`pavii-logs.log.gz`');
    expect(payload.body).toContain('`screenshot.png`');
  });

  it('still submits when log collection is unavailable', async () => {
    const { submitIssueReport } = stubElectronAPI();

    await expect(submitFeedbackReport({ ...baseInput, collectLogs: true })).resolves.toBeDefined();

    expect(submitIssueReport).toHaveBeenCalledOnce();
  });

  it('folds tags and extra context into the issue body', async () => {
    const { submitIssueReport } = stubElectronAPI();

    await submitFeedbackReport({
      ...baseInput,
      extra: { conversationId: 'abc-123' },
      tags: { report_source: 'backend_startup_failure' },
    });

    const payload = submitIssueReport.mock.calls[0][0] as unknown as SubmitIssuePayload;
    expect(payload.body).toContain('report_source');
    expect(payload.body).toContain('backend_startup_failure');
    expect(payload.body).toContain('abc-123');
  });

  it('logs a submitted diagnostic on success', async () => {
    const { logFeedbackEvent } = stubElectronAPI();

    await submitFeedbackReport(baseInput);

    expect(logFeedbackEvent).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: 'submitted' }));
  });

  it('reports failure loudly instead of swallowing it', async () => {
    const submitIssueReport = vi.fn().mockRejectedValue(new Error('bridge exploded'));
    const { logFeedbackEvent } = stubElectronAPI({ submitIssueReport });

    await expect(submitFeedbackReport(baseInput)).rejects.toThrow('bridge exploded');

    expect(logFeedbackEvent).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', message: 'failed' }));
  });

  it('opens a prefilled issue form when there is no desktop bridge (WebUI)', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { electronAPI: undefined, open });

    const result = await submitFeedbackReport(baseInput);

    expect(open).toHaveBeenCalledOnce();
    expect(String(open.mock.calls[0][0])).toContain('buckleson/Pavii-Gui-Releases/issues/new');
    expect(result.mode).toBe('browser');
  });
});
