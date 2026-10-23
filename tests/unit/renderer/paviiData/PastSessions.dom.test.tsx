/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalSession, ExternalSessionList } from '@/common/types/agent/paviiData';

const platform = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/platform')>()),
  isElectronDesktop: () => platform.desktop,
}));

// t() echoes the key, followed by interpolated values so they are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}|${Object.values(opts).join('|')}` : k),
    i18n: { language: 'en' },
  }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const { messageError } = vi.hoisted(() => ({ messageError: vi.fn() }));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: { error: messageError, success: vi.fn(), warning: vi.fn() } };
});

const bridge = vi.hoisted(() => ({
  listExternalSessions: vi.fn(),
  importExternalSession: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    paviiData: {
      listExternalSessions: { invoke: bridge.listExternalSessions },
      importExternalSession: { invoke: bridge.importExternalSession },
    },
  },
}));

import PastSessionsButton from '@/renderer/pages/guid/components/PastSessions/PastSessionsButton';
import { emitter } from '@/renderer/utils/emitter';

const FOLDER = 'C:\\work\\my-app';

const session = (overrides: Partial<ExternalSession>): ExternalSession => ({
  backend: 'claude',
  sessionId: 's-1',
  title: 'Fix the build',
  cwd: FOLDER,
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  messageCount: 4,
  ...overrides,
});

const LIST: ExternalSessionList = {
  sessions: [
    session({ backend: 'claude', sessionId: 'claude-1', title: 'Imported one', conversationId: 'conv-imported' }),
    session({ backend: 'codex', sessionId: 'codex-1', title: 'Fresh codex' }),
  ],
  unavailable: [],
  paviiSessions: [],
};

const openDrawer = async (list: ExternalSessionList = LIST) => {
  bridge.listExternalSessions.mockResolvedValue(list);
  render(<PastSessionsButton folder={FOLDER} />);
  fireEvent.click(screen.getByTestId('past-sessions-btn'));
  return screen.findByTestId('past-sessions-drawer');
};

const openButtonFor = (title: string) => {
  const row = screen.getByText(title).closest('[data-testid="past-session-item"]') as HTMLElement;
  return within(row).getByRole('button', { name: 'conversation.paviiData.pastSessions.open' });
};

describe('PastSessionsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.desktop = true;
    bridge.importExternalSession.mockResolvedValue({ success: true, conversationId: 'conv-new', importedMessages: 4 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing outside the desktop app, where the main-process import is unavailable', () => {
    platform.desktop = false;
    render(<PastSessionsButton folder={FOLDER} />);
    expect(screen.queryByTestId('past-sessions-btn')).not.toBeInTheDocument();
  });

  it('renders nothing without a workspace folder', () => {
    render(<PastSessionsButton folder='' />);
    expect(screen.queryByTestId('past-sessions-btn')).not.toBeInTheDocument();
    expect(bridge.listExternalSessions).not.toHaveBeenCalled();
  });

  it('does not load sessions until the drawer is opened', () => {
    render(<PastSessionsButton folder={FOLDER} />);
    expect(screen.getByTestId('past-sessions-btn')).toBeInTheDocument();
    expect(bridge.listExternalSessions).not.toHaveBeenCalled();
  });
});

describe('PastSessionsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.importExternalSession.mockResolvedValue({ success: true, conversationId: 'conv-new', importedMessages: 4 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listing', () => {
    it('loads sessions for the folder and titles the drawer with the folder name', async () => {
      await openDrawer();
      expect(bridge.listExternalSessions).toHaveBeenCalledWith({ folder: FOLDER });
      expect(screen.getByText('conversation.paviiData.pastSessions.title|my-app')).toBeInTheDocument();
    });

    it('tags each session with its CLI and marks only imported ones', async () => {
      await openDrawer();
      expect(screen.getAllByTestId('past-session-item')).toHaveLength(2);
      expect(screen.getByText('conversation.paviiData.pastSessions.backend.claude')).toBeInTheDocument();
      expect(screen.getAllByText('conversation.paviiData.pastSessions.imported')).toHaveLength(1);
    });

    it('shows the empty state when no sessions were found', async () => {
      await openDrawer({ sessions: [], unavailable: [], paviiSessions: [] });
      expect(screen.getByText('conversation.paviiData.pastSessions.empty')).toBeInTheDocument();
      expect(screen.queryByTestId('past-session-item')).not.toBeInTheDocument();
    });

    it('shows a hint for each unavailable source', async () => {
      await openDrawer({
        sessions: [],
        unavailable: [{ backend: 'codex', reason: 'not installed' }],
        paviiSessions: [],
      });
      expect(
        screen.getByText(
          'conversation.paviiData.pastSessions.unavailable|conversation.paviiData.pastSessions.backend.codex|not installed'
        )
      ).toBeInTheDocument();
    });

    it('falls back to the untitled label for a session without a title', async () => {
      await openDrawer({ sessions: [session({ title: '' })], unavailable: [], paviiSessions: [] });
      expect(screen.getByText('conversation.paviiData.pastSessions.untitled')).toBeInTheDocument();
    });

    it('shows the load-failed message when listing sessions fails', async () => {
      bridge.listExternalSessions.mockRejectedValue(new Error('ipc down'));
      render(<PastSessionsButton folder={FOLDER} />);
      fireEvent.click(screen.getByTestId('past-sessions-btn'));
      await waitFor(() => expect(messageError).toHaveBeenCalledWith('conversation.paviiData.pastSessions.loadFailed'));
    });
  });

  describe('opening', () => {
    it('navigates straight to an already-imported session without importing', async () => {
      await openDrawer();
      fireEvent.click(openButtonFor('Imported one'));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/conversation/conv-imported'));
      expect(bridge.importExternalSession).not.toHaveBeenCalled();
    });

    it('imports a new session, refreshes the history and navigates to it', async () => {
      const emit = vi.spyOn(emitter, 'emit');
      await openDrawer();
      fireEvent.click(openButtonFor('Fresh codex'));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/conversation/conv-new'));
      expect(bridge.importExternalSession).toHaveBeenCalledWith({
        folder: FOLDER,
        backend: 'codex',
        sessionId: 'codex-1',
      });
      expect(emit).toHaveBeenCalledWith('chat.history.refresh');
    });

    it('shows the mapped error and stays put when the import fails', async () => {
      bridge.importExternalSession.mockResolvedValue({ success: false, error: 'agent-unavailable' });
      await openDrawer();
      fireEvent.click(openButtonFor('Fresh codex'));
      await waitFor(() =>
        expect(messageError).toHaveBeenCalledWith('conversation.paviiData.pastSessions.errors.agentUnavailable')
      );
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows the import-failed message when the import call throws', async () => {
      bridge.importExternalSession.mockRejectedValue(new Error('ipc down'));
      await openDrawer();
      fireEvent.click(openButtonFor('Fresh codex'));
      await waitFor(() =>
        expect(messageError).toHaveBeenCalledWith('conversation.paviiData.pastSessions.errors.importFailed')
      );
      expect(navigate).not.toHaveBeenCalled();
    });

    it('opens a Pavii session listed from the folder index', async () => {
      await openDrawer({
        sessions: [],
        unavailable: [],
        paviiSessions: [
          {
            conversationId: 'conv-pavii',
            title: 'Pavii chat',
            agentId: null,
            backend: 'claude',
            backendSessionId: null,
            source: 'pavii',
            createdAt: 1,
            lastActiveAt: 2,
          },
        ],
      });
      expect(screen.getByText('conversation.paviiData.pastSessions.paviiTitle')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'conversation.paviiData.pastSessions.open' }));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/conversation/conv-pavii'));
    });
  });
});
