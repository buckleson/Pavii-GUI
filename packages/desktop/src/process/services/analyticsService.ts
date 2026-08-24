/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PostHog analytics for the main process.
 *
 * Covers what the renderer cannot see: launch, clean shutdown, backend start
 * failures and update installs. Shares the per-install anonymous id
 * (`getOrCreateAnalyticsId`) with the renderer so both streams belong to one
 * person in PostHog, and runs every event through the same `scrubEvent` as the
 * renderer so the two cannot drift.
 *
 * Best-effort throughout: analytics must never be able to break app startup or
 * delay quit.
 */

import { app } from 'electron';
import { PostHog } from 'posthog-node';
import {
  ANALYTICS_EVENTS,
  POSTHOG_API_HOST,
  analyticsEnvironment,
  isAnalyticsDisabled,
  posthogKey,
  type AnalyticsEventName,
} from '../../common/analytics/config';
import { scrubEvent, type AnalyticsCaptureResult } from '../../common/analytics/scrub';
import { getOrCreateAnalyticsId, hasAnalyticsId } from '../utils/analyticsId';

let client: PostHog | null = null;
let distinctId = '';
let startedAt = 0;
let firstRun = false;
let superProperties: Record<string, unknown> = {};

export function initAnalytics(): void {
  if (client || isAnalyticsDisabled()) return;
  try {
    // Checked before the getter, which creates the file.
    firstRun = !hasAnalyticsId();
    distinctId = getOrCreateAnalyticsId();
    startedAt = Date.now();
    // The node client has no equivalent of posthog-js `register`, so the
    // renderer's super properties have to be merged in by hand on every event.
    // Resolved once: `app.getVersion()` is stable for the process lifetime.
    //
    // `platform`/`arch` matter more here than in the renderer. Browser events
    // get `$os` derived from the user agent; node events get nothing, so
    // without these a main-process event cannot be attributed to a platform at
    // all — which is what made `backend_start_failed` untriageable.
    superProperties = {
      environment: analyticsEnvironment(),
      app_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    };
    client = new PostHog(posthogKey(), {
      host: POSTHOG_API_HOST,
      // Small batches: a desktop app can be killed at any moment, and a lost
      // batch is worse than a slightly chattier connection.
      flushAt: 5,
      flushInterval: 10_000,
    });
  } catch (error) {
    console.warn('[analytics] init failed:', error instanceof Error ? error.message : error);
    client = null;
  }
}

/**
 * Capture a curated event. Runs through the shared scrub, which drops the event
 * entirely if anything about it looks unsafe.
 */
export function captureAnalytics(event: AnalyticsEventName, properties: Record<string, unknown> = {}): void {
  if (!client) return;
  try {
    const scrubbed = scrubEvent<AnalyticsCaptureResult>({
      event,
      // Explicit event properties win, matching posthog-js, where a property
      // passed to `capture` overrides a registered one of the same name.
      properties: { ...superProperties, ...properties },
    });
    if (!scrubbed) return;
    client.capture({ distinctId, event: scrubbed.event, properties: scrubbed.properties });
  } catch (error) {
    console.warn('[analytics] capture failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * `app_opened`. Version, platform and arch now ride on every main-process
 * event as super properties, so only the fact that cannot be derived elsewhere
 * stays here.
 */
export function captureAppOpened(): void {
  captureAnalytics(ANALYTICS_EVENTS.appOpened, { is_first_run: firstRun });
}

/** `app_closed`, carrying session length so retention is measurable. */
export function captureAppClosed(): void {
  if (!startedAt) return;
  captureAnalytics(ANALYTICS_EVENTS.appClosed, {
    session_seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

/**
 * Flush pending events on quit. Bounded so a dead network cannot hold the app
 * open — `shutdown` takes its own timeout in milliseconds.
 */
export async function shutdownAnalytics(): Promise<void> {
  if (!client) return;
  const pending = client;
  client = null;
  try {
    await pending.shutdown(2000);
  } catch {
    // Losing the last batch is acceptable; blocking quit is not.
  }
}
