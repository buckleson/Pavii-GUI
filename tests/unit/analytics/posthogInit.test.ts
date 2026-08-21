/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  analyticsId: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: { init: mocks.init, capture: mocks.capture, identify: mocks.identify, register: mocks.register },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { analyticsId: { invoke: mocks.analyticsId } },
    paviiAuth: { getSession: { invoke: mocks.getSession } },
  },
}));

const loadModule = async () => {
  vi.resetModules();
  return import('@/renderer/services/analytics/posthog');
};

describe('renderer analytics init', () => {
  const previousDisabled = process.env.POSTHOG_DISABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTHOG_DISABLED;
    mocks.analyticsId.mockResolvedValue('install-uuid-1234');
    mocks.getSession.mockResolvedValue(null);
  });

  afterEach(() => {
    if (previousDisabled === undefined) delete process.env.POSTHOG_DISABLED;
    else process.env.POSTHOG_DISABLED = previousDisabled;
  });

  it('does not initialise when POSTHOG_DISABLED is set', async () => {
    process.env.POSTHOG_DISABLED = '1';
    const { initAnalytics } = await loadModule();
    await initAnalytics();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('initialises with the hardened privacy configuration', async () => {
    const { initAnalytics } = await loadModule();
    await initAnalytics();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    const [key, config] = mocks.init.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toMatch(/^phc_/);
    expect(config.api_host).toBe('https://eu.i.posthog.com');

    // The settings that stop user content and remote script from moving.
    expect(config.mask_all_text).toBe(true);
    expect(config.mask_all_element_attributes).toBe(true);
    expect(config.disable_session_recording).toBe(true);
    expect(config.disable_external_dependency_loading).toBe(true);
    expect(config.disable_surveys).toBe(true);
    expect(config.ip).toBe(false);
    expect(typeof config.before_send).toBe('function');

    // Autocapture must be an allowlist, never a bare `true`.
    const autocapture = config.autocapture as { css_selector_allowlist?: string[] };
    expect(autocapture.css_selector_allowlist).toEqual(['[data-ph-capture]']);

    // Pageviews are emitted manually because the app is a HashRouter served
    // from file:// in the packaged build.
    expect(config.capture_pageview).toBe(false);
  });

  it('bootstraps with the shared per-install id so main and renderer events join up', async () => {
    const { initAnalytics } = await loadModule();
    await initAnalytics();
    const [, config] = mocks.init.mock.calls[0] as [string, Record<string, unknown>];
    expect(config.bootstrap).toEqual({ distinctID: 'install-uuid-1234' });
  });

  it('still initialises when the Electron bridge is absent (WebUI browser mode)', async () => {
    mocks.analyticsId.mockRejectedValue(new Error('no bridge'));
    const { initAnalytics } = await loadModule();
    await initAnalytics();
    expect(mocks.init).toHaveBeenCalledTimes(1);
    const [, config] = mocks.init.mock.calls[0] as [string, Record<string, unknown>];
    expect(config).not.toHaveProperty('bootstrap');
  });

  it('identifies the Pavii account by uid and never by email', async () => {
    mocks.getSession.mockResolvedValue({ uid: 'firebase-uid-9', email: 'someone@example.com' });
    const { initAnalytics } = await loadModule();
    await initAnalytics();
    await vi.waitFor(() => expect(mocks.identify).toHaveBeenCalledWith('firebase-uid-9'));
    expect(JSON.stringify(mocks.identify.mock.calls)).not.toContain('someone@example.com');
  });

  it('only initialises once', async () => {
    const { initAnalytics } = await loadModule();
    await initAnalytics();
    await initAnalytics();
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });
});

describe('track()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTHOG_DISABLED;
    mocks.analyticsId.mockResolvedValue('install-uuid-1234');
    mocks.getSession.mockResolvedValue(null);
  });

  it('drops properties that are not allowlisted before they reach posthog', async () => {
    const { initAnalytics, track, ANALYTICS_EVENTS } = await loadModule();
    await initAnalytics();
    track(ANALYTICS_EVENTS.mcpConnected, { transport: 'stdio', serverName: 'my-private-server' });

    const [event, properties] = mocks.capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('mcp_connected');
    expect(properties).toMatchObject({ transport: 'stdio' });
    expect(properties).not.toHaveProperty('serverName');
  });

  it('captures nothing before init', async () => {
    const { track, ANALYTICS_EVENTS } = await loadModule();
    track(ANALYTICS_EVENTS.appOpened, {});
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
