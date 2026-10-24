/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the automatic install schedule: nothing runs before the
 * window has loaded and the delay has passed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock('@process/agentCli/recommendedTools/autoInstall', () => ({ runRecommendedToolsAutoInstall: runMock }));

import {
  AUTO_INSTALL_DELAY_MS,
  scheduleRecommendedToolsAutoInstall,
} from '@process/agentCli/recommendedTools/scheduleAutoInstall';

type LoadListener = () => void;

const fakeWindow = () => {
  const listeners: Record<string, LoadListener> = {};
  const once = vi.fn((event: string, listener: LoadListener) => {
    listeners[event] = listener;
  });
  return { window: { webContents: { once } } as unknown as BrowserWindow, listeners, once };
};

beforeEach(() => {
  vi.useFakeTimers();
  runMock.mockReset();
  runMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('scheduleRecommendedToolsAutoInstall', () => {
  it('uses a 60 second delay after load', () => {
    expect(AUTO_INSTALL_DELAY_MS).toBe(60_000);
  });

  it('does nothing before the window finishes loading', async () => {
    const { window, once } = fakeWindow();
    scheduleRecommendedToolsAutoInstall(window);
    await vi.advanceTimersByTimeAsync(AUTO_INSTALL_DELAY_MS * 2);
    expect(once).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    expect(runMock).not.toHaveBeenCalled();
  });

  it('does not run before the delay has passed after load', async () => {
    const { window, listeners } = fakeWindow();
    scheduleRecommendedToolsAutoInstall(window);
    listeners['did-finish-load']();
    await vi.advanceTimersByTimeAsync(AUTO_INSTALL_DELAY_MS - 1);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('runs the automatic install once the delay has passed after load', async () => {
    const { window, listeners } = fakeWindow();
    scheduleRecommendedToolsAutoInstall(window);
    listeners['did-finish-load']();
    await vi.advanceTimersByTimeAsync(AUTO_INSTALL_DELAY_MS);
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
  });

  it('only logs when the automatic install rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runMock.mockRejectedValue(new Error('load failed'));
    const { window, listeners } = fakeWindow();
    scheduleRecommendedToolsAutoInstall(window);
    listeners['did-finish-load']();
    await vi.advanceTimersByTimeAsync(AUTO_INSTALL_DELAY_MS);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[RecommendedTools] automatic install failed:', expect.any(Error))
    );
  });
});
