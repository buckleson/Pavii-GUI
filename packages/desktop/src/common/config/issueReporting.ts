/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where in-app issue reports go.
 *
 * Deliberately a different repository from the source repo: reporters should
 * land in the public releases tracker, not in the code repo.
 */
export const ISSUE_REPO_OWNER = 'buckleson';
export const ISSUE_REPO_NAME = 'Pavii-Gui-Releases';

/**
 * Optional proxy that files the issue on the reporter's behalf.
 *
 * GitHub has no anonymous issue creation, so without a proxy anyone without a
 * GitHub account cannot report. The proxy holds a narrowly scoped token
 * (issues:write on this one repo) and must never live in the app itself - a
 * token shipped in a public desktop build can be extracted and abused.
 *
 * See services/issue-proxy/README.md for the Cloudflare Worker and how to
 * deploy it. When unset, the app falls back to opening a prefilled issue form
 * in the reporter's browser.
 */
export const ISSUE_PROXY_URL_ENV = 'PAVII_ISSUE_PROXY_URL';

export function getIssueProxyUrl(): string | undefined {
  const configured = process.env[ISSUE_PROXY_URL_ENV]?.trim();
  return configured ? configured : undefined;
}

export function issueRepoSlug(): string {
  return `${ISSUE_REPO_OWNER}/${ISSUE_REPO_NAME}`;
}

export function newIssueFormUrl(): string {
  return `https://github.com/${ISSUE_REPO_OWNER}/${ISSUE_REPO_NAME}/issues/new`;
}

/**
 * Primary issue sink: a Supabase project that accepts reports directly, so
 * reporting needs no GitHub account and screenshots/logs actually upload.
 *
 * The publishable key is SAFE to ship: row-level security on `issue_reports`
 * and `storage.objects` grants it INSERT only — it can file a report and
 * upload into the `issue-attachments` bucket, and can never read, change, or
 * delete anything. The project's secret key is used by nothing in this app
 * and must never appear here.
 */
export const SUPABASE_ISSUE_URL = 'https://bnvnwkzeadpvxxssueif.supabase.co';
export const SUPABASE_ISSUE_KEY = 'sb_publishable_SuU9RXdL0FMNPfDZO3zJ5Q_ky-ocXif';
export const SUPABASE_ISSUE_BUCKET = 'issue-attachments';
export const SUPABASE_ISSUE_TABLE = 'issue_reports';
