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
  construct: vi.fn(),
  getVersion: vi.fn(() => '2.1.66'),
  hasAnalyticsId: vi.fn(() => false),
  getOrCreateAnalyticsId: vi.fn(() => 'install-uuid'),
}));

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
    capture = mocks.capture;
    shutdown = vi.fn(async () => undefined);
  },
}));

vi.mock('electron', () => ({ app: { getVersion: mocks.getVersion } }));

vi.mock('@/process/utils/analyticsId', () => ({
  hasAnalyticsId: mocks.hasAnalyticsId,
  getOrCreateAnalyticsId: mocks.getOrCreateAnalyticsId,
}));

/** Fresh module state without `initAnalytics()` — for tests that own the init call. */
const loadModuleRaw = async () => {
  vi.resetModules();
  return import('@/process/services/analyticsService');
};

const loadModule = async () => {
  const mod = await loadModuleRaw();
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

/**
 * The main-process client has a lifecycle the renderer's does not: it is
 * created after `app.whenReady()` and destroyed on `will-quit`, while
 * `captureAnalytics` is called from module-scope code paths (backend launch,
 * update install) that can run on either side of those two moments.
 */
describe('main-process analytics lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTHOG_DISABLED;
    mocks.getVersion.mockReturnValue('2.1.66');
    mocks.hasAnalyticsId.mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('ignores a capture made before initAnalytics rather than throwing', async () => {
    // `backend_start_failed` fires from the backend launcher, which on a fast
    // machine can lose the race with `app.whenReady()`. A throw here would turn
    // a recoverable backend failure into an unhandled rejection at startup.
    const { captureAnalytics } = await loadModuleRaw();

    expect(() => captureAnalytics('backend_start_failed', { reason: 'spawn_failed' })).not.toThrow();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('captures nothing after shutdownAnalytics, so a flushed client is never reused', async () => {
    // `shutdownAnalytics` runs on `will-quit`; anything that captures during the
    // remaining teardown would enqueue onto a client that will never flush
    // again, and posthog-node throws on a shut-down client.
    const { captureAnalytics, shutdownAnalytics } = await loadModule();
    await shutdownAnalytics();

    expect(() => captureAnalytics('app_closed', { session_seconds: 12 })).not.toThrow();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('keeps a single client when initAnalytics is called twice', async () => {
    // A second client would double-send every subsequent event, inflating every
    // count in PostHog by exactly 2x with no way to tell from the data.
    const mod = await loadModule();
    mod.initAnalytics();

    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(mocks.getOrCreateAnalyticsId).toHaveBeenCalledTimes(1);
  });

  it('does not flip is_first_run when initAnalytics is called twice', async () => {
    // The id file exists after the first init, so re-running the first-run probe
    // would report `false` for a genuinely new install and silently zero out the
    // activation funnel.
    mocks.hasAnalyticsId.mockReturnValueOnce(false).mockReturnValue(true);
    const mod = await loadModule();
    mod.initAnalytics();
    mod.captureAppOpened();

    expect(capturedProperties()).toMatchObject({ is_first_run: true });
  });

  it('creates no client and sends nothing when analytics is disabled', async () => {
    // POSTHOG_DISABLED is the opt-out honoured for forks and privacy-sensitive
    // installs. Constructing the client at all would open the connection and
    // write the analytics id file, which is the thing being opted out of.
    process.env.POSTHOG_DISABLED = '1';
    const mod = await loadModuleRaw();
    mod.initAnalytics();
    mod.captureAppOpened();

    expect(mocks.construct).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('survives app.getVersion() throwing while resolving super properties', async () => {
    // `initAnalytics` is called from main-process bootstrap; `app.getVersion()`
    // throws if Electron is not ready yet. Analytics failing to start must never
    // be able to abort the boot sequence.
    mocks.getVersion.mockImplementation(() => {
      throw new Error('app is not ready');
    });
    const mod = await loadModuleRaw();

    expect(() => mod.initAnalytics()).not.toThrow();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});

/**
 * The super-property merge happens before `scrubEvent`, so the merged bag is
 * what the allowlist and the value rules actually see.
 */
describe('main-process properties at the scrub boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTHOG_DISABLED;
    mocks.getVersion.mockReturnValue('2.1.66');
    mocks.hasAnalyticsId.mockReturnValue(false);
  });

  it('keeps falsy-but-real dimensions and drops only undefined ones', async () => {
    // `ok: false` and `mcp_count: 0` are the failure tail these events exist to
    // measure. Dropping them would leave PostHog with only the successes, so
    // every rate would read as 100%.
    const { captureAnalytics } = await loadModule();

    captureAnalytics('turn_completed', {
      ok: false,
      mcp_count: 0,
      agent_kind: '',
      has_files: null,
      transport: undefined,
    });

    expect(capturedProperties()).toMatchObject({ ok: false, mcp_count: 0, agent_kind: '', has_files: null });
    expect('transport' in capturedProperties()).toBe(false);
  });

  it('drops a property key that is not on the allowlist even when passed explicitly', async () => {
    // The allowlist is the only thing standing between a future call site and
    // shipping user prose to PostHog; merging super properties must not turn the
    // caller's bag into a trusted one.
    const { captureAnalytics } = await loadModule();

    captureAnalytics('message_sent', { agent_kind: 'acp', prompt: 'summarise my medical records' });

    expect(capturedProperties().prompt).toBeUndefined();
    expect(capturedProperties().agent_kind).toBe('acp');
  });
});
