/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns a feedback submission into a GitHub issue.
 *
 * Pure functions only, so the formatting and the URL-length handling can be
 * tested without Electron. Delivery lives in
 * `packages/desktop/src/process/feedback/issueDelivery.ts`.
 */

import { newIssueFormUrl } from '@/common/config/issueReporting';

const TITLE_PREVIEW_LENGTH = 60;

/**
 * GitHub rejects very long issue URLs (the practical server limit is around
 * 8 KB for the whole request line). Stay well under it and truncate the body
 * rather than sending a request that fails with an opaque error.
 */
const MAX_ISSUE_URL_LENGTH = 6000;

export type IssueEnvironment = {
  appVersion: string;
  arch: string;
  electronVersion?: string;
  engineVersion?: string;
  locale?: string;
  osRelease?: string;
  platform: string;
};

export type BuildIssueInput = {
  attachmentNames?: string[];
  bundleHint?: boolean;
  description: string;
  environment: IssueEnvironment;
  moduleLabel: string;
};

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildIssueTitle(moduleLabel: string, description: string): string {
  const summary = collapseWhitespace(description);
  const preview =
    summary.length > TITLE_PREVIEW_LENGTH ? `${summary.slice(0, TITLE_PREVIEW_LENGTH).trimEnd()}...` : summary;
  return `[${moduleLabel}] ${preview || 'Issue report'}`;
}

function environmentTable(environment: IssueEnvironment): string {
  const rows: Array<[string, string | undefined]> = [
    ['App version', environment.appVersion],
    ['Engine', environment.engineVersion],
    ['OS', environment.osRelease ? `${environment.platform} ${environment.osRelease}` : environment.platform],
    ['Arch', environment.arch],
    ['Electron', environment.electronVersion],
    ['Locale', environment.locale],
  ];

  const present = rows.filter((row): row is [string, string] => Boolean(row[1]));
  return ['| Field | Value |', '| --- | --- |', ...present.map(([key, value]) => `| ${key} | ${value} |`)].join('\n');
}

export function buildIssueBody(input: BuildIssueInput): string {
  const sections = [
    '### What happened',
    '',
    input.description.trim(),
    '',
    '### Environment',
    '',
    environmentTable(input.environment),
  ];

  const names = input.attachmentNames ?? [];
  if (names.length > 0) {
    sections.push(
      '',
      '### Diagnostics',
      '',
      // The app cannot upload files to GitHub on the reporter's behalf, so it
      // saves them locally and opens the folder instead.
      'The following files were saved on the reporter machine. Drag them into this issue to attach them:',
      '',
      ...names.map((name) => `- \`${name}\``)
    );
  }

  sections.push('', '---', '', '<sub>Filed from Pavii.Ai via Report Issue.</sub>');
  return sections.join('\n');
}

/**
 * Prefilled `issues/new` URL, used when no proxy is configured or the proxy is
 * unreachable. The reporter's own GitHub account files the issue, so nothing
 * is submitted without them seeing it.
 *
 * Truncates the body if the resulting URL would be too long, keeping the
 * beginning of the description (where people put the actual problem).
 */
export function buildPrefilledIssueUrl(title: string, body: string): string {
  const base = newIssueFormUrl();
  const build = (issueBody: string): string => {
    const params = new URLSearchParams({ title, body: issueBody });
    return `${base}?${params.toString()}`;
  };

  let candidate = build(body);
  if (candidate.length <= MAX_ISSUE_URL_LENGTH) {
    return candidate;
  }

  const notice = '\n\n_(truncated - full details were too long for the browser; please paste the rest)_';
  let keep = body.length;
  while (keep > 0 && candidate.length > MAX_ISSUE_URL_LENGTH) {
    // Shrink geometrically rather than one character at a time: encoding cost
    // per character varies, so a linear walk is needlessly slow.
    keep = Math.floor(keep * 0.8);
    candidate = build(body.slice(0, keep) + notice);
  }
  return candidate;
}
