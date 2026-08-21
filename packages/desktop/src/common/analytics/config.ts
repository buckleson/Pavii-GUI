/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PostHog product-analytics configuration shared by the renderer (`posthog-js`)
 * and the main process (`posthog-node`), so both report the same event names
 * against the same project and the same property allowlist.
 */

/**
 * PostHog project key.
 *
 * This is a **public, write-only** project key — PostHog's own install
 * instructions embed it directly in client bundles — so it lives in source
 * rather than in a secret. `POSTHOG_KEY` overrides it (point a fork or a CI
 * build at a different project) and `POSTHOG_DISABLED=1` turns capture off.
 */
const DEFAULT_POSTHOG_KEY = 'phc_yimrxw6UXv4iezUNR7MfzG3rXNPww9psTM757SACa7qg';

/** EU cloud ingestion host for project 249810. */
export const POSTHOG_API_HOST = 'https://eu.i.posthog.com';

/**
 * Synthetic origin substituted for the real one. The packaged app loads the
 * renderer over `file://`, so `window.location` carries the install path — and
 * therefore the OS user name — into `$current_url`/`$pathname` on every event.
 */
export const APP_URL_ORIGIN = 'app://pavii';
export const APP_URL_HOST = 'pavii.app';

/**
 * Vite `define` replaces these two expressions literally, substituting `''`
 * when the variable is unset — so both checks must be truthiness tests and
 * never `??`, which would keep the empty string.
 */
export const posthogKey = (): string => process.env.POSTHOG_KEY || DEFAULT_POSTHOG_KEY;

export const isAnalyticsDisabled = (): boolean => {
  const flag = process.env.POSTHOG_DISABLED;
  return flag === '1' || flag === 'true';
};

/** `development` events can be filtered out in PostHog rather than lost. */
export const analyticsEnvironment = (): 'development' | 'production' =>
  process.env.NODE_ENV === 'production' ? 'production' : 'development';

/**
 * Every event this app may send. Both processes import from here so a typo
 * cannot silently create a parallel event name that never shows on a dashboard.
 */
/**
 * Every event this app may send.
 *
 * Each name here must have a real call site — `tests/unit/analytics/
 * eventCoverage.test.ts` fails the build otherwise. A declared-but-unwired
 * event is worse than a missing one: the dashboard renders an empty chart and
 * reads as "nobody uses this feature" rather than "nobody instrumented it".
 * Add the name and the `track()` call in the same change.
 */
export const ANALYTICS_EVENTS = {
  appOpened: 'app_opened',
  appClosed: 'app_closed',
  backendStartFailed: 'backend_start_failed',
  providerConfigured: 'provider_configured',
  conversationStarted: 'conversation_started',
  messageSent: 'message_sent',
  turnCompleted: 'turn_completed',
  mcpConnected: 'mcp_connected',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * The only non-`$` property keys allowed to leave the app.
 *
 * `scrubEvent` deletes everything else, so a future
 * `capture('skill_imported', { skillName })` drops the name instead of shipping
 * a user-authored string. Adding a dimension means adding it here first, which
 * is the review point.
 */
export const ALLOWED_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  // Registered as super properties on every event.
  'environment',
  'app_version',
  'route',
  // app_opened
  'version',
  'platform',
  'arch',
  'is_first_run',
  // app_closed
  'session_seconds',
  // backend_start_failed
  'reason',
  // provider_configured
  'provider',
  // conversation_started / message_sent / turn_completed
  'agent_kind',
  'has_files',
  'mcp_count',
  'ok',
  // mcp_connected
  'transport',
  // autocapture opt-in label (data-ph-capture-attribute-ph_el)
  'ph_el',
]);
