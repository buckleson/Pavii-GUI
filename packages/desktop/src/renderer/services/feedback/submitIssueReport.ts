/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Files a feedback report as a GitHub issue.
 *
 * This replaces the previous Sentry sink, which was gated on a DSN that was
 * never configured - every report submitted through it was discarded.
 */

import type { IssueEnvironment, IssueReportResult } from '@/common/types/platform/electron';
import { buildIssueBody, buildIssueTitle, buildPrefilledIssueUrl } from '@/common/utils/issueReport';
import { logFeedbackReport, type FeedbackAttachment } from './submitFeedbackReport';

export type SubmitIssueReportInput = {
  attachments: FeedbackAttachment[];
  description: string;
  module: string;
  moduleLabel: string;
};

const FALLBACK_ENVIRONMENT: IssueEnvironment = {
  appVersion: 'unknown',
  arch: 'unknown',
  platform: 'web',
};

async function resolveEnvironment(): Promise<IssueEnvironment> {
  try {
    const environment = await window.electronAPI?.getIssueEnvironment?.();
    return environment ?? FALLBACK_ENVIRONMENT;
  } catch {
    return FALLBACK_ENVIRONMENT;
  }
}

export async function submitIssueReport(input: SubmitIssueReportInput): Promise<IssueReportResult> {
  const environment = await resolveEnvironment();
  const title = buildIssueTitle(input.moduleLabel, input.description);
  const body = buildIssueBody({
    description: input.description,
    moduleLabel: input.moduleLabel,
    environment,
    attachmentNames: input.attachments.map((attachment) => attachment.filename),
  });

  const submit = window.electronAPI?.submitIssueReport;
  if (!submit) {
    // WebUI has no main process to save the bundle or open a browser for us.
    // Opening the prefilled form is still better than dropping the report.
    const issueUrl = buildPrefilledIssueUrl(title, body);
    window.open(issueUrl, '_blank', 'noopener');
    logFeedbackReport('info', 'issue form opened (no desktop bridge)', { module: input.module });
    return { mode: 'browser', issueUrl };
  }

  const result = await submit({
    title,
    body,
    attachments: input.attachments.map((attachment) => ({
      filename: attachment.filename,
      data: Array.from(attachment.data),
    })),
  });

  logFeedbackReport('info', 'issue report delivered', {
    module: input.module,
    mode: result.mode,
    issueUrl: result.issueUrl,
    bundleDir: result.bundleDir,
    attachmentCount: input.attachments.length,
    ...(result.proxyError ? { proxyError: result.proxyError } : {}),
  });

  return result;
}
