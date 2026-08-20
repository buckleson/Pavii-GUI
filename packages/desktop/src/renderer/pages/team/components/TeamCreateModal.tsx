import React, { useMemo, useRef, useState } from 'react';
import { Button, Input, Message } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { TeamAssistantInput } from '@/common/adapter/teamMapper';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import AionModal from '@renderer/components/base/AionModal';
import { WorkspaceFolderSelect } from '@renderer/components/workspace';
import { getConversationCreateErrorMessage } from '@renderer/pages/conversation/utils/conversationCreateError';
import { useTeamAssistantOptions } from '../hooks/useTeamAssistantOptions';
import type { TeamAssistantOption } from './assistantSelectUtils';
import { resolveDefaultTeamAgentModel } from './teamCreateModelResolver';
import TeamAssistantPicker from './memberPicker/TeamAssistantPicker';
import TeamAssistantPickerDropdown from './memberPicker/TeamAssistantPickerDropdown';
import TeamMemberDraftList, { type TeamMemberDraft } from './memberPicker/TeamMemberDraftList';

// [E2E SYNC] When changing this component's DOM (classes, title, close button and so on) you
// must update the selectors in tests/e2e/cases/teams/team-create.e2e.ts, team-whitelist.e2e.ts
// and team-name-validation.e2e.ts, and report the change immediately.
// Note: since the move to AionModal variant='standard', the close button is button[aria-label="Close"].
// It is no longer .arco-btn-text / .arco-modal-close-icon.
// Narrow screens (layout.isMobile, <768px) use a single column rooted at team-create-layout-mobile;
// the assistant picker is a dropdown anchored to team-create-add-member-btn (choosing closes it and the assistant appears in the list below);
// the desktop two-column layout is team-create-layout.
type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (team: TTeam) => void;
};

const TeamCreateModal: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { assistants: allAssistants } = useTeamAssistantOptions(i18n?.language ?? 'en-US');
  const [name, setName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<TeamMemberDraft[]>([]);
  const [leaderSelectionId, setLeaderSelectionId] = useState<string | undefined>(undefined);
  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  // Narrow screens only: the assistant picker is a dropdown anchored to the "add member" button, opened on demand.
  const [assistantDropdownOpen, setAssistantDropdownOpen] = useState(false);
  const nameInputRef = useRef<RefInputType | null>(null);

  const hasOneLeader = useMemo(
    () => Boolean(leaderSelectionId && selectedMembers.some((member) => member.selectionId === leaderSelectionId)),
    [leaderSelectionId, selectedMembers]
  );

  const handleClose = () => {
    setName('');
    setSelectedMembers([]);
    setLeaderSelectionId(undefined);
    setWorkspace('');
    setAssistantDropdownOpen(false);
    onClose();
  };

  const handleSelectAssistant = (assistant: TeamAssistantOption) => {
    const draft = {
      selectionId: `${assistant.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      assistant,
    };
    setSelectedMembers((members) => [...members, draft]);
    setLeaderSelectionId((current) => current ?? draft.selectionId);
  };

  const handleRemoveDraft = (selectionId: string) => {
    const nextMembers = selectedMembers.filter((member) => member.selectionId !== selectionId);
    setSelectedMembers(nextMembers);
    if (leaderSelectionId === selectionId) {
      setLeaderSelectionId(nextMembers[0]?.selectionId);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Message.warning(t('team.create.nameRequired', { defaultValue: 'Please enter a team name' }));
      nameInputRef.current?.focus();
      return;
    }
    if (selectedMembers.length === 0) {
      Message.warning(t('team.create.selectAtLeastOneMember', { defaultValue: 'Select at least one team member' }));
      return;
    }
    if (!hasOneLeader) {
      Message.warning(t('team.create.selectOneLeader', { defaultValue: 'Select one Team Leader' }));
      return;
    }
    const user_id = user?.id ?? 'system_default_user';
    setLoading(true);
    try {
      const resolvedModels = await Promise.all(
        selectedMembers.map(async (member) => {
          try {
            const model = await resolveDefaultTeamAgentModel({
              assistant_id: member.assistant.id,
              assistant_backend: member.assistant.backend,
            });
            return [member.selectionId, model] as const;
          } catch (error) {
            throw new Error(`${member.assistant.name}: ${getConversationCreateErrorMessage(error, t)}`, {
              cause: error,
            });
          }
        })
      );
      const modelBySelectionId = new Map(resolvedModels);
      const agents: TeamAssistantInput[] = selectedMembers.map((member) => ({
        role: member.selectionId === leaderSelectionId ? 'leader' : 'teammate',
        assistant_name: member.assistant.name,
        assistant_id: member.assistant.id,
        model: modelBySelectionId.get(member.selectionId),
      }));

      const team = await ipcBridge.team.create.invoke({
        user_id,
        name,
        workspace,
        workspace_mode: 'shared',
        agents,
      });

      // The platform bridge swallows provider errors and returns a sentinel object
      const result = team as unknown as { __bridgeError?: boolean; message?: string };
      if (result.__bridgeError) {
        Message.error(getConversationCreateErrorMessage(result.message ?? t('team.create.error'), t));
        return;
      }

      onCreated(team);
      handleClose();
    } catch (error) {
      Message.error(getConversationCreateErrorMessage(error, t));
    } finally {
      setLoading(false);
    }
  };
  // The assistant picker sits in the left column on desktop and the same one moves into the bottom panel on narrow screens, with identical empty-state copy and logic.
  const assistantPicker = (
    <>
      {allAssistants.length === 0 ? (
        <div className='flex min-h-112px items-center justify-center rounded-8px border border-dashed border-border-2 bg-fill-1 py-14px text-13px text-t-tertiary'>
          {t('team.create.noSupportedAgents', { defaultValue: 'No supported assistants available' })}
        </div>
      ) : (
        <TeamAssistantPicker
          assistants={allAssistants}
          onSelect={handleSelectAssistant}
          testIdPrefix='team-create-agent'
          density='modal'
        />
      )}
    </>
  );

  // Team name and workspace share one set of fields across desktop and narrow screens, with the same copy, testIds and behaviour.
  const teamFields = (
    <div className='grid grid-cols-[76px_minmax(0,1fr)] items-center gap-x-14px gap-y-10px'>
      <div className='text-14px font-600 leading-21px text-t-secondary'>
        {t('team.create.nameLabel', { defaultValue: 'Team name' })}
        <span className='ml-4px text-danger-6'>*</span>
      </div>
      <div>
        <Input
          ref={nameInputRef}
          placeholder={t('team.create.namePlaceholder', { defaultValue: 'Team name' })}
          value={name}
          onChange={setName}
          data-testid='team-create-name-input'
          className='!h-38px !rounded-8px !text-13px'
        />
      </div>

      <div className='text-14px font-500 leading-21px text-t-secondary'>
        {t('team.create.workspaceLabel', { defaultValue: 'Workspace' })}
      </div>
      <div>
        <WorkspaceFolderSelect
          value={workspace}
          onChange={setWorkspace}
          placeholder={t('team.create.selectFolder', { defaultValue: 'Select folder' })}
          recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
          chooseDifferentLabel={t('team.create.chooseDifferentFolder', {
            defaultValue: 'Choose a different folder',
          })}
          triggerTestId='team-create-workspace-trigger'
          menuTestId='team-create-workspace-menu'
        />
      </div>
    </div>
  );

  // Desktop: two columns with a full-height vertical divider, unchanged so wide screens are unaffected by the narrow-screen work.
  const desktopBody = (
    <div
      data-testid='team-create-layout'
      className='grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
      style={{ height: 'min(54vh, 470px)', minHeight: 390 }}
    >
      <section
        className='flex min-h-0 flex-col border-r border-border-3 px-20px pb-18px pt-12px'
        data-testid='team-create-assistant-pane'
      >
        <div className='mb-12px text-15px font-600 leading-22px text-t-secondary'>
          {t('team.create.allAssistantsWithCount', {
            count: allAssistants.length,
            defaultValue: `All assistants (${allAssistants.length})`,
          })}
        </div>
        {assistantPicker}
      </section>

      <section className='flex min-h-0 flex-col px-20px pb-14px pt-12px' data-testid='team-create-details-pane'>
        <TeamMemberDraftList
          members={selectedMembers}
          leaderSelectionId={leaderSelectionId}
          onLeaderChange={setLeaderSelectionId}
          onRemove={handleRemoveDraft}
        />
        <div className='mt-14px shrink-0 border-t border-border-2 pt-14px'>{teamFields}</div>
      </section>
    </div>
  );

  // Narrow: a single column keeping only "selected members" and the team fields, with the assistant picker as a dropdown on the "add member" button.
  // Choosing closes the dropdown, and the user sees the assistant appear in the selected-members list below - that is the confirmation it worked.
  const handleSelectFromDropdown = (assistant: TeamAssistantOption) => {
    handleSelectAssistant(assistant);
    setAssistantDropdownOpen(false);
  };
  const addMemberDropdown = (
    <TeamAssistantPickerDropdown
      assistants={allAssistants}
      onSelect={handleSelectFromDropdown}
      visible={assistantDropdownOpen}
      onVisibleChange={setAssistantDropdownOpen}
      testIdPrefix='team-create-agent'
      panelTestId='team-create-assistant-pane'
      emptyText={t('team.create.noSupportedAgents', { defaultValue: 'No supported assistants available' })}
    >
      <Button
        type='outline'
        size='small'
        icon={<Plus theme='outline' size='14' fill='currentColor' />}
        data-testid='team-create-add-member-btn'
        className='!h-30px !rounded-999px !px-12px !text-13px'
      >
        {t('team.addMember.title', { defaultValue: 'Add member' })}
      </Button>
    </TeamAssistantPickerDropdown>
  );
  const mobileBody = (
    <div data-testid='team-create-layout-mobile' className='flex min-h-0 flex-col gap-16px px-20px py-16px'>
      {/* Narrow screens have no fixed-height parent, so the member list gets a max-height (as on desktop) and scrolls inside as members are added,
          keeping the team fields visible below. */}
      <section className='flex min-h-0 flex-col' data-testid='team-create-details-pane'>
        <TeamMemberDraftList
          members={selectedMembers}
          leaderSelectionId={leaderSelectionId}
          onLeaderChange={setLeaderSelectionId}
          onRemove={handleRemoveDraft}
          headerAction={addMemberDropdown}
          listBoxClassName='!max-h-[38vh]'
        />
      </section>

      <section className='shrink-0'>{teamFields}</section>
    </div>
  );

  return (
    <AionModal
      variant='standard'
      visible={visible}
      onCancel={handleClose}
      className='team-create-modal'
      style={{
        width: isMobile ? 'calc(100vw - 32px)' : 900,
        maxWidth: isMobile ? 'calc(100vw - 32px)' : 'calc(100vw - 72px)',
      }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      autoFocus={false}
      unmountOnExit={false}
      // The full-bleed two-column desktop layout is unique to team creation: the content padding is switched off so the centre divider runs edge to edge.
      // Narrow screens fall back to a single column with its own padding, keeping the standard rules for the title band, button band, centring and max height.
      contentStyle={{ padding: 0, overflow: 'hidden' }}
      header={{
        title: t('team.create.title', { defaultValue: 'New Team' }),
        subtitle: t('team.create.subtitle', {
          defaultValue:
            'Let multiple AI assistants team up and collaborate. We suggest one team focuses on a single goal — create separate teams for different tasks.',
        }),
        showClose: true,
      }}
      footer={{
        render: () => (
          <div className='flex justify-end gap-10px'>
            <Button onClick={handleClose} className='!h-38px min-w-84px !rounded-8px !px-18px !text-13px'>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type='primary'
              onClick={handleCreate}
              loading={loading}
              disabled={!name.trim() || selectedMembers.length === 0 || !hasOneLeader}
              className='!h-38px min-w-100px !rounded-8px !px-18px !text-13px'
            >
              {t('team.create.confirm', { defaultValue: 'Confirm Create' })}
            </Button>
          </div>
        ),
      }}
    >
      {isMobile ? mobileBody : desktopBody}
    </AionModal>
  );
};

export default TeamCreateModal;
