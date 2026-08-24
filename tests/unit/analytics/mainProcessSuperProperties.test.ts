/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every main-process event must carry the facts needed to triage it.
 *
 * This is a regression test for a real gap found by auditing production data:
 * all five `backend_start_failed` events in PostHog arrived with `app_version`,
 * `platform` and `version` null, because the node client registered no super
 * properties. A start failure that cannot be attributed to a release or an OS
 * is close to useless during an incident.
 *
 * The renderer is not affected the same way — browser events get `$os` from the
 * user agent — so this only ever needed fixing on the node side.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  getVersion: vi.fn(() => '2.1.66'),
  hasAnalyticsId: vi.fn(() => false),
  getOrCreateAnalyticsId: vi.fn(() => 'install-uuid'),
}));

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = mocks.capture;
    shutdown = vi.fn(async () => undefined);
  },
}));

vi.mock('electron', () => ({ app: { getVersion: mocks.getVersion } }));

vi.mock('@/process/utils/analyticsId', () => ({
  hasAnalyticsId: mocks.hasAnalyticsId,
  getOrCreateAnalyticsId: mocks.getOrCreateAnalyticsId,
}));

const loadModule = async () => {
  vi.resetModules();
  const mod = await import('@/process/services/analyticsService');
  mod.initAnalytics();
  return mod;
};

/** Properties of the single capture call made during the test. */
const capturedProperties = (): Record<string, unknown> => {
  expect(mocks.capture).toHaveBeenCalledTimes(1);
  return mocks.capture.mock.calls[0][0].properties as Record<string, unknown>;
};

describe('main-process events carry super properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTHOG_DISABLED;
    mocks.getVersion.mockReturnValue('2.1.66');
    mocks.hasAnalyticsId.mockReturnValue(false);
  });

  it('attributes backend_start_failed to a release and a platform', async () => {
    const { captureAnalytics, ANALYTICS_EVENTS } = await import('@/common/analytics/config').then(async (config) => ({
      ...(await loadModule()),
      ANALYTICS_EVENTS: config.ANALYTICS_EVENTS,
    }));

    captureAnalytics(ANALYTICS_EVENTS.backendStartFailed, { reason: 'backend_data_migration_failed' });

    expect(capturedProperties()).toMatchObject({
      reason: 'backend_data_migration_failed',
      app_version: '2.1.66',
      platform: process.platform,
      arch: process.arch,
    });
  });

  it('adds them to app_closed too, not just the event that happened to set them', async () => {
    const { captureAnalytics, ANALYTICS_EVENTS } = await import('@/common/analytics/config').then(async (config) => ({
      ...(await loadModule()),
      ANALYTICS_EVENTS: config.ANALYTICS_EVENTS,
    }));

    captureAnalytics(ANALYTICS_EVENTS.appClosed, { session_seconds: 42 });

    expect(capturedProperties()).toMatchObject({ session_seconds: 42, app_version: '2.1.66' });
  });

  it('still reports first run on app_opened', async () => {
    const { captureAppOpened } = await loadModule();
    captureAppOpened();
    expect(capturedProperties()).toMatchObject({ is_first_run: true, app_version: '2.1.66' });
  });

  it('lets an explicit event property win over the super property of the same name', async () => {
    // Matches posthog-js, where a property passed to capture() overrides a
    // registered one. Silently ignoring the caller would be the surprising path.
    const { captureAnalytics, ANALYTICS_EVENTS } = await import('@/common/analytics/config').then(async (config) => ({
      ...(await loadModule()),
      ANALYTICS_EVENTS: config.ANALYTICS_EVENTS,
    }));

    captureAnalytics(ANALYTICS_EVENTS.appOpened, { app_version: '9.9.9' });

    expect(capturedProperties()).toMatchObject({ app_version: '9.9.9' });
  });

  it('sends only allowlisted keys, so super properties cannot widen the scrub', async () => {
    const config = await import('@/common/analytics/config');
    const { captureAppOpened } = await loadModule();
    captureAppOpened();

    const offAllowlist = Object.keys(capturedProperties()).filter(
      (key) => !key.startsWith('$') && !config.ALLOWED_PROPERTY_KEYS.has(key)
    );
    expect(offAllowlist).toEqual([]);
  });
});
