/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Delivers an in-app issue report.
 *
 * Three paths, in order of preference:
 *
 *  1. **Supabase** - the report row and its attachments go straight into the
 *     Pavii issue project. Needs no account from the reporter, and it is the
 *     only path that actually uploads screenshots and logs (RLS makes the
 *     shipped key insert-only; see `issueReporting.ts`).
 *  2. **Proxy** - a small service holding a narrowly scoped token files a
 *     GitHub issue on the reporter's behalf.
 *  3. **Browser** - open a prefilled `issues/new` form so the reporter files it
 *     with their own account. The button always degrades to something that
 *     still works.
 *
 * On the GitHub paths, attachments are written to disk and the folder is
 * opened, because neither can upload files for the reporter.
 */

import { randomUUID } from 'crypto';
import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  SUPABASE_ISSUE_BUCKET,
  SUPABASE_ISSUE_KEY,
  SUPABASE_ISSUE_TABLE,
  SUPABASE_ISSUE_URL,
  getIssueProxyUrl,
  issueRepoSlug,
} from '@/common/config/issueReporting';
import { buildPrefilledIssueUrl, type IssueEnvironment } from '@/common/utils/issueReport';

const PROXY_TIMEOUT_MS = 10_000;
const SUPABASE_TIMEOUT_MS = 15_000;
const BUNDLE_DIR_NAME = 'issue-reports';
/** Matches the CHECK constraint on issue_reports.description. */
const DESCRIPTION_LIMIT = 4000;

export type IssueAttachment = {
  data: number[];
  filename: string;
};

export type DeliverIssueInput = {
  attachments?: IssueAttachment[];
  body: string;
  /** Raw dialog description; the composed `body` is stored when absent. */
  description?: string;
  /** Raw module label; the composed `title` is stored when absent. */
  module?: string;
  title: string;
};

export type DeliverIssueResult = {
  bundleDir?: string;
  issueUrl?: string;
  mode: 'supabase' | 'proxy' | 'browser';
  proxyError?: string;
  reportId?: string;
  supabaseError?: string;
};

export function collectIssueEnvironment(): IssueEnvironment {
  let osRelease: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    osRelease = (require('os') as typeof import('os')).release();
  } catch {
    osRelease = undefined;
  }

  return {
    appVersion: app.getVersion(),
    arch: process.arch,
    electronVersion: process.versions.electron,
    locale: app.getLocale(),
    osRelease,
    platform: process.platform,
  };
}

/**
 * Writes attachments next to each other in a timestamped folder so the
 * reporter can drag the whole set into the issue.
 *
 * @returns the folder path, or undefined when there was nothing to write.
 */
export function saveIssueBundle(attachments: IssueAttachment[]): string | undefined {
  if (attachments.length === 0) return undefined;

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(app.getPath('userData'), BUNDLE_DIR_NAME, stamp);
    fs.mkdirSync(dir, { recursive: true });

    for (const attachment of attachments) {
      // Never let a crafted filename escape the bundle directory.
      const safeName = path.basename(attachment.filename) || 'attachment.bin';
      fs.writeFileSync(path.join(dir, safeName), Buffer.from(attachment.data));
    }
    return dir;
  } catch (error) {
    console.error('[issueDelivery] Failed to save report bundle:', error);
    return undefined;
  }
}

async function supabaseFetch(pathname: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  try {
    return await fetch(`${SUPABASE_ISSUE_URL}${pathname}`, {
      ...init,
      headers: {
        apikey: SUPABASE_ISSUE_KEY,
        Authorization: `Bearer ${SUPABASE_ISSUE_KEY}`,
        ...init.headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Files the report in Supabase: attachments first (a lost screenshot must not
 * lose the report), then the row referencing whatever uploaded. `return=minimal`
 * is required — the shipped key has no SELECT, so asking PostgREST to echo the
 * inserted row back would fail the whole insert.
 */
async function createIssueInSupabase(
  input: DeliverIssueInput,
  environment: IssueEnvironment
): Promise<{ attachmentPaths: string[]; reportId: string }> {
  const reportId = randomUUID();
  const attachmentPaths: string[] = [];

  for (const attachment of input.attachments ?? []) {
    const safeName = path.basename(attachment.filename) || 'attachment.bin';
    const objectPath = `${reportId}/${safeName}`;
    try {
      const upload = await supabaseFetch(`/storage/v1/object/${SUPABASE_ISSUE_BUCKET}/${objectPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(attachment.data),
      });
      if (upload.ok) {
        attachmentPaths.push(objectPath);
      } else {
        console.warn('[issueDelivery] Attachment upload refused:', safeName, upload.status);
      }
    } catch (error) {
      console.warn('[issueDelivery] Attachment upload failed:', safeName, error);
    }
  }

  const response = await supabaseFetch(`/rest/v1/${SUPABASE_ISSUE_TABLE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: reportId,
      description: (input.description ?? input.body).slice(0, DESCRIPTION_LIMIT),
      module: input.module ?? input.title,
      app_version: environment.appVersion,
      platform: environment.platform,
      arch: environment.arch,
      os_release: environment.osRelease ?? null,
      electron_version: environment.electronVersion ?? null,
      locale: environment.locale ?? null,
      attachment_paths: attachmentPaths,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`supabase responded ${response.status}: ${detail}`);
  }
  return { attachmentPaths, reportId };
}

async function createIssueViaProxy(proxyUrl: string, title: string, body: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, repo: issueRepoSlug() }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`proxy responded ${response.status}`);
    }

    const payload = (await response.json()) as { html_url?: string; url?: string };
    const issueUrl = payload.html_url ?? payload.url;
    if (!issueUrl) {
      throw new Error('proxy response did not include an issue url');
    }
    return issueUrl;
  } finally {
    clearTimeout(timeout);
  }
}

export async function deliverIssueReport(input: DeliverIssueInput): Promise<DeliverIssueResult> {
  let supabaseError: string | undefined;
  try {
    const { reportId } = await createIssueInSupabase(input, collectIssueEnvironment());
    // Attachments actually uploaded — no local bundle, no browser to open.
    return { mode: 'supabase', reportId };
  } catch (error) {
    supabaseError = error instanceof Error ? error.message : String(error);
    console.warn('[issueDelivery] Supabase submission failed, falling back to GitHub:', supabaseError);
  }

  const bundleDir = saveIssueBundle(input.attachments ?? []);
  const proxyUrl = getIssueProxyUrl();

  if (proxyUrl) {
    try {
      const issueUrl = await createIssueViaProxy(proxyUrl, input.title, input.body);
      await shell.openExternal(issueUrl);
      if (bundleDir) void shell.openPath(bundleDir);
      return { mode: 'proxy', issueUrl, bundleDir, supabaseError };
    } catch (error) {
      // Fall through to the browser form: a broken proxy must not swallow the
      // report the way the old Sentry sink silently did.
      const proxyError = error instanceof Error ? error.message : String(error);
      console.warn('[issueDelivery] Proxy submission failed, falling back to browser:', proxyError);
      const fallbackUrl = buildPrefilledIssueUrl(input.title, input.body);
      await shell.openExternal(fallbackUrl);
      if (bundleDir) void shell.openPath(bundleDir);
      return { mode: 'browser', issueUrl: fallbackUrl, bundleDir, proxyError, supabaseError };
    }
  }

  const issueUrl = buildPrefilledIssueUrl(input.title, input.body);
  await shell.openExternal(issueUrl);
  if (bundleDir) void shell.openPath(bundleDir);
  return { mode: 'browser', issueUrl, bundleDir, supabaseError };
}
