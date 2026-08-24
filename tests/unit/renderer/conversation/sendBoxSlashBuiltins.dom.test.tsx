/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `/new` and `/agents` builtin slash commands exist because agent TUIs
 * offer them but the CLIs do not expose them over ACP, so the app maps them
 * onto its own real actions: `/new` navigates to the guid page with
 * `resetAssistant`, `/agents` navigates to the assistants page. These tests
 * render the REAL shared SendBox (mock harness mirrored from
 * sendBoxActiveFocus.dom.test.tsx) with `useNavigate` mocked to capture calls.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashCommandItem } from '@/common/chat/slash/types';

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

// Null conversation context on purpose: `/new` and `/agents` must be
// registered UNCONDITIONALLY, unlike `/copy` (needs a conversation id),
// `/btw` (needs enableBtw) and `/open` (needs onSlashBuiltinCommand).
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => null,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    // 'closed' matches the real hook's idle state; SendBox picks the export
    // menu branch purely by `step`, so 'menu' here would hide the slash menu.
    step: 'closed',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';

const SendBoxHarness = ({ slash_commands }: { slash_commands?: SlashCommandItem[] }) => {
  const [value, setValue] = useState('');
  return (
    <SendBox
      value={value}
      onChange={setValue}
      onSend={vi.fn().mockResolvedValue(undefined)}
      slash_commands={slash_commands}
    />
  );
};

const openSlashMenu = () => {
  const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: '/' } });
  return textarea;
};

const getMenuOptionLabels = () =>
  screen.getAllByRole('option').map((option) => option.querySelector('.text-14px')?.textContent);

describe('SendBox builtin slash commands /new and /agents', () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it('lists /new and /agents when typing / even without a conversation context', () => {
    // They map TUI muscle memory onto app actions, so they must be present in
    // every send box, not only when a conversation or extra wiring exists.
    render(<SendBoxHarness />);
    openSlashMenu();

    const labels = getMenuOptionLabels();
    expect(labels).toContain('/new');
    expect(labels).toContain('/agents');
    // Conditional builtins stay conditional: no conversation id → no /copy.
    expect(labels).not.toContain('/copy');
  });

  it('selecting /new navigates to /guid with resetAssistant and clears the input', () => {
    // Must mirror the sider's new-conversation button exactly — same route,
    // same resetAssistant state — so both entry points behave identically.
    render(<SendBoxHarness />);
    const textarea = openSlashMenu();

    fireEvent.click(screen.getByRole('option', { name: /\/new/ }));

    expect(navigateMock).toHaveBeenCalledWith('/guid', { state: { resetAssistant: true } });
    expect(textarea).toHaveValue('');
  });

  it('selecting /agents navigates to /assistants and clears the input', () => {
    // The assistants page is the app's real surface for choosing an agent;
    // /agents is a builtin (execute), so it must act, not insert text.
    render(<SendBoxHarness />);
    const textarea = openSlashMenu();

    fireEvent.click(screen.getByRole('option', { name: /\/agents/ }));

    expect(navigateMock).toHaveBeenCalledWith('/assistants');
    expect(textarea).toHaveValue('');
  });

  it('does not shadow differently named agent commands and lists ACP commands before builtins', () => {
    // Merge precedence (builtin wins name collisions) must not eat the agent's
    // own commands, and display order puts the agent's commands first because
    // users look for those before app-level extras.
    render(
      <SendBoxHarness
        slash_commands={[
          {
            name: 'review',
            description: 'Review the current diff',
            kind: 'template',
            source: 'acp',
            selectionBehavior: 'insert',
          },
        ]}
      />
    );
    openSlashMenu();

    const labels = getMenuOptionLabels();
    expect(labels).toContain('/review');
    expect(labels).toContain('/new');
    expect(labels).toContain('/agents');
    expect(labels.indexOf('/review')).toBeLessThan(labels.indexOf('/new'));
    expect(labels.indexOf('/review')).toBeLessThan(labels.indexOf('/agents'));
  });

  it('selecting an ACP command inserts it as a template instead of executing a builtin action', () => {
    // Guard the boundary between the two selection behaviors: an agent command
    // must never trigger navigation, and the builtin branch must not swallow it.
    render(
      <SendBoxHarness
        slash_commands={[
          {
            name: 'review',
            description: 'Review the current diff',
            kind: 'template',
            source: 'acp',
            selectionBehavior: 'insert',
          },
        ]}
      />
    );
    const textarea = openSlashMenu();

    fireEvent.click(screen.getByRole('option', { name: /\/review/ }));

    expect(navigateMock).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('/review ');
  });
});
