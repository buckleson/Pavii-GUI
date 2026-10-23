/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The launch-time CLI update check must stay off the startup path: nothing
 * runs until the window has loaded, and then only after AUTO_CHECK_DELAY_MS.
 */

import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runAutoCheck } = vi.hoisted(() => ({ runAutoCheck: vi.fn() }));

vi.mock('@process/agentCli/cliUpdateService', () => ({ runAutoCheck }));

import { AUTO_CHECK_DELAY_MS, scheduleAgentCliAutoCheck } from '@process/agentCli/scheduleAutoCheck';

const makeWindow = () => {
  const listeners = new Map<string, () => void>();
  const window = {
    webContents: {
      once: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
    },
  } as unknown as BrowserWindow;
  return { window, finishLoad: () => listeners.get('did-finish-load')?.() };
};

describe('scheduleAgentCliAutoCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runAutoCheck.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not run the check before the window has finished loading', async () => {
    const { window } = makeWindow();

    scheduleAgentCliAutoCheck(window);
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS * 2);

    expect(runAutoCheck).not.toHaveBeenCalled();
  });

  it('waits the full delay after did-finish-load before running the check', async () => {
    const { window, finishLoad } = makeWindow();
    scheduleAgentCliAutoCheck(window);

    finishLoad();
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS - 1);
    expect(runAutoCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.dynamicImportSettled();
    await vi.waitFor(() => expect(runAutoCheck).toHaveBeenCalledTimes(1));
  });

  it('logs a failed check instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runAutoCheck.mockRejectedValue(new Error('boom'));
    const { window, finishLoad } = makeWindow();
    scheduleAgentCliAutoCheck(window);

    finishLoad();
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS);
    await vi.dynamicImportSettled();

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[AgentCli] auto-check failed:', expect.any(Error)));
  });
});
