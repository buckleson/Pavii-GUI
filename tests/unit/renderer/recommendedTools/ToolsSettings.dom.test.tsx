/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const platform = vi.hoisted(() => ({ isElectron: true }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => platform.isElectron }));

vi.mock('@/renderer/components/settings/SettingsModal/contents/ToolsModalContent', () => ({
  default: () => <div data-testid='tools-modal-content' />,
}));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/ToolsSettings/RecommendedToolsSection', () => ({
  default: () => <div data-testid='recommended-tools-section' />,
}));

import ToolsSettings from '@/renderer/pages/settings/ToolsSettings';

describe('ToolsSettings: recommended tools section', () => {
  beforeEach(() => {
    platform.isElectron = true;
  });

  it('shows the recommended tools section in the desktop app', () => {
    render(<ToolsSettings />);
    expect(screen.getByTestId('recommended-tools-section')).toBeInTheDocument();
  });

  it('hides the recommended tools section outside the desktop app', () => {
    platform.isElectron = false;
    render(<ToolsSettings />);
    expect(screen.queryByTestId('recommended-tools-section')).not.toBeInTheDocument();
  });

  it('keeps the MCP tools content outside the desktop app', () => {
    platform.isElectron = false;
    render(<ToolsSettings />);
    expect(screen.getByTestId('tools-modal-content')).toBeInTheDocument();
  });
});
