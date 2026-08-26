/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * The welcome screen's quick-action pills. guidPage.dom.test.tsx mocks this
 * component away, so until now its labels and destinations had no coverage —
 * which is how "Give us a star" could silently point anywhere.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import QuickActionButtons from '@/renderer/pages/guid/components/QuickActionButtons';

const getStatus = vi.hoisted(() => vi.fn().mockResolvedValue({ running: false }));

vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: {
    getStatus: { invoke: getStatus },
    statusChanged: { on: vi.fn(() => () => {}) },
  },
}));

vi.mock('@icon-park/react', () => ({
  Earth: () => <span data-testid='earth-icon' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'conversation.welcome.quickActionTellUs') return 'Tell us how you feel about the product';
      if (key === 'conversation.welcome.quickActionFeedback') return 'Report Issue';
      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../packages/desktop/src/renderer/pages/guid/index.module.css', () => ({ default: {} }));

describe('welcome quick-action pills', () => {
  const renderPills = (onOpenLink = vi.fn()) => {
    render(
      <QuickActionButtons
        onOpenLink={onOpenLink}
        onOpenBugReport={vi.fn()}
        inactiveBorderColor='#eee'
        activeShadow='none'
      />
    );
    return onOpenLink;
  };

  it('offers the feedback-call pill and opens the cal.com booking link', () => {
    const onOpenLink = renderPills();

    const label = screen.getByText('Tell us how you feel about the product');
    expect(label).toBeInTheDocument();

    fireEvent.click(label.closest('div') as HTMLElement);
    expect(onOpenLink).toHaveBeenCalledWith('https://cal.com/buckleson-group/30min?overlayCalendar=true');
  });

  it('no longer carries the give-us-a-star copy or the old product-page link', () => {
    const onOpenLink = renderPills();

    expect(screen.queryByText(/give us a star/i)).toBeNull();
    fireEvent.click(screen.getByText('Tell us how you feel about the product').closest('div') as HTMLElement);
    expect(onOpenLink).not.toHaveBeenCalledWith('https://www.pavii.tech/products/Super-Assistant/');
  });
});
