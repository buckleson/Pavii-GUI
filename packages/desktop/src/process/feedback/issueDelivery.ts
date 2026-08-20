/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Delivers an in-app issue report to GitHub.
 *
 * Two paths, in order of preference:
 *
 *  1. **Proxy** - a small service holding a narrowly scoped token files the
 *     issue on the reporter's behalf. This is the only path that works for
 *     reporters without a GitHub account, since GitHub has no anonymous issue
 *     creation.
 *  2. **Browser** - open a prefilled `issues/new` form so the reporter files it
 *     with their own account. Used when no proxy is configured or the proxy is
 *     unreachable, so the button degrades to something that still works.
 *
 * Attachments are written to disk and the folder is opened, because neither
 * path can upload files to GitHub for the reporter.
 */

import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getIssueProxyUrl, issueRepoSlug } from '@/common/config/issueReporting';
import { buildPrefilledIssueUrl, type IssueEnvironment } from '@/common/utils/issueReport';

const PROXY_TIMEOUT_MS = 10_000;
const BUNDLE_DIR_NAME = 'issue-reports';

export type IssueAttachment = {
  data: number[];
  filename: string;
};

export type DeliverIssueInput = {
  attachments?: IssueAttachment[];
  body: string;
  title: string;
};

export type DeliverIssueResult = {
  bundleDir?: string;
  issueUrl?: string;
  mode: 'proxy' | 'browser';
  proxyError?: string;
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
  const bundleDir = saveIssueBundle(input.attachments ?? []);
  const proxyUrl = getIssueProxyUrl();

  if (proxyUrl) {
    try {
      const issueUrl = await createIssueViaProxy(proxyUrl, input.title, input.body);
      await shell.openExternal(issueUrl);
      if (bundleDir) void shell.openPath(bundleDir);
      return { mode: 'proxy', issueUrl, bundleDir };
    } catch (error) {
      // Fall through to the browser form: a broken proxy must not swallow the
      // report the way the old Sentry sink silently did.
      const proxyError = error instanceof Error ? error.message : String(error);
      console.warn('[issueDelivery] Proxy submission failed, falling back to browser:', proxyError);
      const fallbackUrl = buildPrefilledIssueUrl(input.title, input.body);
      await shell.openExternal(fallbackUrl);
      if (bundleDir) void shell.openPath(bundleDir);
      return { mode: 'browser', issueUrl: fallbackUrl, bundleDir, proxyError };
    }
  }

  const issueUrl = buildPrefilledIssueUrl(input.title, input.body);
  await shell.openExternal(issueUrl);
  if (bundleDir) void shell.openPath(bundleDir);
  return { mode: 'browser', issueUrl, bundleDir };
}
