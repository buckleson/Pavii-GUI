import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CloseSmall, Drag, Edit, Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TeammateStatus } from '@/common/types/team/teamTypes';
import { restrictToHorizontalAxis } from '@/renderer/utils/ui/dndModifiers';
import AgentStatusBadge from './AgentStatusBadge';
import TeamAgentIdentity from './TeamAgentIdentity';
import { useTeamTabs } from '../hooks/TeamTabsContext';
import TeamAddMemberPopover from './memberPicker/TeamAddMemberPopover';

const TAB_OVERFLOW_THRESHOLD = 10;

type TeamTabViewProps = {
  slot_id: string;
  assistant_name: string;
  assistant_backend: string;
  icon?: string;
  conversation_id?: string;
  isActive: boolean;
  status: TeammateStatus;
  isLeader: boolean;
  /** Warmup failed: the avatar gains a red ring and an exclamation badge. */
  warmupFailed?: boolean;
  /** The member identity colour, used for the pill background and the selected outline. */
  color: string;
  /** Number of pending permission confirmations for this agent */
  pendingCount?: number;
  /** A drag is in progress somewhere in the bar: freeze hover affordances so pills don't reflow mid-drag. */
  dragActive: boolean;
  onSwitch: (slot_id: string) => void;
  onRename?: (slot_id: string, new_name: string) => void;
  onRemove?: (slot_id: string) => void;
};

const TeamTabView: React.FC<TeamTabViewProps> = ({
  slot_id,
  assistant_name,
  assistant_backend,
  icon,
  conversation_id,
  isActive,
  status,
  isLeader,
  warmupFailed = false,
  color,
  pendingCount = 0,
  dragActive,
  onSwitch,
  onRename,
  onRemove,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(assistant_name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Leader stays fixed at index 0 and never takes part in sorting.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: slot_id,
    disabled: isLeader,
  });

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const nextValue = inputRef.current?.value ?? editValue;
    const trimmed = nextValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== assistant_name && onRename) {
      setEditValue(trimmed);
      onRename(slot_id, trimmed);
    } else {
      setEditValue(assistant_name);
    }
  }, [editValue, assistant_name, slot_id, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitRename();
      } else if (e.key === 'Escape') {
        setEditValue(assistant_name);
        setEditing(false);
      }
    },
    [commitRename, assistant_name]
  );

  const startEditing = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(assistant_name);
      setEditing(true);
    },
    [assistant_name]
  );

  // The pill background stays light grey through hover and selection, so it never dulls the coloured name;
  // selection shows as a border in the member's own identity colour, echoing the name - clear without muddying it. The identity colour touches only the name and the border.
  // Dragging uses dnd-kit sortable: on hover the handle appears inline before the avatar (the same
  // "widen on hover" language as the rename and remove buttons, covering neither avatar nor status dot); siblings shift aside live via transform, and the pill lands where it is dropped.
  // While dragActive, the other pills stop widening on hover so the layout cannot jump as the drag
  // passes over them; the dragged pill keeps its handle and buttons visible at a constant width.
  const showDragHandle = !isLeader && !editing && ((hovered && !dragActive) || isDragging);
  const showHoverActions = !editing && ((hovered && !dragActive) || isDragging);
  return (
    <div
      ref={setNodeRef}
      data-testid={`team-tab-${slot_id}`}
      data-team-tab-role={isLeader ? 'leader' : 'teammate'}
      data-active={isActive ? 'true' : 'false'}
      className='relative flex items-center gap-6px pl-6px pr-10px h-34px max-w-220px cursor-pointer rounded-999px border border-solid transition-colors duration-150 shrink-0 bg-[color:var(--bg-2)]'
      style={{
        ['--mc' as string]: color,
        borderColor: isActive ? color : 'transparent',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.72 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !editing && onSwitch(slot_id)}
      onDoubleClick={onRename ? startEditing : undefined}
    >
      {showDragHandle && (
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          role='button'
          aria-label={t('team.reorderMember', { defaultValue: 'Drag to reorder member' })}
          data-testid={`team-tab-drag-${slot_id}`}
          className={`shrink-0 flex items-center justify-center w-14px h-20px text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{ touchAction: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Drag theme='outline' size='13' fill='currentColor' />
        </span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className='text-15px flex-1 min-w-0 bg-transparent border-none outline-none text-[color:var(--color-text-1)] p-0'
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className='min-w-0 flex-1 flex items-center gap-4px'>
          {pendingCount > 0 && (
            <span
              className='shrink-0 text-14px leading-none animate-wiggle'
              title={`${pendingCount} pending permission request(s)`}
            >
              ‼️
            </span>
          )}
          <TeamAgentIdentity
            assistant_name={assistant_name}
            assistant_backend={assistant_backend}
            icon={icon}
            conversation_id={conversation_id}
            isLeader={isLeader}
            className='min-w-0 flex-1 !gap-6px'
            logoClassName={`w-22px h-22px object-cover rounded-full ${warmupFailed ? 'grayscale' : ''}`}
            avatarClassName={`w-22px h-22px rounded-full flex items-center justify-center text-12px leading-none bg-fill-2 shrink-0 ${warmupFailed ? 'grayscale' : ''}`}
            nameClassName='text-13px font-600 whitespace-nowrap overflow-hidden text-ellipsis select-none'
            nameStyle={{ color }}
            nameTestId={`team-tab-name-${slot_id}`}
            avatarOverlay={
              warmupFailed ? (
                <span
                  data-testid={`team-tab-failed-${slot_id}`}
                  className='absolute -right-2px -bottom-2px w-12px h-12px rounded-full flex items-center justify-center text-9px font-700 text-white'
                  style={{ background: 'var(--danger)', border: '1.5px solid var(--bg-base)' }}
                >
                  !
                </span>
              ) : (
                <AgentStatusBadge status={status} testId={`team-tab-status-${slot_id}`} />
              )
            }
          />
        </div>
      )}
      {/* Hover widens the pill to reveal its actions and blur collapses it back to avatar and text. Frozen during a drag so the layout cannot jump. */}
      {showHoverActions && onRename && (
        <span
          data-testid={`team-tab-edit-${slot_id}`}
          className='shrink-0 flex items-center justify-center w-20px h-20px rounded-6px text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-primary)] transition-colors duration-150'
          onClick={startEditing}
        >
          <Edit theme='outline' size='13' fill='currentColor' />
        </span>
      )}
      {showHoverActions && !isLeader && onRemove && (
        <span
          data-testid={`team-tab-remove-${slot_id}`}
          className='shrink-0 flex items-center justify-center w-20px h-20px rounded-6px text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--color-danger-6)] transition-colors duration-150'
          onClick={(e) => {
            e.stopPropagation();
            onRemove(slot_id);
          }}
        >
          <CloseSmall theme='outline' size='14' fill='currentColor' />
        </span>
      )}
    </div>
  );
};

type TeamTabsProps = {
  onTabClick?: (slot_id: string) => void;
  /** Pending permission confirmation counts per assistant slot ID */
  pendingCounts?: Map<string, number>;
  /** While team warmup runs, membership edits (add, remove, rename) are disabled - required by PRD section 7. */
  warmingUp?: boolean;
  /** Slots whose warmup failed: the pill avatar turns red, pointing the user at removing the member or changing its model. */
  failedSlotIds?: Set<string>;
};

/**
 * Tab bar for team mode showing assistant tabs with status badges.
 * Supports scroll overflow with fade indicators.
 */
const TeamTabs: React.FC<TeamTabsProps> = ({ onTabClick, pendingCounts, warmingUp = false, failedSlotIds }) => {
  const { t } = useTranslation();
  const {
    assistants,
    activeSlotId,
    statusMap,
    switchTab,
    renameAssistant,
    removeAssistant,
    reorderAssistants,
    addAssistant,
    colorOf,
  } = useTeamTabs();
  // Pill actions are disabled only while warmup is running. Once it ends - succeeded or failed -
  // they all reopen. The backend already serializes membership changes with its own lock, so the
  // frontend need not add a second busy-disable (which would lock the pills again while the backend rebuilt the rest, making every removal stutter).
  const memberOpsDisabled = warmingUp;
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);
  // During a drag, freeze hover-widening on every pill (the rename and remove buttons); otherwise
  // the pill under the cursor widens, the layout jumps, hover is lost, it narrows again - a flicker loop.
  const [dragActive, setDragActive] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  // Only teammates are sortable; the leader pill is rendered outside the sortable id list.
  const sortableIds = useMemo(
    () => assistants.filter((assistant) => assistant.role !== 'leader').map((assistant) => assistant.slot_id),
    [assistants]
  );

  const updateTabOverflow = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    const hasOverflow = container.scrollWidth > container.clientWidth + 1;
    setShowLeftFade(hasOverflow && container.scrollLeft > TAB_OVERFLOW_THRESHOLD);
    setShowRightFade(
      hasOverflow && container.scrollLeft + container.clientWidth < container.scrollWidth - TAB_OVERFLOW_THRESHOLD
    );
  }, []);

  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', updateTabOverflow, { passive: true });
    window.addEventListener('resize', updateTabOverflow);
    const observer = new ResizeObserver(updateTabOverflow);
    observer.observe(container);
    updateTabOverflow();
    return () => {
      container.removeEventListener('scroll', updateTabOverflow);
      window.removeEventListener('resize', updateTabOverflow);
      observer.disconnect();
    };
  }, [updateTabOverflow]);

  const handleDragStart = useCallback(() => setDragActive(true), []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setDragActive(false);
      if (!over || active.id === over.id) return;
      reorderAssistants(String(active.id), String(over.id));
    },
    [reorderAssistants]
  );

  const handleDragCancel = useCallback(() => setDragActive(false), []);

  if (assistants.length === 0) return null;

  return (
    <div
      data-testid='team-tab-bar'
      className='relative shrink-0 bg-1 border-t border-x border-b border-solid border-[color:var(--border-base)]'
    >
      <div className='relative flex items-stretch min-h-48px'>
        {/* Horizontally scrollable list of member pills */}
        <div
          ref={tabsContainerRef}
          className='flex items-center gap-6px flex-1 min-w-0 overflow-x-auto overflow-y-hidden py-8px px-12px [scrollbar-width:none]'
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
              {assistants.map((assistant) => {
                const statusInfo = statusMap.get(assistant.slot_id);
                return (
                  <TeamTabView
                    key={assistant.slot_id}
                    slot_id={assistant.slot_id}
                    assistant_name={assistant.assistant_name}
                    assistant_backend={assistant.assistant_backend}
                    icon={assistant.icon}
                    conversation_id={assistant.conversation_id}
                    isActive={assistant.slot_id === activeSlotId}
                    status={statusInfo?.status ?? assistant.status}
                    isLeader={assistant.role === 'leader'}
                    warmupFailed={failedSlotIds?.has(assistant.slot_id) ?? false}
                    color={colorOf(assistant.slot_id)}
                    pendingCount={pendingCounts?.get(assistant.slot_id) ?? 0}
                    dragActive={dragActive}
                    onSwitch={(slot_id) => {
                      switchTab(slot_id);
                      onTabClick?.(slot_id);
                    }}
                    onRename={
                      renameAssistant && !memberOpsDisabled ? (sid, name) => void renameAssistant(sid, name) : undefined
                    }
                    onRemove={removeAssistant && !memberOpsDisabled ? (sid) => void removeAssistant(sid) : undefined}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
        {/* Fades at both edges hint at more, covering only the scroll area and never the fixed add button */}
        {showLeftFade && (
          <div
            className='pointer-events-none absolute left-0 top-0 bottom-0 w-28px z-10'
            style={{ background: 'linear-gradient(90deg, var(--color-bg-1), transparent)' }}
          />
        )}
        {showRightFade && (
          <div
            className='pointer-events-none absolute top-0 bottom-0 w-28px z-10'
            style={{
              right: 'var(--team-add-w, 132px)',
              background: 'linear-gradient(270deg, var(--color-bg-1), transparent)',
            }}
          />
        )}
        {/* "Add member" is pinned right and does not scroll with the list; a divider separates it, and the button itself is borderless. */}
        {addAssistant ? (
          <div className='flex items-center shrink-0 border-l border-solid border-[color:var(--border-base)] px-8px'>
            <TeamAddMemberPopover disabled={memberOpsDisabled}>
              <button
                type='button'
                disabled={memberOpsDisabled}
                data-testid='team-tab-add-member'
                // Disabled only dims the text: position, size, background and border stay put.
                // A native <button>:disabled adds the browser grey and shrinks the height, and UA styles can
                // beat the className's appearance/bg while disabled, so inline styles force the native look off and pin the box model, keeping both states identical.
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  background: 'transparent',
                  border: 'none',
                  height: 32,
                  lineHeight: 'normal',
                }}
                className={`flex items-center gap-6px px-10px rounded-8px text-13px font-500 whitespace-nowrap transition-colors duration-150 ${
                  memberOpsDisabled
                    ? 'text-[color:var(--text-disabled)] cursor-not-allowed'
                    : 'text-[color:var(--text-secondary)] hover:text-[color:var(--brand)] hover:bg-[color:var(--bg-2)] cursor-pointer'
                }`}
              >
                <Plus theme='outline' size='15' fill='currentColor' className='leading-none' />
                {t('team.addMember.title', { defaultValue: 'Add member' })}
              </button>
            </TeamAddMemberPopover>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TeamTabs;
