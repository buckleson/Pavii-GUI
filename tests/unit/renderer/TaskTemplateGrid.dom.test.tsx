/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

import TaskTemplateGrid from '@/renderer/pages/cron/ScheduledTasksPage/TaskTemplateGrid';
import { TASK_TEMPLATES } from '@/renderer/pages/cron/ScheduledTasksPage/taskTemplates';

const renderGrid = (onPick = vi.fn()) => {
  render(
    <MemoryRouter>
      <ConfigProvider>
        <TaskTemplateGrid onPick={onPick} />
      </ConfigProvider>
    </MemoryRouter>
  );
  return onPick;
};

afterEach(() => {
  cleanup();
  navigate.mockClear();
});

describe('TaskTemplateGrid', () => {
  it('renders a card for every starter automation', () => {
    renderGrid();
    for (const template of TASK_TEMPLATES) {
      expect(screen.getByTestId(`task-template-${template.id}`), template.id).toBeInTheDocument();
    }
  });

  it('hands the picked template back to the caller', () => {
    const onPick = renderGrid();

    screen.getByTestId('task-template-dailyPlan').click();

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ id: 'dailyPlan', frequency: 'weekdays', time: '08:30' });
  });

  it('shows the prerequisite only on templates that need one', () => {
    renderGrid();

    // These three depend on an MCP server the app does not bundle.
    expect(screen.getByTestId('task-template-inboxSummary-requires')).toBeInTheDocument();
    expect(screen.getByTestId('task-template-slackCatchUp-requires')).toBeInTheDocument();
    expect(screen.getByTestId('task-template-growthReport-requires')).toBeInTheDocument();

    // These work on a fresh install and must not be labelled as blocked.
    expect(screen.queryByTestId('task-template-dailyPlan-requires')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-template-morningBriefing-requires')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-template-projectDigest-requires')).not.toBeInTheDocument();
  });

  it('renders the empty state above the automations', () => {
    renderGrid();
    expect(screen.getByText('No scheduled tasks yet.')).toBeInTheDocument();
  });

  it('gives every automation a hover preview card', () => {
    renderGrid();
    for (const template of TASK_TEMPLATES) {
      expect(screen.getByTestId(`task-template-${template.id}-preview`), template.id).toBeInTheDocument();
    }
  });

  it('opens the template when the row is activated by keyboard', () => {
    const onPick = renderGrid();

    fireEvent.keyDown(screen.getByTestId('task-template-dailyPlan'), { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ id: 'dailyPlan' });
  });

  it('sends the prerequisite link to Tools without also picking the template', () => {
    const onPick = renderGrid();

    screen.getByTestId('task-template-slackCatchUp-requires').click();

    expect(navigate).toHaveBeenCalledWith('/settings/tools');
    expect(onPick).not.toHaveBeenCalled();
  });
});
