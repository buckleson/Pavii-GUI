/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PostHog product analytics for the renderer.
 *
 * Autocapture runs in **allowlist** mode: only elements carrying
 * `data-ph-capture` (or nested inside one) produce an `$autocapture` event, and
 * `mask_all_text` / `mask_all_element_attributes` strip element text and
 * attributes regardless. That is deliberate — this app's DOM holds the user's
 * prompts, file paths and API keys, and a denylist fails open the first time
 * someone adds a screen and forgets the marker. `scrubEvent` is the last line
 * of defence; see `common/analytics/scrub.ts`.
 */

import posthog from 'posthog-js';
import { ipcBridge } from '@/common';
import {
  ALLOWED_PROPERTY_KEYS,
  ANALYTICS_EVENTS,
  APP_URL_ORIGIN,
  POSTHOG_API_HOST,
  analyticsEnvironment,
  isAnalyticsDisabled,
  posthogKey,
  type AnalyticsEventName,
} from '@/common/analytics/config';
import { normaliseRoute, routeToAppUrl } from '@/common/analytics/routes';
import { scrubEvent, type AnalyticsCaptureResult } from '@/common/analytics/scrub';

declare const __APP_VERSION__: string;

let started = false;
/** Last route the tracker saw; used for autocapture URL targeting only. */
let currentRoute = '/';

export const setCurrentRoute = (route: string): void => {
  currentRoute = route;
};

/** Resolve the per-install anonymous id so renderer and main events join up. */
const resolveDistinctId = async (): Promise<string | undefined> => {
  try {
    const id = await ipcBridge.application.analyticsId.invoke();
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch {
    // WebUI browser mode has no Electron bridge — PostHog's own anonymous id
    // is used instead.
    return undefined;
  }
};

/**
 * Called from the renderer entry at module scope, so it must never reject:
 * analytics failing is not a reason for the app not to start.
 */
export const initAnalytics = async (): Promise<void> => {
  try {
    await initAnalyticsUnsafe();
  } catch (error) {
    started = false;
    console.warn('[analytics] init failed:', error instanceof Error ? error.message : error);
  }
};

const initAnalyticsUnsafe = async (): Promise<void> => {
  if (started || isAnalyticsDisabled()) return;
  started = true;

  const distinctId = await resolveDistinctId();

  posthog.init(posthogKey(), {
    api_host: POSTHOG_API_HOST,
    defaults: '2026-05-30',
    ...(distinctId ? { bootstrap: { distinctID: distinctId } } : {}),

    autocapture: {
      dom_event_allowlist: ['click'],
      css_selector_allowlist: ['[data-ph-capture]'],
      css_selector_ignorelist: ['.ph-no-autocapture', '[data-ph-no-autocapture]', '.ph-no-capture'],
      element_attribute_ignorelist: ['title', 'alt', 'placeholder', 'aria-label', 'value', 'href', 'src'],
    },
    mask_all_text: true,
    mask_all_element_attributes: true,

    // HashRouter — pageviews are emitted by PostHogRouteTracker instead.
    capture_pageview: false,
    capture_pageleave: false,
    // Targeting only; the captured `$current_url` is fixed in `scrubEvent`.
    get_current_url: () => routeToAppUrl(currentRoute, APP_URL_ORIGIN),

    // Never pull remote script into the Electron renderer.
    disable_external_dependency_loading: true,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    capture_exceptions: false, // Sentry owns these
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,

    person_profiles: 'identified_only',
    properties_string_max_length: 512,
    ip: false,
    property_denylist: [
      '$referrer',
      '$referring_domain',
      '$initial_referrer',
      '$initial_referring_domain',
      'title',
      '$el_text',
      '$selected_content',
      '$elements',
    ],
    before_send: (result) => scrubEvent(result as AnalyticsCaptureResult | null) as typeof result,
  });

  posthog.register({
    environment: analyticsEnvironment(),
    app_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
  });

  void attachSignedInUser();
};

/**
 * Upgrade the anonymous install id to the Pavii account uid once the user is
 * signed in. The email is deliberately never sent.
 */
const attachSignedInUser = async (): Promise<void> => {
  try {
    const session = await ipcBridge.paviiAuth.getSession.invoke();
    if (session?.uid) posthog.identify(session.uid);
  } catch {
    // Not signed in, or no bridge — stay anonymous.
  }
};

/**
 * Capture a curated event. Property keys not in `ALLOWED_PROPERTY_KEYS` are
 * dropped by `scrubEvent` downstream; this filters them here too so the
 * omission is visible while developing rather than only in PostHog.
 */
export const track = (event: AnalyticsEventName, properties: Record<string, unknown> = {}): void => {
  if (!started) return;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (ALLOWED_PROPERTY_KEYS.has(key)) safe[key] = value;
  }
  try {
    posthog.capture(event, { ...safe, route: currentRoute });
  } catch {
    // A failed capture must never break the action that triggered it.
  }
};

/** Manual pageview for the hash router. */
export const trackPageview = (route: string): void => {
  if (!started) return;
  try {
    posthog.capture('$pageview', { route });
  } catch {
    // As above — navigation must not depend on analytics.
  }
};

export { ANALYTICS_EVENTS, normaliseRoute };
