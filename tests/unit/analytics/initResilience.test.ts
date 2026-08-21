/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

/**
 * `initAnalytics()` is called at renderer module scope in `main.tsx`, and
 * `track()` sits inline in send/create paths. Neither may take the app down.
 */
describe('analytics never breaks the app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTHOG_DISABLED;
    mocks.analyticsId.mockResolvedValue('install-uuid');
    mocks.getSession.mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('resolves rather than rejecting when posthog.init throws', async () => {
    mocks.init.mockImplementation(() => {
      throw new Error('posthog exploded');
    });
    const { initAnalytics } = await loadModule();
    await expect(initAnalytics()).resolves.toBeUndefined();
  });

  it('captures nothing after a failed init, instead of throwing on every action', async () => {
    mocks.init.mockImplementation(() => {
      throw new Error('posthog exploded');
    });
    const { initAnalytics, track, ANALYTICS_EVENTS } = await loadModule();
    await initAnalytics();
    expect(() => track(ANALYTICS_EVENTS.conversationStarted, { agent_kind: 'acp' })).not.toThrow();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('swallows a capture failure so the triggering action still completes', async () => {
    mocks.init.mockImplementation(() => undefined);
    mocks.capture.mockImplementation(() => {
      throw new Error('network down');
    });
    const { initAnalytics, track, trackPageview, ANALYTICS_EVENTS } = await loadModule();
    await initAnalytics();
    expect(() => track(ANALYTICS_EVENTS.messageSent, { agent_kind: 'acp' })).not.toThrow();
    expect(() => trackPageview('/guid')).not.toThrow();
  });

  it('still initialises when the auth session lookup fails', async () => {
    mocks.init.mockImplementation(() => undefined);
    mocks.getSession.mockRejectedValue(new Error('no session'));
    const { initAnalytics } = await loadModule();
    await expect(initAnalytics()).resolves.toBeUndefined();
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });
});
