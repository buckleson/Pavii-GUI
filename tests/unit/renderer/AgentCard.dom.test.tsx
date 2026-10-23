/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AgentCard — the assistant-style row used on the Agent
 * settings page. Covers the disabled-agent treatment (a toggled-off custom
 * agent stays visible but greyed), the status tags, and the per-row
 * test-connection / edit actions shared by official and custom agents.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { findOpenSourceCli, type OpenSourceCli } from '@/common/types/agent/openSourceClis';

// Project convention: t() echoes the key so labels are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const { openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/renderer/utils/platform', async () => {
  const actual = await vi.importActual<typeof import('@/renderer/utils/platform')>('@/renderer/utils/platform');
  return { ...actual, openExternalUrl };
});

import AgentCard from '@renderer/pages/settings/AgentSettings/AgentCard';

const baseAgent = {
  id: 'agent-1',
  name: 'Hermes',
  command: '/usr/local/bin/hermes-acp',
  args: ['--remote'],
};

const renderCustom = (
  enabled: boolean,
  handlers: Partial<{ onToggle: (v: boolean) => void; onTestConnection: () => void; onConfigure: () => void }> = {}
) =>
  render(
    <AgentCard
      type='custom'
      agent={{ ...baseAgent, enabled, agent_type: 'acp', agent_source: 'custom', installed: true, status: 'online' }}
      boundAssistants={[]}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onToggle={handlers.onToggle ?? vi.fn()}
      onTestConnection={handlers.onTestConnection ?? vi.fn()}
      onConfigure={handlers.onConfigure ?? vi.fn()}
    />
  );

describe('AgentCard (custom variant)', () => {
  it('greys the identity block and keeps the test-connection action available when the agent is disabled', () => {
    const { container } = renderCustom(false);

    // Disabled => identity block carries the opacity treatment.
    expect(container.querySelector('.opacity-50')).toBeTruthy();
    const testConnection = screen
      .getByText('settings.agentManagement.testConnection')
      .closest('button') as HTMLButtonElement;
    expect(testConnection.disabled).toBe(false);
  });

  it('renders at full opacity with both test-connection and edit actions when enabled', () => {
    const { container } = renderCustom(true);

    expect(container.querySelector('.opacity-50')).toBeNull();
    expect(screen.getByText('settings.agentManagement.testConnection')).toBeTruthy();
    expect(screen.getByText('common.edit')).toBeTruthy();
  });

  it('fires onTestConnection when the test-connection button is clicked', () => {
    const onTestConnection = vi.fn();
    renderCustom(true, { onTestConnection });

    fireEvent.click(screen.getByText('settings.agentManagement.testConnection'));
    expect(onTestConnection).toHaveBeenCalled();
  });

  it('fires onToggle when the switch is clicked', () => {
    const onToggle = vi.fn();
    const { container } = renderCustom(false, { onToggle });

    const toggle = container.querySelector('[role="switch"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalled();
  });
});

const renderOfficial = (
  agent: Record<string, unknown>,
  handlers: Partial<{ onTestConnection: () => void; onConfigure: () => void }> = {}
) =>
  render(
    <AgentCard
      type='official'
      agent={agent as never}
      boundAssistants={[]}
      onTestConnection={handlers.onTestConnection ?? vi.fn()}
      onConfigure={handlers.onConfigure ?? vi.fn()}
    />
  );

describe('AgentCard (official variant)', () => {
  it('shows status tag plus test-connection and edit actions for a missing official agent', () => {
    renderOfficial({
      id: 'claude',
      name: 'Claude Code',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'claude',
      enabled: true,
      installed: false,
      status: 'missing',
      last_check_error_code: 'command_not_found',
      last_check_error_details: { command: 'claude' },
      last_check_error_message: 'CLI command not found',
    });

    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeInTheDocument();
    // F2-02: test-connection stays available in every state, including missing.
    expect(screen.getByText('settings.agentManagement.testConnection')).toBeInTheDocument();
    expect(screen.getByText('common.edit')).toBeInTheDocument();
  });

  it('shows the needs-sign-in status when an offline agent reports auth_required', () => {
    renderOfficial({
      id: 'kimi',
      name: 'Kimi',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'kimi',
      enabled: true,
      installed: true,
      status: 'offline',
      last_check_error_code: 'auth_required',
    });

    // auth_required is split out of the generic offline label.
    expect(screen.getByText('settings.agentManagement.statusNeedsAuth')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.statusOffline')).toBeNull();
  });

  it('shows the unchecked status before an agent has been manually tested', () => {
    renderOfficial({
      id: 'qwen',
      name: 'Qwen',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'qwen',
      enabled: true,
      installed: false,
      status: 'unchecked',
    });

    expect(screen.getByText('settings.agentManagement.statusUnchecked')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.statusUnknown')).toBeNull();
  });

  it('shows the generic unavailable status for a non-auth offline agent', () => {
    renderOfficial({
      id: 'droid',
      name: 'Droid',
      agent_type: 'acp',
      agent_source: 'builtin',
      backend: 'droid',
      enabled: true,
      installed: true,
      status: 'offline',
      last_check_error_code: 'acp_init_failed',
    });

    expect(screen.getByText('settings.agentManagement.statusOffline')).toBeInTheDocument();
    expect(screen.queryByText('settings.agentManagement.statusNeedsAuth')).toBeNull();
  });

  it('fires onTestConnection when an online official agent is tested', () => {
    const onTestConnection = vi.fn();
    renderOfficial(
      {
        id: 'gemini',
        name: 'Gemini CLI',
        agent_type: 'acp',
        agent_source: 'builtin',
        backend: 'gemini',
        enabled: true,
        installed: true,
        status: 'online',
      },
      { onTestConnection }
    );

    fireEvent.click(screen.getByText('settings.agentManagement.testConnection'));
    expect(onTestConnection).toHaveBeenCalled();
  });

  it('fires onConfigure when the edit action is clicked', () => {
    const onConfigure = vi.fn();
    renderOfficial(
      {
        id: 'gemini',
        name: 'Gemini CLI',
        agent_type: 'acp',
        agent_source: 'builtin',
        backend: 'gemini',
        enabled: true,
        installed: true,
        status: 'online',
      },
      { onConfigure }
    );

    fireEvent.click(screen.getByText('common.edit'));
    expect(onConfigure).toHaveBeenCalled();
  });
});

const onlineClaude = {
  id: 'acp-claude',
  name: 'Claude Code',
  agent_type: 'acp',
  agent_source: 'builtin',
  backend: 'claude',
  enabled: true,
  installed: true,
  status: 'online',
};

const renderWithCliUpdate = (cliUpdate?: React.ComponentProps<typeof AgentCard>['cliUpdate']) =>
  render(
    <AgentCard
      type='official'
      agent={onlineClaude as never}
      boundAssistants={[]}
      onTestConnection={vi.fn()}
      onConfigure={vi.fn()}
      cliUpdate={cliUpdate}
    />
  );

const cliResult = (updateAvailable: boolean) => ({
  backend: 'claude',
  name: 'Claude Code',
  installed: true,
  installedVersion: '2.1.300',
  latestVersion: '2.1.301',
  updateAvailable,
  method: 'npm' as const,
  updateCommand: 'npm install -g @anthropic-ai/claude-code@latest',
  checkedAt: 1,
});

describe('AgentCard (CLI update controls)', () => {
  it('renders no update controls when the CLI cannot be updated', () => {
    renderWithCliUpdate(undefined);

    expect(screen.queryByTestId('agent-row-check-update-acp-claude')).toBeNull();
    expect(screen.queryByTestId('agent-row-update-acp-claude')).toBeNull();
    expect(screen.queryByTestId('agent-row-update-badge-acp-claude')).toBeNull();
  });

  it('calls onCheck from the Check update button without opening the configuration page', () => {
    const onCheck = vi.fn();
    const onConfigure = vi.fn();
    render(
      <AgentCard
        type='official'
        agent={onlineClaude as never}
        boundAssistants={[]}
        onTestConnection={vi.fn()}
        onConfigure={onConfigure}
        cliUpdate={{ checking: false, updating: false, onCheck, onUpdate: vi.fn() }}
      />
    );

    fireEvent.click(screen.getByTestId('agent-row-check-update-acp-claude'));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onConfigure).not.toHaveBeenCalled();
  });

  it('keeps the Check update button and hides the badge when the CLI is up to date', () => {
    renderWithCliUpdate({
      result: cliResult(false),
      checking: false,
      updating: false,
      onCheck: vi.fn(),
      onUpdate: vi.fn(),
    });

    expect(screen.getByTestId('agent-row-check-update-acp-claude')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-update-badge-acp-claude')).toBeNull();
  });

  it('shows the update badge and an Update button that calls onUpdate when an update is available', () => {
    const onUpdate = vi.fn();
    renderWithCliUpdate({ result: cliResult(true), checking: false, updating: false, onCheck: vi.fn(), onUpdate });

    expect(screen.getByTestId('agent-row-update-badge-acp-claude')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-row-update-acp-claude'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

type OpenSourceProp = NonNullable<React.ComponentProps<typeof AgentCard>['openSource']>;

const cliFor = (backend: string): OpenSourceCli => {
  const cli = findOpenSourceCli(backend);
  if (!cli) throw new Error(`no open-source CLI for ${backend}`);
  return cli;
};

const osAgent = (overrides: Record<string, unknown> = {}) => ({
  id: 'os-1',
  name: 'OpenCode',
  agent_type: 'acp',
  agent_source: 'builtin',
  backend: 'opencode',
  enabled: true,
  installed: false,
  status: 'missing',
  ...overrides,
});

const osProp = (backend: string, overrides: Partial<OpenSourceProp> = {}): OpenSourceProp => ({
  cli: cliFor(backend),
  installing: false,
  installFailed: false,
  onInstall: vi.fn(),
  ...overrides,
});

const renderOpenSource = (
  agent: Record<string, unknown>,
  openSource: OpenSourceProp | undefined,
  onConfigure: () => void = vi.fn()
) =>
  render(
    <AgentCard
      type='official'
      agent={agent as never}
      boundAssistants={[]}
      onTestConnection={vi.fn()}
      onConfigure={onConfigure}
      openSource={openSource}
    />
  );

describe('AgentCard (open-source extras)', () => {
  it('renders no license, repo, or install controls without the openSource prop', () => {
    renderOpenSource(osAgent(), undefined);

    expect(screen.queryByTestId('agent-row-license-os-1')).toBeNull();
    expect(screen.queryByTestId('agent-row-repo-os-1')).toBeNull();
    expect(screen.queryByTestId('agent-row-install-os-1')).toBeNull();
  });

  it('shows the license tag from the CLI entry', () => {
    renderOpenSource(osAgent(), osProp('opencode'));

    expect(screen.getByTestId('agent-row-license-os-1')).toHaveTextContent('MIT');
  });

  it('opens the repo URL from the repo link without opening the configuration page', () => {
    openExternalUrl.mockClear();
    const onConfigure = vi.fn();
    renderOpenSource(osAgent(), osProp('opencode'), onConfigure);

    fireEvent.click(screen.getByTestId('agent-row-repo-os-1'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/sst/opencode');
    expect(onConfigure).not.toHaveBeenCalled();
  });

  it('calls onInstall from the Install button of a missing npm CLI without opening configuration', () => {
    const onInstall = vi.fn();
    const onConfigure = vi.fn();
    renderOpenSource(osAgent(), osProp('opencode', { onInstall }), onConfigure);

    fireEvent.click(screen.getByTestId('agent-row-install-os-1'));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onConfigure).not.toHaveBeenCalled();
  });

  it('shows an Install guide that opens the docs URL for a missing docs-only CLI', () => {
    openExternalUrl.mockClear();
    renderOpenSource(osAgent({ backend: 'goose', name: 'Goose' }), osProp('goose'));

    expect(screen.queryByTestId('agent-row-install-os-1')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-row-install-guide-os-1'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://goose-docs.ai/docs/getting-started/installation');
  });

  it('shows the npx note and no install actions for a missing npx CLI', () => {
    renderOpenSource(osAgent({ backend: 'pi', name: 'Pi' }), osProp('pi'));

    expect(screen.getByText('settings.agentManagement.openSourceNpx')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-install-os-1')).toBeNull();
    expect(screen.queryByTestId('agent-row-install-guide-os-1')).toBeNull();
  });

  it('hides the Install button once the CLI is installed and online', () => {
    renderOpenSource(osAgent({ status: 'online', installed: true }), osProp('opencode', { installFailed: true }));

    expect(screen.queryByTestId('agent-row-install-os-1')).toBeNull();
    expect(screen.queryByTestId('agent-row-install-help-os-1')).toBeNull();
  });

  it('shows the install help button only after a failed install', () => {
    const { rerender } = renderOpenSource(osAgent(), osProp('opencode'));
    expect(screen.queryByTestId('agent-row-install-help-os-1')).toBeNull();

    rerender(
      <AgentCard
        type='official'
        agent={osAgent() as never}
        boundAssistants={[]}
        onTestConnection={vi.fn()}
        onConfigure={vi.fn()}
        openSource={osProp('opencode', { installFailed: true })}
      />
    );
    expect(screen.getByTestId('agent-row-install-help-os-1')).toBeInTheDocument();
  });

  it('does not render the key control when no providerLink is passed', () => {
    renderOpenSource(osAgent(), osProp('opencode'));

    expect(screen.queryByTestId('agent-row-provider-link-os-1')).toBeNull();
  });
});

const providerLinkFor = (onChange: (id: string | null) => void) => ({
  providers: [
    { id: 'p1', name: 'Provider One' },
    { id: 'p2', name: 'Provider Two' },
  ],
  saving: false,
  onChange,
});

const renderLinked = (linked: string | null, onChange: (id: string | null) => void) => (
  <AgentCard
    type='official'
    agent={osAgent({ status: 'online', installed: true, linked_provider_id: linked }) as never}
    boundAssistants={[]}
    onTestConnection={vi.fn()}
    onConfigure={vi.fn()}
    openSource={osProp('opencode', { providerLink: providerLinkFor(onChange) })}
  />
);

describe('AgentCard (provider key control)', () => {
  it('switching on with no saved link calls onChange with the first provider', () => {
    const onChange = vi.fn();
    render(renderLinked(null, onChange));

    fireEvent.click(screen.getByTestId('agent-row-provider-link-switch-os-1'));
    expect(onChange).toHaveBeenCalledWith('p1');
  });

  it('switching off an existing link calls onChange with null', () => {
    const onChange = vi.fn();
    render(renderLinked('p2', onChange));

    fireEvent.click(screen.getByTestId('agent-row-provider-link-switch-os-1'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('selects the linked provider and follows linked_provider_id changes on rerender', () => {
    const onChange = vi.fn();
    const { rerender } = render(renderLinked('p1', onChange));
    const select = screen.getByTestId('agent-row-provider-link-select-os-1');
    expect(select).toHaveTextContent('Provider One');

    rerender(renderLinked('p2', onChange));
    expect(screen.getByTestId('agent-row-provider-link-select-os-1')).toHaveTextContent('Provider Two');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to the first provider when the saved link points at a provider that is gone', () => {
    const onChange = vi.fn();
    render(renderLinked('deleted-provider', onChange));

    // The switch still reflects the saved (stale) link, so turning it off clears it.
    fireEvent.click(screen.getByTestId('agent-row-provider-link-switch-os-1'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
