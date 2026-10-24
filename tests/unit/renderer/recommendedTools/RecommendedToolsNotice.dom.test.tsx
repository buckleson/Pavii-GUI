/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallRecommendedToolsResult } from '@/common/types/agent/recommendedTools';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}));

const notify = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
vi.mock('@arco-design/web-react', () => ({ Notification: { success: notify.success, warning: notify.warning } }));

const platform = vi.hoisted(() => ({ isElectron: true }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => platform.isElectron }));

const bridge = vi.hoisted(() => ({
  listeners: [] as Array<(result: InstallRecommendedToolsResult) => void>,
  unsubscribe: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    recommendedTools: {
      autoInstallFinished: {
        on: (listener: (result: InstallRecommendedToolsResult) => void) => {
          bridge.listeners.push(listener);
          return bridge.unsubscribe;
        },
      },
    },
  },
}));

import RecommendedToolsNotice from '@/renderer/components/settings/RecommendedTools/RecommendedToolsNotice';

const finish = (result: InstallRecommendedToolsResult) => bridge.listeners.forEach((listener) => listener(result));

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listeners = [];
  platform.isElectron = true;
});

describe('RecommendedToolsNotice', () => {
  it('renders nothing', () => {
    const { container } = render(<RecommendedToolsNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a success notice with the Pavii names when every tool installed', () => {
    render(<RecommendedToolsNotice />);
    finish({
      outcomes: [
        { id: 'trail', success: true },
        { id: 'reach', success: true },
      ],
    });
    expect(notify.success).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.recommendedTools.autoInstallTitle',
        content: 'settings.recommendedTools.autoInstallDone {"installed":"Pavii Code Map, Pavii Reach"}',
      })
    );
    expect(notify.warning).not.toHaveBeenCalled();
  });

  it('shows a warning that lists installed and failed tools for a partial install', () => {
    render(<RecommendedToolsNotice />);
    finish({
      outcomes: [
        { id: 'headroom', success: true },
        { id: 'graphify', success: false, error: 'timeout' },
      ],
    });
    expect(notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'settings.recommendedTools.autoInstallPartial {"installed":"Pavii Compress","failed":"Pavii Graph"}',
      })
    );
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('shows a failure warning when no tool installed', () => {
    render(<RecommendedToolsNotice />);
    finish({
      outcomes: [
        { id: 'trail', success: false, error: 'npm-missing' },
        { id: 'reach', success: false, error: 'timeout' },
      ],
    });
    expect(notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'settings.recommendedTools.autoInstallFailed {"failed":"Pavii Code Map, Pavii Reach"}',
      })
    );
  });

  it('shows nothing for a result without outcomes', () => {
    render(<RecommendedToolsNotice />);
    finish({ outcomes: [] });
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.warning).not.toHaveBeenCalled();
  });

  it('does not listen outside the desktop app', () => {
    platform.isElectron = false;
    render(<RecommendedToolsNotice />);
    expect(bridge.listeners).toEqual([]);
  });

  it('stops listening on unmount', () => {
    render(<RecommendedToolsNotice />).unmount();
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
