import { Message, Modal, Spin } from '@arco-design/web-react';
import { FullScreen, Left, OffScreen, Peoples, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { ipcBridge } from '@/common';
import type { TeamAssistant, TTeam } from '@/common/types/team/teamTypes';
import type { IProvider, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import { classifyConfigSetError, useAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';
import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';
import ChatSlider from '@renderer/pages/conversation/components/ChatSlider.tsx';
import { useTeamPendingPermissions } from './hooks/useTeamPendingPermissions';
import { buildTeamRetryStartHandler } from './components/teamSendRuntime';
import AcpModelSelector, { type AcpWarmupStatus } from '@/renderer/components/agent/AcpModelSelector';
import AionrsModelSelector from '@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { CronJobManager } from '@/renderer/pages/cron';
import { resolveCronJobId } from '@/renderer/pages/cron/cronUtils';
import TeamTabs from './components/TeamTabs';
import TeamChatView from './components/TeamChatView';
import TeamAgentIdentity from './components/TeamAgentIdentity';
import TeamViewToggle from './components/TeamViewToggle';
import TeamActivityView from './activity/TeamActivityView';
import TeamWarmupOverlay from './components/TeamWarmupOverlay';
import { useTeamViewMode } from './hooks/useTeamViewMode';
import { useTeamWarmup, type TeamWarmupMemberState, type TeamWarmupPhase } from './hooks/useTeamWarmup';
import { TeamTabsProvider, useTeamTabs } from './hooks/TeamTabsContext';
import { TeamIdentityProvider } from './identity/TeamIdentityContext';
import { TeamPermissionProvider, useTeamPermission } from './hooks/TeamPermissionContext';
import { useTeamSession } from './hooks/useTeamSession';
import { useTeamRunView, type TeamRunViewState } from './hooks/useTeamRunView';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useActiveLease } from '@/renderer/pages/conversation/hooks/useActiveLease';
import { resolveTeamWorkspaceView } from './utils/teamWorkspaceView';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { previewScopeKey } from '@/renderer/pages/conversation/Preview/context/previewScope';
import { setCurrentProject } from '@/renderer/pages/conversation/explorer/currentProjectStore';
import { setCurrentConversation } from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { getSnapshotConversationProjectId } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

type Props = {
  team: TTeam;
};

const NON_ACP_BACKENDS = new Set(['aionrs', 'openclaw-gateway', 'nanobot', 'remote']);

function isAcpLikeBackend(backend: string | undefined): boolean {
  if (!backend) return false;
  return !NON_ACP_BACKENDS.has(backend);
}

type TeamPageContentProps = {
  team: TTeam;
  onRenameTeam: (new_name: string) => Promise<boolean>;
  warmupPhase: TeamWarmupPhase;
  warmupRuntimeStatus: Map<string, TeamWarmupMemberState>;
  onRetryWarmup: () => void;
};

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

/** Compact aionrs model selector for the agent header */
const AionrsHeaderModelSelector: React.FC<{ conversation_id: string; initialModel?: TProviderWithModel }> = ({
  conversation_id,
  initialModel,
}) => {
  const { t } = useTranslation();
  const teamPermission = useTeamPermission();
  const onSelectModel = useCallback(
    async (_provider: IProvider, modelName: string) => {
      const selected = { ..._provider, use_model: modelName } as TProviderWithModel;
      const ok = await ipcBridge.conversation.update.invoke({ id: conversation_id, updates: { model: selected } });
      return Boolean(ok);
    },
    [conversation_id]
  );
  const modelSelection = useAionrsModelSelection({ initialModel, onSelectModel });
  const runtimeConfig = useAcpConfigOptions({
    conversation_id,
    prepareSetRuntime: teamPermission?.warmupSession,
    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: Boolean(conversation_id),
  });
  const handleThoughtLevelSetOption = useCallback(
    async (optionId: string, value: string) => {
      try {
        const result = await runtimeConfig.setConfigOption(optionId, value);
        Message.success(t('agent.thoughtLevel.switchSuccess'));
        return result;
      } catch (error) {
        Message.error(t(configErrorMessageKey(error)));
        throw error;
      }
    },
    [runtimeConfig, t]
  );
  return (
    <AionrsModelSelector
      selection={modelSelection}
      thoughtLevel={runtimeConfig.thoughtLevel}
      setStatus={runtimeConfig.setStatus}
      onSetThoughtLevel={handleThoughtLevelSetOption}
    />
  );
};

/** Fetches conversation for a single assistant and renders TeamChatView */
const AssistantChatSlot: React.FC<{
  assistant: TeamAssistant;
  team_id: string;
  isLeader: boolean;
  /** Member identity colour, used for the column header name and a faint column background. */
  color: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  teamRunView: TeamRunViewState;
  onTeamRunAck: ReturnType<typeof useTeamRunView>['applyAck'];
  onRunStateStale: ReturnType<typeof useTeamRunView>['reconcile'];
  /** A teammate's real warmup state; absent means 'dormant'. Not passed in single-chat view. */
  warmupStatus?: AcpWarmupStatus;
  /** True while the whole team is warming, during which manual triggers are withheld. */
  warmupDisabled?: boolean;
}> = ({
  assistant,
  team_id,
  isLeader,
  color,
  isFullscreen = false,
  onToggleFullscreen,
  teamRunView,
  onTeamRunAck,
  onRunStateStale,
  warmupStatus,
  warmupDisabled,
}) => {
  const layout = useLayoutContext();
  const teamPermission = useTeamPermission();
  const isMobile = layout?.isMobile ?? false;
  const { data: conversation } = useSWR(
    assistant.conversation_id ? ['team-conversation', assistant.conversation_id] : null,
    () => getConversationOrNull(assistant.conversation_id)
  );

  const isAionrs = conversation?.type === 'aionrs';
  const initialModelId = (conversation?.extra as { current_model_id?: string })?.current_model_id;
  const isAcpLike = conversation?.type === 'acp' || isAcpLikeBackend(assistant.assistant_backend);
  const cronJobId = resolveCronJobId(conversation?.extra);
  // Reuse the existing single-teammate attach/warmup path; withhold the trigger
  // while the whole team is warming so manual wake is gated by phase.
  const warmup = useMemo<{ status: AcpWarmupStatus; trigger?: () => Promise<void> }>(
    () => ({
      status: warmupStatus ?? 'dormant',
      trigger: warmupDisabled ? undefined : buildTeamRetryStartHandler({ team_id, slot_id: assistant.slot_id }),
    }),
    [warmupStatus, warmupDisabled, team_id, assistant.slot_id]
  );
  // The header takes no identity-colour background, which would dull the coloured name; identity there rests on the name alone.
  // The column body keeps a very faint identity tint as a weak cue, without affecting bubble readability.
  return (
    <div className='flex flex-col h-full' style={{ background: `color-mix(in srgb, ${color} 4%, var(--bg-base))` }}>
      <div className='flex items-center justify-between gap-8px px-12px h-40px shrink-0 border-b border-solid border-[color:var(--border-base)] relative z-10 bg-1'>
        <TeamAgentIdentity
          assistant_name={assistant.assistant_name}
          assistant_backend={assistant.assistant_backend}
          icon={assistant.icon}
          conversation_id={assistant.conversation_id}
          isLeader={isLeader}
          className='min-w-0'
          nameClassName='text-13px font-600'
          nameStyle={{ color }}
        />
        <div className='flex items-center gap-8px shrink-0'>
          {conversation && <CronJobManager conversation_id={conversation.id} cron_job_id={cronJobId} />}
          {!isMobile && assistant.conversation_id && !isAionrs && isAcpLike && (
            <div className='min-w-0 max-w-140px [&_button]:max-w-full [&_button_span]:truncate'>
              <AcpModelSelector
                key={assistant.conversation_id}
                conversation_id={assistant.conversation_id}
                backend={assistant.assistant_backend}
                initialModelId={initialModelId}
                prepareSetRuntime={teamPermission?.warmupSession}
                loadConfigOptions={teamPermission?.loadConfigOptions}
                warmup={warmup}
              />
            </div>
          )}
          {!isMobile && isAionrs && assistant.conversation_id && (
            <div className='min-w-0 max-w-140px [&_button]:max-w-full [&_button_span]:truncate'>
              <AionrsHeaderModelSelector
                key={assistant.conversation_id}
                conversation_id={assistant.conversation_id}
                initialModel={conversation?.model as TProviderWithModel | undefined}
              />
            </div>
          )}
          {/* Removal lives on the top pills (team-tab-remove-*); the header no longer repeats an X. */}
          <div
            className='shrink-0 flex items-center justify-center leading-none cursor-pointer hover:bg-[var(--fill-3)] p-4px rd-4px text-[color:var(--color-text-3)] hover:text-[color:var(--color-text-1)] transition-colors'
            onClick={() => onToggleFullscreen?.()}
          >
            {isFullscreen ? <OffScreen size='16' fill='currentColor' /> : <FullScreen size='16' fill='currentColor' />}
          </div>
        </div>
      </div>
      <div className='relative flex flex-col flex-1 min-h-0'>
        {conversation ? (
          <TeamChatView
            conversation={conversation as TChatConversation}
            team_id={team_id}
            slot_id={assistant.slot_id}
            assistant_name={assistant.assistant_name}
            assistant_backend={assistant.assistant_backend}
            agent_icon={assistant.icon}
            isLeader={isLeader}
            teamRunView={teamRunView}
            onTeamRunAck={onTeamRunAck}
            onRunStateStale={() => onRunStateStale('pause.stale')}
          />
        ) : (
          <div className='flex flex-1 items-center justify-center'>
            <Spin loading />
          </div>
        )}
      </div>
    </div>
  );
};

/** Inner component that reads active tab from context and renders the chat layout */
const TeamPageContent: React.FC<TeamPageContentProps> = ({
  team,
  onRenameTeam,
  warmupPhase,
  warmupRuntimeStatus,
  onRetryWarmup,
}) => {
  const { t } = useTranslation();
  useActiveLease({ type: 'team', id: team.id });
  const { assistants, activeSlotId, switchTab, colorOf, colorOfConversation } = useTeamTabs();
  const [, messageContext] = Message.useMessage({ maxCount: 1 });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const assistantRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  // View mode (parallel or single chat), remembered per team. Single chat fills the screen with the selected member.
  const [viewMode, setViewMode] = useTeamViewMode(team.id);
  const isSingleView = viewMode === 'single';

  const activeAssistant = assistants.find((assistant) => assistant.slot_id === activeSlotId);
  const leadAssistant = assistants.find((assistant) => assistant.role === 'leader');
  const teamRun = useTeamRunView(team.id);

  // Entering a team warms it up, gated on the whole team session being ready (ensureSession resolving means everyone succeeded). The overlay covers the conversation area.
  // runtimeStatus carries the real per-member wake signals, driving the overlay avatars from waking to lit and locating failures.
  // Membership edits are disabled only while waking; on error or timeout they reopen so the user can remove the failed member and recover.
  const isWarmingUp = warmupPhase === 'warming';

  const leaderConversationId = leadAssistant?.conversation_id ?? '';
  const isLeaderAssistant = activeAssistant?.role === 'leader';
  const allConversationIds = useMemo(
    () => assistants.map((assistant) => assistant.conversation_id).filter(Boolean),
    [assistants]
  );

  // Fetch leader assistant's conversation for the workspace sider. Its
  // project_id (populated by the shared mapper) is the team's project.
  const { data: dispatchConversation, mutate: mutateDispatchConversation } = useSWR(
    leadAssistant?.conversation_id ? ['team-conversation', leadAssistant.conversation_id] : null,
    () => getConversationOrNull(leadAssistant!.conversation_id)
  );
  const leaderConversationIdForProject = leadAssistant?.conversation_id;
  // Prefer the synchronous list-snapshot project id for the leader conversation
  // so switching teams publishes the project immediately. `dispatchConversation`
  // is an async SWR fetch that previously lagged the switch, leaving the prior
  // team's Explorer tree painted until it resolved. Snapshot miss (cold start /
  // row not yet loaded) falls back to the fetched conversation's project_id.
  const snapshotTeamProjectId = leaderConversationIdForProject
    ? getSnapshotConversationProjectId(leaderConversationIdForProject)
    : undefined;
  const teamProjectId =
    snapshotTeamProjectId !== undefined ? snapshotTeamProjectId : (dispatchConversation?.project_id ?? null);

  // Publish the team's project so the Layout-level Explorer host renders it —
  // mirrors conversation/index.tsx (project-scoped, persistent across agent-tab
  // switches; the Explorer host does not remount within the same team/project).
  useEffect(() => {
    setCurrentProject(teamProjectId);
  }, [teamProjectId]);

  // Publish the active member column's conversation id so the Explorer's "add to
  // chat" targets the focused column's send box (activeSlotId defaults to the
  // leader; every column is a real agent conversation). Only meaningful once the
  // team is project-bound (host visible).
  useEffect(() => {
    setCurrentConversation(teamProjectId ? (activeAssistant?.conversation_id ?? null) : null);
  }, [teamProjectId, activeAssistant?.conversation_id]);

  // Backfill catch-up: the leader conversation lazily backfills its project_id on
  // resume and the backend emits one `conversation.listChanged` when it lands;
  // refetch the leader conversation so the populated project_id flows through.
  // (Same responsive path as conversation/index.tsx — no polling.)
  useEffect(() => {
    if (!leaderConversationIdForProject) return;
    return ipcBridge.conversation.listChanged.on((event) => {
      if (event.conversation_id !== leaderConversationIdForProject) return;
      if (event.action !== 'updated' && event.action !== 'created') return;
      void mutateDispatchConversation();
    });
  }, [leaderConversationIdForProject, mutateDispatchConversation]);

  // Use team workspace if specified, otherwise fall back to leader assistant's conversation workspace (temp workspace)
  const teamWorkspaceView = resolveTeamWorkspaceView(
    team.workspace,
    (dispatchConversation?.extra as { workspace?: string } | undefined)?.workspace
  );
  const effectiveWorkspace = teamWorkspaceView.workspacePath;
  // For project teams the file panel is the Layout-level Explorer host (gated on
  // project_id), so ChatLayout's own workspace sider is disabled — mirrors
  // ChatConversation's `workspaceEnabled && !project_id`.
  const workspaceEnabled = teamWorkspaceView.workspaceEnabled && !teamProjectId;
  // Team is "user-picked" only when team.workspace was explicitly set at team
  // creation. Falling back to a leader assistant's auto-temp workspace counts as
  // temporary, mirroring single-chat behavior.
  const isTeamWorkspaceTemporary = teamWorkspaceView.isTemporaryWorkspace;

  // Mirror conversation/index.tsx: close preview only when the isolation scope
  // changes, keep it open when switching between teams that share the same scope.
  // Scope is project (falling back to workspace until the leader conversation's
  // project_id is populated).
  const { closePreviewIfScopeChanged } = usePreviewContext();
  useEffect(() => {
    closePreviewIfScopeChanged(previewScopeKey(teamProjectId, effectiveWorkspace ?? null));
  }, [teamProjectId, effectiveWorkspace, closePreviewIfScopeChanged]);

  const siderTitle = useMemo(
    () => (
      <div className='flex items-center justify-between'>
        <span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>
      </div>
    ),
    [t]
  );

  const sider = useMemo(() => {
    if (!workspaceEnabled || !dispatchConversation) return <div />;
    return <ChatSlider conversation={dispatchConversation} />;
  }, [workspaceEnabled, dispatchConversation]);

  const updateScrollArrows = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const hasOverflow = container.scrollWidth > container.clientWidth + 1;
    setShowLeftArrow(hasOverflow && container.scrollLeft > 10);
    setShowRightArrow(hasOverflow && container.scrollLeft + container.clientWidth < container.scrollWidth - 10);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', updateScrollArrows, { passive: true });
    window.addEventListener('resize', updateScrollArrows);
    const observer = new ResizeObserver(updateScrollArrows);
    observer.observe(container);
    updateScrollArrows();
    return () => {
      container.removeEventListener('scroll', updateScrollArrows);
      window.removeEventListener('resize', updateScrollArrows);
      observer.disconnect();
    };
  }, [updateScrollArrows]);

  const handleTabClick = useCallback(
    (slot_id: string) => {
      switchTab(slot_id);
      // Single chat shows only the selected member, so no scrolling or flash is needed; parallel scrolls to the column and flashes it.
      if (isSingleView) return;
      requestAnimationFrame(() => {
        const el = assistantRefs.current[slot_id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
          // Flash: opacity 1→0→1
          setTimeout(() => {
            el.style.transition = 'opacity 150ms ease-out';
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.transition = 'opacity 150ms ease-in';
              el.style.opacity = '1';
              setTimeout(() => {
                el.style.transition = '';
              }, 200);
            }, 150);
          }, 200);
        }
      });
    },
    [switchTab, isSingleView]
  );

  const scrollToPrev = useCallback(() => {
    const idx = assistants.findIndex((assistant) => assistant.slot_id === activeSlotId);
    const target = idx > 0 ? idx - 1 : 0;
    if (assistants[target]) handleTabClick(assistants[target].slot_id);
  }, [assistants, activeSlotId, handleTabClick]);

  const scrollToNext = useCallback(() => {
    const idx = assistants.findIndex((assistant) => assistant.slot_id === activeSlotId);
    const target = idx >= 0 && idx < assistants.length - 1 ? idx + 1 : 0;
    if (assistants[target]) handleTabClick(assistants[target].slot_id);
  }, [assistants, activeSlotId, handleTabClick]);

  // Every time the page mounts, scroll + flash the active tab
  useEffect(() => {
    if (activeSlotId && assistants.length > 0) {
      const timer = setTimeout(() => {
        const el = assistantRefs.current[activeSlotId];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
          setTimeout(() => {
            el.style.transition = 'opacity 150ms ease-out';
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.transition = 'opacity 150ms ease-in';
              el.style.opacity = '1';
              setTimeout(() => {
                el.style.transition = '';
              }, 200);
            }, 150);
          }, 200);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []); // empty deps = only on mount

  // In parallel view, when activeSlotId changes programmatically ("tell the leader" switching to
  // the leader, say), scroll that column into view so the selected member is not off-screen.
  useEffect(() => {
    if (isSingleView || !activeSlotId) return;
    const el = assistantRefs.current[activeSlotId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, [activeSlotId, isSingleView]);

  // Track pending permission confirmation counts per assistant (requirements 5, 6, 7, 8)
  const { pendingCounts } = useTeamPendingPermissions(team.id, allConversationIds);

  // Build slot_id → pendingCount map for tab badge display
  const slotPendingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const assistant of assistants) {
      if (assistant.conversation_id) {
        map.set(assistant.slot_id, pendingCounts[assistant.conversation_id] ?? 0);
      }
    }
    return map;
  }, [assistants, pendingCounts]);

  // Slots whose warmup failed, marking their pill avatars red. Computed only in the failed state, since running and ready need no marking.
  const warmupFailedSlotIds = useMemo(() => {
    if (warmupPhase !== 'error') return undefined;
    const ids = new Set<string>();
    warmupRuntimeStatus.forEach((state, slot_id) => {
      if (state.status === 'failed') ids.add(slot_id);
    });
    return ids.size > 0 ? ids : undefined;
  }, [warmupPhase, warmupRuntimeStatus]);

  const tabsSlot = useMemo(
    () => (
      <TeamTabs
        onTabClick={handleTabClick}
        pendingCounts={slotPendingCounts}
        warmingUp={isWarmingUp}
        failedSlotIds={warmupFailedSlotIds}
      />
    ),
    [handleTabClick, slotPendingCounts, isWarmingUp, warmupFailedSlotIds]
  );

  return (
    <TeamPermissionProvider
      team_id={team.id}
      isLeaderAgent={isLeaderAssistant}
      leaderConversationId={leaderConversationId}
      allConversationIds={allConversationIds}
    >
      <TeamIdentityProvider colorOfConversation={colorOfConversation}>
        {messageContext}
        <ChatLayout
          title={team.name}
          siderTitle={siderTitle}
          sider={sider}
          workspaceEnabled={workspaceEnabled}
          previewHosted={Boolean(teamProjectId)}
          tabsSlot={tabsSlot}
          conversation_id={activeAssistant?.conversation_id}
          agent_name={undefined}
          workspacePath={effectiveWorkspace}
          isTemporaryWorkspace={isTeamWorkspaceTemporary}
          workspacePreferenceKey={team.id}
          onRenameTitle={onRenameTeam}
          headerExtra={assistants.length > 1 ? <TeamViewToggle value={viewMode} onChange={setViewMode} /> : undefined}
          headerLeading={
            <span className='inline-flex w-16px h-16px items-center justify-center shrink-0 leading-none text-t-primary'>
              <Peoples theme='outline' size='16' fill='currentColor' style={{ lineHeight: 0 }} />
            </span>
          }
        >
          <div className='relative flex h-full'>
            <TeamWarmupOverlay
              phase={warmupPhase}
              assistants={assistants}
              runtimeStatus={warmupRuntimeStatus}
              colorOf={colorOf}
              onRetry={onRetryWarmup}
            />
            {viewMode === 'board' ? (
              // Board view: a read-only rendering of the team's mailbox and task board.
              <div className='flex-1 h-full min-w-0'>
                <TeamActivityView team={team} />
              </div>
            ) : isSingleView ? (
              // Single-chat view fills the screen with activeSlotId, falling back to the leader when it cannot be found.
              (() => {
                const assistant =
                  assistants.find((candidate) => candidate.slot_id === activeSlotId) ?? leadAssistant ?? assistants[0];
                if (!assistant) return null;
                const isLeaderSlot = assistant.slot_id === leadAssistant?.slot_id;
                return (
                  <div className='flex-1 h-full'>
                    <AssistantChatSlot
                      assistant={assistant}
                      team_id={team.id}
                      isLeader={isLeaderSlot}
                      color={colorOf(assistant.slot_id)}
                      isFullscreen
                      onToggleFullscreen={() => setViewMode('parallel')}
                      teamRunView={teamRun.state}
                      onTeamRunAck={teamRun.applyAck}
                      onRunStateStale={teamRun.reconcile}
                      warmupStatus={warmupRuntimeStatus.get(assistant.slot_id)?.status ?? 'dormant'}
                      warmupDisabled={isWarmingUp}
                    />
                  </div>
                );
              })()
            ) : (
              <>
                {showLeftArrow && (
                  <div
                    className='absolute left-0 top-0 bottom-0 w-48px z-20 flex items-center justify-center cursor-pointer opacity-80 hover:opacity-100 transition-opacity'
                    style={{ background: 'linear-gradient(90deg, var(--color-bg-1) 40%, transparent)' }}
                    onClick={scrollToPrev}
                  >
                    <div
                      className='w-32px h-32px rd-full flex items-center justify-center'
                      style={{ background: 'rgba(0,0,0,0.5)', lineHeight: 0 }}
                    >
                      <Left size='24' fill='#fff' />
                    </div>
                  </div>
                )}
                <div
                  ref={scrollContainerRef}
                  className='flex h-full w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none]'
                  style={{ scrollSnapType: 'x proximity' }}
                >
                  {assistants.map((assistant, index) => {
                    const isSingle = assistants.length <= 2;
                    const isLeaderSlot = assistant.slot_id === leadAssistant?.slot_id;
                    const isLastColumn = index === assistants.length - 1;
                    return (
                      <div
                        key={assistant.slot_id}
                        ref={(el) => {
                          assistantRefs.current[assistant.slot_id] = el;
                        }}
                        data-slot-id={assistant.slot_id}
                        data-role={isLeaderSlot ? 'leader' : 'member'}
                        // A grey divider on the right of every column but the last, so several pale columns do not blur together.
                        className={`relative h-full ${isLastColumn ? '' : 'border-r border-solid border-[color:var(--border-base)]'}`}
                        style={{
                          // Always flex-grow to fill available space; each slot starts at 400px
                          // basis so the layout is stable, but spare room is distributed evenly
                          // instead of leaving empty gaps to the right. When the team is wider
                          // than the viewport we preserve the 400px floor (prevents shrinking
                          // into unreadable cards) so horizontal scroll kicks in naturally.
                          flex: '1 1 400px',
                          minWidth: isSingle ? '240px' : '400px',
                          scrollSnapAlign: 'start',
                        }}
                      >
                        <AssistantChatSlot
                          assistant={assistant}
                          team_id={team.id}
                          isLeader={isLeaderSlot}
                          color={colorOf(assistant.slot_id)}
                          onToggleFullscreen={() => {
                            switchTab(assistant.slot_id);
                            setViewMode('single');
                          }}
                          teamRunView={teamRun.state}
                          onTeamRunAck={teamRun.applyAck}
                          onRunStateStale={teamRun.reconcile}
                          warmupStatus={warmupRuntimeStatus.get(assistant.slot_id)?.status ?? 'dormant'}
                          warmupDisabled={isWarmingUp}
                        />
                      </div>
                    );
                  })}
                </div>
                {showRightArrow && (
                  <div
                    className='absolute right-0 top-0 bottom-0 w-48px z-20 flex items-center justify-center cursor-pointer opacity-80 hover:opacity-100 transition-opacity'
                    style={{ background: 'linear-gradient(270deg, var(--color-bg-1) 40%, transparent)' }}
                    onClick={scrollToNext}
                  >
                    <div
                      className='w-32px h-32px rd-full flex items-center justify-center'
                      style={{ background: 'rgba(0,0,0,0.5)', lineHeight: 0 }}
                    >
                      <Right size='24' fill='#fff' />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ChatLayout>
      </TeamIdentityProvider>
    </TeamPermissionProvider>
  );
};

const TeamPage: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const { phase: warmupPhase, runtimeStatus: warmupRuntimeStatus, retry: retryWarmup } = useTeamWarmup(team.id);
  const { statusMap, membershipMutationBusy, addAssistant, renameAssistant, removeAssistant, mutateTeam } =
    useTeamSession(team, warmupPhase);
  const { user } = useAuth();
  const { mutate: globalMutate } = useSWRConfig();
  const defaultSlotId = team.assistants[0]?.slot_id ?? '';

  const handleRemoveAssistantWithConfirm = useCallback(
    (slot_id: string) => {
      if (membershipMutationBusy) return;

      const doRemoveAssistant = async () => {
        try {
          await removeAssistant(slot_id);
          Message.success(t('common.deleteSuccess'));
        } catch (error) {
          Message.error(String(error));
        }
      };
      // Removing a member always confirms, with stronger wording when that member is mid-task and would be interrupted.
      const status = statusMap.get(slot_id)?.status;
      const isActive = status === 'active';
      Modal.confirm({
        title: t('team.removeAgent.confirmTitle', { defaultValue: 'Remove team member' }),
        content: isActive
          ? t('team.removeAgent.confirmContentActive', {
              defaultValue: 'This member is working. Remove it anyway? Its current work will be interrupted.',
            })
          : t('team.removeAgent.confirmContent', { defaultValue: 'Remove this member from the team?' }),
        okButtonProps: { status: 'danger' },
        onOk: doRemoveAssistant,
      });
    },
    [membershipMutationBusy, statusMap, removeAssistant, t]
  );

  const handleRenameTeam = useCallback(
    async (new_name: string): Promise<boolean> => {
      try {
        await ipcBridge.team.renameTeam.invoke({ id: team.id, name: new_name });
        await mutateTeam();
        await globalMutate(`teams/${user?.id ?? 'system_default_user'}`);
        return true;
      } catch (error) {
        console.error('Failed to rename team:', error);
        return false;
      }
    },
    [team.id, mutateTeam, globalMutate, user]
  );

  return (
    <TeamTabsProvider
      assistants={team.assistants}
      statusMap={statusMap}
      defaultActiveSlotId={defaultSlotId}
      team_id={team.id}
      addAssistant={addAssistant}
      renameAssistant={renameAssistant}
      removeAssistant={handleRemoveAssistantWithConfirm}
      membershipMutationBusy={membershipMutationBusy}
    >
      <TeamPageContent
        team={team}
        onRenameTeam={handleRenameTeam}
        warmupPhase={warmupPhase}
        warmupRuntimeStatus={warmupRuntimeStatus}
        onRetryWarmup={retryWarmup}
      />
    </TeamTabsProvider>
  );
};

export default TeamPage;
