/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Render test for the LocalAgents settings surface. Its purpose is to lock in
 * that LocalAgents reads the management view (`useManagedAgents`) — the
 * include_disabled data path that keeps user-disabled agents listed — and
 * derives the detected/custom sections from it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// t() echoes the key so section labels/buttons are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

const { messageSuccess, messageWarning, messageError } = vi.hoisted(() => ({
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn(),
}));
const { openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      useMessage: () => [
        {
          success: messageSuccess,
          warning: messageWarning,
          error: messageError,
        },
        null,
      ],
      success: messageSuccess,
      warning: messageWarning,
      error: messageError,
    },
  };
});

// Controlled management-view data; assert LocalAgents consumes THIS hook.
const useManagedAgents = vi.fn();
vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgents: () => useManagedAgents(),
}));

// Bridge is only touched by user-action handlers, not on render — stub the
// shape the handlers reference so the import resolves.
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      createCustomAgent: { invoke: vi.fn() },
      updateCustomAgent: { invoke: vi.fn() },
      deleteCustomAgent: { invoke: vi.fn() },
      setAgentEnabled: { invoke: vi.fn() },
      checkManagedAgentHealthById: { invoke: vi.fn() },
    },
    // Bound-assistant avatar stacks fetch the assistant list via SWR.
    assistants: {
      list: { invoke: vi.fn().mockResolvedValue([]) },
    },
    // useAgentCliUpdates reads the persisted state on mount and follows pushes.
    agentCli: {
      getState: { invoke: vi.fn().mockResolvedValue({ results: {} }) },
      stateChanged: { on: vi.fn(() => vi.fn()) },
      check: { invoke: vi.fn() },
      update: { invoke: vi.fn() },
      refreshPath: { invoke: vi.fn().mockResolvedValue(undefined) },
      install: { invoke: vi.fn() },
      setProviderLink: { invoke: vi.fn() },
    },
  },
}));

// Saved providers feed the open-source "Use my Pavii key" control.
const useProvidersQuery = vi.fn((): { data: unknown[] | undefined } => ({ data: [] }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', async () => {
  const actual = await vi.importActual<typeof import('@/renderer/hooks/agent/useModelProviderList')>(
    '@/renderer/hooks/agent/useModelProviderList'
  );
  return { ...actual, useProvidersQuery: () => useProvidersQuery() };
});

vi.mock('@renderer/utils/platform', async () => {
  const actual = await vi.importActual<typeof import('@renderer/utils/platform')>('@renderer/utils/platform');
  return {
    ...actual,
    openExternalUrl,
  };
});

// Keep the test focused on LocalAgents' own logic — stub heavy children.
vi.mock('@/renderer/components/base/AionModal', () => ({ default: () => null }));
vi.mock('@renderer/pages/settings/AgentSettings/InlineAgentEditor', () => ({ default: () => null }));
vi.mock('@renderer/pages/settings/AgentSettings/AgentHubModal', () => ({ AgentHubModal: () => null }));

import LocalAgents from '@renderer/pages/settings/AgentSettings/LocalAgents';
import AgentModalContent from '@renderer/components/settings/SettingsModal/contents/AgentModalContent';
import { SettingsViewModeProvider } from '@renderer/components/settings/SettingsModal/settingsViewContext';
import { ipcBridge } from '@/common';
import { MemoryRouter } from 'react-router-dom';
import { getBoundAssistants } from '@renderer/pages/settings/AgentSettings/BoundAssistants';
import type { Assistant } from '@/common/types/agent/assistantTypes';

const makeAgents = () => [
  {
    id: 'aionrs',
    name: 'Aion CLI',
    agent_type: 'aionrs',
    agent_source: 'internal',
    backend: 'aionrs',
    enabled: true,
    available: true,
    installed: true,
    status: 'online',
  },
  {
    id: 'acp-claude',
    name: 'Claude Code',
    agent_type: 'acp',
    agent_source: 'builtin',
    backend: 'claude',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'openclaw-gateway',
    name: 'OpenClaw Gateway',
    agent_type: 'openclaw-gateway',
    agent_source: 'builtin',
    backend: 'openclaw-gateway',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'custom-1',
    name: 'My Agent',
    agent_type: 'acp',
    agent_source: 'custom',
    command: 'sh',
    enabled: true,
    available: true,
    installed: true,
    status: 'offline',
  },
];

describe('LocalAgents', () => {
  it('runs the health probe and shows a success toast after an official-agent test connection succeeds', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'online',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledWith({ id: 'aionrs' });
    });
    await waitFor(() => {
      expect(refreshCatalog).toHaveBeenCalled();
      expect(messageSuccess).toHaveBeenCalledWith('settings.agentManagement.testConnectionOnline');
    });
  });

  it('refreshes the engine PATH before testing an agent whose CLI is missing', async () => {
    vi.mocked(ipcBridge.agentCli.refreshPath.invoke).mockClear();
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockClear();
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[1],
      status: 'online',
    });

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('agent-row-test-acp-claude'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledWith({ id: 'acp-claude' });
    });
    const refreshOrder = vi.mocked(ipcBridge.agentCli.refreshPath.invoke).mock.invocationCallOrder[0];
    const healthOrder = vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mock
      .invocationCallOrder[0];
    expect(refreshOrder).toBeLessThan(healthOrder);
  });

  it('skips the PATH refresh when testing an agent that is already detected', async () => {
    vi.mocked(ipcBridge.agentCli.refreshPath.invoke).mockClear();
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'online',
    });

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('agent-row-test-aionrs'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledWith({ id: 'aionrs' });
    });
    expect(ipcBridge.agentCli.refreshPath.invoke).not.toHaveBeenCalled();
  });

  it('shows the error toast when the health check fails after a PATH refresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockRejectedValue(new Error('probe'));

    render(<LocalAgents />);
    fireEvent.click(screen.getByTestId('agent-row-test-acp-claude'));

    await waitFor(() => {
      expect(messageError).toHaveBeenCalledWith('settings.agentManagement.testConnectionError');
    });
  });

  it('warns with the auth guidance when a test connection reports auth_required', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'offline',
      last_check_error_code: 'auth_required',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      // formatManagedAgentDiagnosticMessage maps auth_required → its errorCodes key.
      expect(messageWarning).toHaveBeenCalledWith('settings.agentManagement.errorCodes.auth_required');
    });
  });

  it('reads the managed-agents view and renders detected + custom sections', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Proves L30 (useManagedAgents) ran and fed the derived lists.
    expect(useManagedAgents).toHaveBeenCalled();
    expect(screen.getByText('Aion CLI')).toBeTruthy();
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('My Agent')).toBeTruthy();
  });

  it('shows the empty state when no detected agents are present', () => {
    useManagedAgents.mockReturnValue({ agents: [], revalidate: vi.fn(), refreshCatalog: vi.fn() });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.localAgentsEmpty')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customEmpty')).toBeTruthy();
  });

  it('renders official/custom sections with management statuses and removes the chat shortcut', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    // Only Claude Code shows 'missing' now; openclaw-gateway is filtered out as deprecated
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.statusOffline')).toBeTruthy();
    expect(screen.queryByText('settings.agentManagement.goToChat')).toBeNull();
    // Verify deprecated agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
  });

  it('shows a lightweight refresh hint while the management view is revalidating', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      isRefreshing: true,
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.refreshingStatuses')).toBeInTheDocument();
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
  });

  it('renders official agents as diagnostics cards and filters out deprecated types', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Agent names render
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    // Deprecated openclaw-gateway agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
    // Status tags render
    expect(screen.getByText('settings.agentManagement.statusOnline')).toBeInTheDocument();
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeInTheDocument();
  });

  it('does not render the market-install CTA in the diagnostics-only agent page', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.queryByText('settings.agentManagement.installFromMarket')).toBeNull();
    expect(screen.queryByText('settings.agentManagement.discoverMoreAgents')).toBeNull();
  });

  it('renders the setup-guide action for official agents diagnostics', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByText('settings.agentManagement.localAgentsSetupLink'));

    expect(openExternalUrl).toHaveBeenCalledWith('https://www.pavii.tech/products/Super-Assistant/');
  });

  it('binds assistants to managed agents by agent_id instead of runtime backend', () => {
    const [aionrsAgent, claudeAgent] = makeAgents();
    const assistants: Assistant[] = [
      {
        id: 'assistant-on-claude-runtime',
        source: 'generated',
        name: 'Claude Runtime',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 1,
        agent_id: 'acp-other-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
      {
        id: 'assistant-on-claude-agent',
        source: 'generated',
        name: 'Claude Agent',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 2,
        agent_id: 'acp-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
    ];

    expect(getBoundAssistants(claudeAgent, assistants).map((assistant) => assistant.id)).toEqual([
      'assistant-on-claude-agent',
    ]);
    expect(getBoundAssistants(aionrsAgent, assistants)).toEqual([]);
  });

  it('pins Kimi right after the aionrs agent in the official list', () => {
    useManagedAgents.mockReturnValue({
      agents: [
        ...makeAgents(),
        {
          id: 'acp-kimi',
          name: 'Kimi',
          agent_type: 'acp',
          agent_source: 'builtin',
          backend: 'kimi',
          enabled: true,
          available: false,
          installed: false,
          status: 'missing',
        },
      ],
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Alphabetically Claude Code < Kimi, so this order proves the pin rule:
    // aionrs stays first, Kimi jumps ahead of the localeCompare ordering.
    const aion = screen.getByText('Aion CLI');
    const kimi = screen.getByText('Kimi');
    const claude = screen.getByText('Claude Code');
    expect(kimi.compareDocumentPosition(aion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(claude.compareDocumentPosition(kimi) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('renders agent management as a single diagnostics page without local/remote tabs', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/settings/agents?tab=remote']}>
        <SettingsViewModeProvider value='page'>
          <AgentModalContent />
        </SettingsViewModeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.localAgents')).toBeNull();
  });

  it('surfaces custom-agent toggle failures to the user', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog,
    });
    vi.mocked(ipcBridge.acpConversation.setAgentEnabled.invoke).mockRejectedValue({
      backendMessage: 'permission denied',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.setAgentEnabled.invoke).toHaveBeenCalledWith({
        id: 'custom-1',
        enabled: false,
      });
      expect(messageError).toHaveBeenCalledWith('permission denied');
    });
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it('renders the availability filter as underline tabs and switches the visible official agents', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Filter tabs render as buttons (underline-tab style), not an Arco radio group.
    const allTab = screen.getByTestId('settings-tab-all');
    const availableTab = screen.getByTestId('settings-tab-available');
    const unavailableTab = screen.getByTestId('settings-tab-unavailable');
    expect(allTab.tagName).toBe('BUTTON');

    // Default "all": both official agents visible (Aion CLI online, Claude Code missing).
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();

    // "available" keeps only the online agent.
    fireEvent.click(availableTab);
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).toBeNull();

    // "unavailable" keeps only the non-online agent.
    fireEvent.click(unavailableTab);
    expect(screen.queryByText('Aion CLI')).toBeNull();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });
});

const osRow = (id: string, backend: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  agent_type: 'acp',
  agent_source: 'builtin',
  backend,
  enabled: true,
  available: false,
  installed: false,
  status: 'missing',
  ...overrides,
});

// Names sort as Codex < OpenClaw < OpenCode; OPEN_SOURCE_CLIS order is openclaw, opencode, codex.
const makeOpenSourceAgents = (opencodeOverrides: Record<string, unknown> = {}) => [
  ...makeAgents(),
  osRow('acp-codex', 'codex', 'Codex', { status: 'online', installed: true, available: true }),
  osRow('acp-openclaw', 'openclaw', 'OpenClaw'),
  osRow('acp-opencode', 'opencode', 'OpenCode', opencodeOverrides),
];

const OPEN_SOURCE_IDS = ['acp-openclaw', 'acp-opencode', 'acp-codex'];

const mockCatalog = (agents: unknown[], refreshCatalog = vi.fn().mockResolvedValue(undefined)) => {
  useManagedAgents.mockReturnValue({ agents, revalidate: vi.fn(), refreshCatalog });
  return refreshCatalog;
};

const openSourceTab = () => fireEvent.click(screen.getByTestId('settings-tab-openSource'));

const officialRowIds = () =>
  Array.from(
    screen.getByTestId('agent-management-official-section').querySelectorAll('[data-testid^="agent-row-status-"]')
  ).map((node) => (node.getAttribute('data-testid') ?? '').replace('agent-row-status-', ''));

const statusOf = (id: string) => screen.getByTestId(`agent-row-status-${id}`).textContent;

describe('LocalAgents (Open source tab)', () => {
  beforeEach(() => {
    messageError.mockClear();
    messageSuccess.mockClear();
    vi.mocked(ipcBridge.agentCli.install.invoke).mockReset();
    vi.mocked(ipcBridge.agentCli.setProviderLink.invoke).mockReset();
    vi.mocked(ipcBridge.agentCli.refreshPath.invoke).mockClear();
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockReset();
    useProvidersQuery.mockReturnValue({ data: [] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('lists only open-source agents in OPEN_SOURCE_CLIS order', () => {
    mockCatalog(makeOpenSourceAgents());
    render(<LocalAgents />);

    openSourceTab();
    expect(officialRowIds()).toEqual(OPEN_SOURCE_IDS);
  });

  it('shows the same status for each agent as the All tab', () => {
    mockCatalog(makeOpenSourceAgents());
    render(<LocalAgents />);
    const allTabStatuses = OPEN_SOURCE_IDS.map(statusOf);

    openSourceTab();
    expect(OPEN_SOURCE_IDS.map(statusOf)).toEqual(allTabStatuses);
  });

  it('shows open-source extras only on the Open source tab', () => {
    mockCatalog(makeOpenSourceAgents());
    render(<LocalAgents />);
    expect(screen.queryByTestId('agent-row-license-acp-opencode')).toBeNull();

    openSourceTab();
    expect(screen.getByTestId('agent-row-license-acp-opencode')).toBeInTheDocument();
  });

  it('installs the CLI, refreshes the engine PATH, then runs the health check', async () => {
    mockCatalog(makeOpenSourceAgents());
    vi.mocked(ipcBridge.agentCli.install.invoke).mockResolvedValue({ success: true });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...osRow('acp-opencode', 'opencode', 'OpenCode'),
      status: 'online',
    } as never);
    render(<LocalAgents />);
    openSourceTab();

    fireEvent.click(screen.getByTestId('agent-row-install-acp-opencode'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledWith({ id: 'acp-opencode' });
    });
    const installOrder = vi.mocked(ipcBridge.agentCli.install.invoke).mock.invocationCallOrder[0];
    const refreshOrder = vi.mocked(ipcBridge.agentCli.refreshPath.invoke).mock.invocationCallOrder[0];
    const healthOrder = vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mock
      .invocationCallOrder[0];
    expect(ipcBridge.agentCli.install.invoke).toHaveBeenCalledWith({ backend: 'opencode' });
    expect(installOrder < refreshOrder && refreshOrder < healthOrder).toBe(true);
  });

  it('shows an error toast and the install help button when the install reports failure', async () => {
    mockCatalog(makeOpenSourceAgents());
    vi.mocked(ipcBridge.agentCli.install.invoke).mockResolvedValue({ success: false, error: 'npm-missing' });
    render(<LocalAgents />);
    openSourceTab();
    expect(screen.queryByTestId('agent-row-install-help-acp-opencode')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-row-install-acp-opencode'));

    expect(await screen.findByTestId('agent-row-install-help-acp-opencode')).toBeInTheDocument();
    expect(messageError).toHaveBeenCalledWith('settings.agentManagement.openSourceInstallFailed');
  });

  it('skips the PATH refresh and health check when the install reports failure', async () => {
    mockCatalog(makeOpenSourceAgents());
    vi.mocked(ipcBridge.agentCli.install.invoke).mockResolvedValue({ success: false, error: 'timeout' });
    render(<LocalAgents />);
    openSourceTab();

    fireEvent.click(screen.getByTestId('agent-row-install-acp-opencode'));

    await waitFor(() => {
      expect(messageError).toHaveBeenCalledWith('settings.agentManagement.openSourceInstallFailed');
    });
    expect(ipcBridge.agentCli.refreshPath.invoke).not.toHaveBeenCalled();
    expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).not.toHaveBeenCalled();
  });

  it('shows an error toast when the install call throws', async () => {
    mockCatalog(makeOpenSourceAgents());
    vi.mocked(ipcBridge.agentCli.install.invoke).mockRejectedValue(new Error('ipc down'));
    render(<LocalAgents />);
    openSourceTab();

    fireEvent.click(screen.getByTestId('agent-row-install-acp-opencode'));

    await waitFor(() => {
      expect(messageError).toHaveBeenCalledWith('settings.agentManagement.openSourceInstallFailed');
    });
    expect(messageSuccess).not.toHaveBeenCalledWith('settings.agentManagement.openSourceInstallSuccess');
  });

  it('hides the key control when the agent declares no provider platforms', () => {
    mockCatalog(makeOpenSourceAgents({ provider_link_platforms: [] }));
    useProvidersQuery.mockReturnValue({ data: [{ id: 'p1', name: 'P1', platform: 'openai' }] });
    render(<LocalAgents />);
    openSourceTab();

    expect(screen.queryByTestId('agent-row-provider-link-acp-opencode')).toBeNull();
  });

  it('hides the key control when no saved provider matches the agent platforms', () => {
    mockCatalog(makeOpenSourceAgents({ provider_link_platforms: ['anthropic'] }));
    useProvidersQuery.mockReturnValue({ data: [{ id: 'p1', name: 'P1', platform: 'openai' }] });
    render(<LocalAgents />);
    openSourceTab();

    expect(screen.queryByTestId('agent-row-provider-link-acp-opencode')).toBeNull();
  });

  it('hides the key control while providers are still loading', () => {
    mockCatalog(makeOpenSourceAgents({ provider_link_platforms: ['openai'] }));
    useProvidersQuery.mockReturnValue({ data: undefined });
    render(<LocalAgents />);
    openSourceTab();

    expect(screen.queryByTestId('agent-row-provider-link-acp-opencode')).toBeNull();
  });

  it('saves the provider link then refreshes the catalog when the key switch is turned on', async () => {
    const refreshCatalog = mockCatalog(makeOpenSourceAgents({ provider_link_platforms: ['openai'] }));
    useProvidersQuery.mockReturnValue({
      data: [
        { id: 'p-other', name: 'Other', platform: 'anthropic' },
        { id: 'p1', name: 'P1', platform: 'openai' },
      ],
    });
    vi.mocked(ipcBridge.agentCli.setProviderLink.invoke).mockResolvedValue(undefined as never);
    render(<LocalAgents />);
    openSourceTab();

    fireEvent.click(screen.getByTestId('agent-row-provider-link-switch-acp-opencode'));

    await waitFor(() => {
      expect(refreshCatalog).toHaveBeenCalled();
    });
    expect(ipcBridge.agentCli.setProviderLink.invoke).toHaveBeenCalledWith({
      agentId: 'acp-opencode',
      providerId: 'p1',
    });
    expect(vi.mocked(ipcBridge.agentCli.setProviderLink.invoke).mock.invocationCallOrder[0]).toBeLessThan(
      refreshCatalog.mock.invocationCallOrder[0]
    );
  });

  it('shows an error toast and skips the refresh when saving the provider link fails', async () => {
    const refreshCatalog = mockCatalog(makeOpenSourceAgents({ provider_link_platforms: ['openai'] }));
    useProvidersQuery.mockReturnValue({ data: [{ id: 'p1', name: 'P1', platform: 'openai' }] });
    vi.mocked(ipcBridge.agentCli.setProviderLink.invoke).mockRejectedValue(new Error('engine down'));
    render(<LocalAgents />);
    openSourceTab();

    fireEvent.click(screen.getByTestId('agent-row-provider-link-switch-acp-opencode'));

    await waitFor(() => {
      expect(messageError).toHaveBeenCalledWith('settings.agentManagement.providerLinkError');
    });
    expect(refreshCatalog).not.toHaveBeenCalled();
  });
});
