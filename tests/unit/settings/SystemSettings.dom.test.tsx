/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SystemSettings from '@/renderer/pages/settings/SystemSettings';

const mockUseLocation = vi.fn();

vi.mock('react-router-dom', () => ({
  useLocation: () => mockUseLocation(),
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent', () => ({
  default: () => <div data-testid='system-modal-content'>SystemModalContent</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/AboutModalContent', () => ({
  default: () => <div data-testid='about-modal-content'>AboutModalContent</div>,
}));

const platformMocks = vi.hoisted(() => ({ isElectron: false }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => platformMocks.isElectron }));

vi.mock('@/renderer/components/settings/PaviiBackup/BackupRestoreSection', () => ({
  default: () => <div data-testid='backup-restore-section'>BackupRestoreSection</div>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children, contentClassName }: { children: React.ReactNode; contentClassName?: string }) => (
    <div data-testid='settings-page-wrapper' {...(contentClassName ? { 'data-content-class': contentClassName } : {})}>
      {children}
    </div>
  ),
}));

describe('SystemSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMocks.isElectron = false;
  });

  it('renders SystemModalContent when pathname is not /settings/about', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('system-modal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('about-modal-content')).not.toBeInTheDocument();
  });

  it('renders AboutModalContent when pathname is /settings/about', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    expect(screen.getByTestId('about-modal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('system-modal-content')).not.toBeInTheDocument();
  });

  it('applies max-w-640px contentClassName for about page', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    const wrapper = screen.getByTestId('settings-page-wrapper');
    expect(wrapper).toHaveAttribute('data-content-class', 'max-w-640px');
  });

  it('does not apply contentClassName for system page', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    const wrapper = screen.getByTestId('settings-page-wrapper');
    expect(wrapper).not.toHaveAttribute('data-content-class');
  });

  it('wraps content in SettingsPageWrapper', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('settings-page-wrapper')).toBeInTheDocument();
  });

  it('shows the backup & restore section on the system page in the desktop app', () => {
    platformMocks.isElectron = true;
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('backup-restore-section')).toBeInTheDocument();
  });

  it('hides the backup & restore section outside the desktop app', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.queryByTestId('backup-restore-section')).not.toBeInTheDocument();
  });

  it('hides the backup & restore section on the about page even in the desktop app', () => {
    platformMocks.isElectron = true;
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    expect(screen.queryByTestId('backup-restore-section')).not.toBeInTheDocument();
  });
});
