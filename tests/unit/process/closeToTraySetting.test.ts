/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCloseToTraySetting } from '@/process/utils/closeToTraySetting';
import { httpRequest } from '@/common/adapter/httpBridge';
import { ProcessConfig } from '@/process/utils/initStorage';

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: vi.fn(),
}));

vi.mock('@/process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const httpRequestMock = vi.mocked(httpRequest);
const processConfigGetMock = vi.mocked(ProcessConfig.get);

describe('readCloseToTraySetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processConfigGetMock.mockResolvedValue(undefined);
    httpRequestMock.mockResolvedValue({});
  });

  it('defaults to background mode when no saved setting exists', async () => {
    await expect(readCloseToTraySetting()).resolves.toBe(true);
  });

  it('preserves an explicit local opt-out', async () => {
    processConfigGetMock.mockResolvedValue(false);

    await expect(readCloseToTraySetting()).resolves.toBe(false);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });
});
