/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Avatar, Button, Popover, Select, Switch, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { Delete, EditTwo, Help, Robot } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { resolveAgentAvatar, useAgentLogos } from '@/renderer/utils/model/agentLogo';
import {
  type AgentManagementStatus,
  type ManagedAgent,
  formatManagedAgentDiagnosticMessage,
} from '@/renderer/utils/model/agentTypes';
import type { AgentCliCheckResult } from '@/common/types/agent/agentCliUpdate';
import type { OpenSourceCli } from '@/common/types/agent/openSourceClis';
import { openExternalUrl } from '@/renderer/utils/platform';
import { BoundAssistantStack } from './BoundAssistants';

/** Check-update / update controls, passed only for CLIs Pavii.Ai can update. */
export type AgentCardCliUpdate = {
  result?: AgentCliCheckResult;
  checking: boolean;
  updating: boolean;
  onCheck: () => void;
  onUpdate: () => void;
};

/** Opt-in "Use my Pavii key" control; passed only when a saved provider matches the agent. */
export type AgentCardProviderLink = {
  /** Saved providers whose platform this agent can use. */
  providers: { id: string; name: string }[];
  saving: boolean;
  onChange: (providerId: string | null) => void;
};

/** Open-source tab extras: license, repo link, install actions and the key control. */
export type AgentCardOpenSource = {
  cli: OpenSourceCli;
  installing: boolean;
  /** True after the last install attempt for this agent failed. */
  installFailed: boolean;
  onInstall: () => void;
  providerLink?: AgentCardProviderLink;
};

type AgentCardBaseProps = {
  agent: ManagedAgent;
  boundAssistants: Assistant[];
  onTestConnection: () => void;
  onConfigure: () => void;
  isTesting?: boolean;
  cliUpdate?: AgentCardCliUpdate;
  openSource?: AgentCardOpenSource;
};

type AgentCardProps =
  | (AgentCardBaseProps & { type: 'official' })
  | (AgentCardBaseProps & {
      type: 'custom';
      onEdit: () => void;
      onDelete: () => void;
      onToggle: (enabled: boolean) => void;
    });

const OUTLINE_BUTTON_CLASS =
  '!h-30px !rounded-8px !border-border-2 !bg-base !px-10px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1';

// Card-facing status, finer-grained than the backend's management status:
// the probe reaches `session/new`, so an offline agent that returned
// `auth_required` is "reachable but not signed in" — distinct from a truly
// unreachable agent. We surface that as its own `needs_auth` chip so users
// see "one step away (log in)" vs "broken" vs "not installed".
type DisplayStatus = 'online' | 'needs_auth' | 'offline' | 'missing' | 'unchecked' | 'unknown';

const resolveDisplayStatus = (status?: AgentManagementStatus, errorCode?: string): DisplayStatus => {
  switch (status) {
    case 'online':
      return 'online';
    case 'offline':
      return errorCode === 'auth_required' ? 'needs_auth' : 'offline';
    case 'missing':
      return 'missing';
    case 'unchecked':
      return 'unchecked';
    default:
      return 'unknown';
  }
};

const statusColor = (display: DisplayStatus): 'green' | 'gold' | 'orange' | 'red' | 'gray' => {
  switch (display) {
    case 'online':
      return 'green';
    case 'needs_auth':
      return 'gold';
    case 'offline':
      return 'orange';
    case 'missing':
      return 'red';
    case 'unchecked':
      return 'gray';
    default:
      return 'gray';
  }
};

const statusLabelKey = (display: DisplayStatus) => {
  switch (display) {
    case 'online':
      return 'settings.agentManagement.statusOnline';
    case 'needs_auth':
      return 'settings.agentManagement.statusNeedsAuth';
    case 'offline':
      return 'settings.agentManagement.statusOffline';
    case 'missing':
      return 'settings.agentManagement.statusMissing';
    case 'unchecked':
      return 'settings.agentManagement.statusUnchecked';
    default:
      return 'settings.agentManagement.statusUnknown';
  }
};

const openDocs = (url: string) => {
  void openExternalUrl(url).catch(console.error);
};

const LINK_BUTTON_CLASS =
  '!h-auto !p-0 !text-12px !font-normal !text-primary-6 hover:!text-primary-7 hover:!underline underline-offset-2';

/** Switch + provider picker that opts the agent in to receiving a saved Pavii provider key. */
const ProviderLinkControl: React.FC<{ agent: ManagedAgent; link: AgentCardProviderLink }> = ({ agent, link }) => {
  const { t } = useTranslation();
  const linkedId = agent.linked_provider_id ?? null;
  const fallbackId = link.providers.some((p) => p.id === linkedId) ? linkedId : (link.providers[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(fallbackId);
  const enabled = Boolean(linkedId);
  // Follow the saved link when it changes outside this card (e.g. after a refresh).
  // A link to a provider that is no longer offered (deleted, platform changed) keeps the fallback.
  const linkedIsOffered = link.providers.some((p) => p.id === linkedId);
  useEffect(() => {
    if (linkedId && linkedIsOffered) setSelectedId(linkedId);
  }, [linkedId, linkedIsOffered]);

  return (
    <div data-testid={`agent-row-provider-link-${agent.id}`} className='mt-6px flex flex-col gap-4px'>
      <div className='flex flex-wrap items-center gap-8px'>
        <Switch
          data-testid={`agent-row-provider-link-switch-${agent.id}`}
          size='small'
          checked={enabled}
          loading={link.saving}
          disabled={!selectedId}
          onChange={(checked: boolean) => link.onChange(checked ? selectedId : null)}
        />
        <Typography.Text className='text-12px text-t-primary'>
          {t('settings.agentManagement.providerLinkLabel')}
        </Typography.Text>
        <Select
          data-testid={`agent-row-provider-link-select-${agent.id}`}
          size='mini'
          className='!w-180px'
          value={selectedId ?? undefined}
          placeholder={t('settings.agentManagement.providerLinkPlaceholder')}
          disabled={link.saving}
          options={link.providers.map((p) => ({ label: p.name, value: p.id }))}
          onChange={(value: string) => {
            setSelectedId(value);
            if (enabled && value !== linkedId) link.onChange(value);
          }}
        />
      </div>
      <Typography.Text type='secondary' className='block text-11px leading-16px text-t-tertiary'>
        {t('settings.agentManagement.providerLinkHint', { name: agent.name })}
      </Typography.Text>
    </div>
  );
};

/** License tag, repo link, install hints and the key control shown under the agent name. */
const OpenSourceDetails: React.FC<{ agent: ManagedAgent; openSource: AgentCardOpenSource }> = ({
  agent,
  openSource,
}) => {
  const { t } = useTranslation();
  const { cli } = openSource;
  const isMissing = agent.status === 'missing';

  return (
    <div className='mt-2px' onClick={(event) => event.stopPropagation()}>
      <div className='flex flex-wrap items-center gap-8px'>
        <Tag data-testid={`agent-row-license-${agent.id}`} size='small' className='flex-shrink-0'>
          {cli.license}
        </Tag>
        <Button
          data-testid={`agent-row-repo-${agent.id}`}
          type='text'
          size='mini'
          className={LINK_BUTTON_CLASS}
          onClick={() => openDocs(cli.repoUrl)}
        >
          {t('settings.agentManagement.openSourceRepo')}
        </Button>
        {isMissing && cli.install.kind === 'npx' ? (
          <Typography.Text type='secondary' className='text-11px text-t-tertiary'>
            {t('settings.agentManagement.openSourceNpx')}
          </Typography.Text>
        ) : null}
        {isMissing && cli.install.kind === 'docs' ? (
          <Typography.Text type='secondary' className='text-11px text-t-tertiary'>
            {t('settings.agentManagement.openSourceTestAfterInstall')}
          </Typography.Text>
        ) : null}
      </div>
      {openSource.providerLink ? <ProviderLinkControl agent={agent} link={openSource.providerLink} /> : null}
    </div>
  );
};

/** Install / Install guide actions for a missing open-source CLI. */
const OpenSourceInstallActions: React.FC<{ agent: ManagedAgent; openSource: AgentCardOpenSource }> = ({
  agent,
  openSource,
}) => {
  const { t } = useTranslation();
  const { cli } = openSource;
  if (agent.status !== 'missing') return null;

  if (cli.install.kind === 'docs') {
    return (
      <Button
        data-testid={`agent-row-install-guide-${agent.id}`}
        size='small'
        type='outline'
        onClick={() => openDocs(cli.docsUrl)}
        className={OUTLINE_BUTTON_CLASS}
      >
        {t('settings.agentManagement.openSourceInstallGuide')}
      </Button>
    );
  }
  if (cli.install.kind !== 'npm') return null;

  return (
    <>
      <Button
        data-testid={`agent-row-install-${agent.id}`}
        size='small'
        type='primary'
        loading={openSource.installing}
        onClick={openSource.onInstall}
        className='!h-30px !rounded-8px !px-10px !text-12px !font-500'
      >
        {t('settings.agentManagement.openSourceInstall')}
      </Button>
      {openSource.installFailed ? (
        <Popover
          trigger='click'
          position='top'
          content={
            <div className='flex max-w-260px flex-col items-start gap-6px text-12px'>
              <Typography.Text className='text-12px text-t-primary'>
                {t('settings.agentManagement.openSourceInstallHelp', { name: agent.name })}
              </Typography.Text>
              <Button type='text' size='mini' className={LINK_BUTTON_CLASS} onClick={() => openDocs(cli.docsUrl)}>
                {t('settings.agentManagement.openSourceInstallDocs')}
              </Button>
            </div>
          }
        >
          <Button
            data-testid={`agent-row-install-help-${agent.id}`}
            size='small'
            type='text'
            aria-label={t('settings.agentManagement.openSourceInstallHelpLabel')}
            icon={<Help theme='outline' size='16' />}
            className='!h-30px !w-30px !text-t-secondary'
          />
        </Popover>
      ) : null}
    </>
  );
};

/**
 * Single agent row. Clicking anywhere on the row opens the configuration /
 * editor page; inner controls call `stopPropagation` so they don't trigger
 * the row navigation. Official and custom agents share the same row layout;
 * custom agents add an enable switch and a delete action.
 */
const AgentCard: React.FC<AgentCardProps> = (props) => {
  const { t } = useTranslation();
  const logos = useAgentLogos();
  const { agent, boundAssistants, onTestConnection, onConfigure, isTesting, cliUpdate, openSource } = props;
  const updateAvailable = Boolean(cliUpdate?.result?.updateAvailable);

  const isCustom = props.type === 'custom';
  const isDisabled = isCustom && agent.enabled === false;
  const diagnostics = formatManagedAgentDiagnosticMessage(t, agent);
  const displayStatus = resolveDisplayStatus(agent.status, agent.last_check_error_code);

  const avatar = resolveAgentAvatar(logos, {
    icon: agent.avatar || agent.icon,
    backend: agent.backend || agent.agent_type,
    custom_agent_id: agent.custom_agent_id,
    isExtension: agent.isExtension,
  });

  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <div
      data-testid={`agent-row-${agent.id}`}
      className='group flex cursor-pointer items-center justify-between gap-12px rounded-12px border border-solid border-transparent bg-base px-14px py-10px transition-all duration-180 hover:border-border-1 hover:bg-fill-1'
      onClick={onConfigure}
    >
      <div className={`flex min-w-0 flex-1 items-center gap-12px ${isDisabled ? 'opacity-50' : ''}`}>
        <Avatar
          size={32}
          shape='square'
          style={{ flexShrink: 0, backgroundColor: avatar.kind === 'image' ? 'transparent' : 'var(--color-fill-2)' }}
        >
          {avatar.kind === 'image' ? (
            <img src={avatar.value} alt={agent.name} className='h-full w-full object-contain' />
          ) : avatar.kind === 'emoji' ? (
            <span className='text-18px leading-none'>{avatar.value}</span>
          ) : (
            <Robot theme='outline' size='18' />
          )}
        </Avatar>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-8px'>
            <Typography.Text className='truncate text-14px font-medium text-t-primary'>{agent.name}</Typography.Text>
            <Tag
              data-testid={`agent-row-status-${agent.id}`}
              size='small'
              color={statusColor(displayStatus)}
              className='flex-shrink-0'
            >
              {t(statusLabelKey(displayStatus))}
            </Tag>
            {updateAvailable && (
              <Tag
                data-testid={`agent-row-update-badge-${agent.id}`}
                size='small'
                color='arcoblue'
                className='flex-shrink-0'
              >
                {t('settings.agentManagement.updateAvailable')}
              </Tag>
            )}
            {diagnostics && (
              <Tooltip content={diagnostics}>
                <Typography.Text className='flex-shrink-0 text-11px text-t-secondary'>ⓘ</Typography.Text>
              </Tooltip>
            )}
          </div>
          {openSource ? <OpenSourceDetails agent={agent} openSource={openSource} /> : null}
        </div>
      </div>

      <div className='ml-12px flex flex-shrink-0 items-center gap-8px' onClick={stop}>
        <BoundAssistantStack assistants={boundAssistants} />
        {openSource ? <OpenSourceInstallActions agent={agent} openSource={openSource} /> : null}
        {cliUpdate ? (
          updateAvailable ? (
            <Button
              data-testid={`agent-row-update-${agent.id}`}
              size='small'
              type='primary'
              loading={cliUpdate.updating}
              onClick={cliUpdate.onUpdate}
              className='!h-30px !rounded-8px !px-10px !text-12px !font-500'
            >
              {t('settings.agentManagement.updateTo', { version: cliUpdate.result?.latestVersion })}
            </Button>
          ) : (
            <Button
              data-testid={`agent-row-check-update-${agent.id}`}
              size='small'
              type='outline'
              loading={cliUpdate.checking}
              onClick={cliUpdate.onCheck}
              className={OUTLINE_BUTTON_CLASS}
            >
              {t('settings.agentManagement.checkUpdate')}
            </Button>
          )
        ) : null}
        <Button
          data-testid={`agent-row-test-${agent.id}`}
          size='small'
          type='outline'
          loading={isTesting}
          onClick={onTestConnection}
          className='!h-30px !rounded-8px !border-border-2 !bg-base !px-10px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
        >
          {t('settings.agentManagement.testConnection')}
        </Button>
        {/* Both agent kinds get an explicit Edit button that opens the same
            configuration page the whole row links to (status, path/env
            overrides, bound assistants). */}
        <Button
          data-testid={`agent-row-edit-${agent.id}`}
          size='small'
          type='outline'
          onClick={onConfigure}
          className='!h-30px !rounded-8px !border-border-2 !bg-base !px-10px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
        >
          {t('common.edit', { defaultValue: 'Edit' })}
        </Button>
        {props.type === 'custom' ? (
          <>
            {/* Custom agents add the definition editor (command/args/env) plus
                enable/delete — controls that have no meaning for built-ins. */}
            <Switch size='small' checked={agent.enabled !== false} onChange={props.onToggle} />
            <Button
              size='small'
              type='outline'
              icon={<EditTwo theme='outline' size='14' />}
              onClick={props.onEdit}
              className='!h-30px !rounded-8px !border-border-2 !bg-base !text-t-primary hover:!border-border-1 hover:!bg-fill-1'
            />
            <Button
              size='small'
              type='outline'
              status='danger'
              icon={<Delete theme='outline' size='14' />}
              onClick={props.onDelete}
              className='!h-30px !rounded-8px !border-danger-2 !bg-base'
            />
          </>
        ) : null}
      </div>
    </div>
  );
};

export default AgentCard;
