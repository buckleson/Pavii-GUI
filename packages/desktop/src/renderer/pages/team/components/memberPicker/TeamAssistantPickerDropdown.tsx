import React from 'react';
import { Trigger } from '@arco-design/web-react';
import type { TeamAssistantOption } from '../assistantSelectUtils';
import TeamAssistantPicker from './TeamAssistantPicker';

/**
 * TeamAssistantPickerDropdown - the shared "click plus, open a dropdown, pick an assistant" component.
 *
 * Several team surfaces use it: the plus in the desktop and mobile team tab bars, and "add
 * member" in the narrow create-team modal. All are an anchor (a plus button) opening a floating
 * dropdown holding a searchable assistant list. This unifies the positioning, z-index and look
 * (light border, radius, shadow, padding, soft search box); callers supply only the anchor, the list and a selection callback, and keep the business logic that follows.
 */
type Props = {
  /** The anchor element, usually the "+" button. */
  children: React.ReactElement;
  assistants: TeamAssistantOption[];
  onSelect: (assistant: TeamAssistantOption) => void;
  /** Controlled open state. */
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  disabled?: boolean;
  /** Id of the assistant being processed, for the inline spinner while the caller adds it. */
  pendingAssistantId?: string;
  /** testId prefix passed to the inner picker, which the search box and options derive from. */
  testIdPrefix: string;
  /** testId of the floating container. */
  panelTestId?: string;
  /** Title at the top of the dropdown ("Add member", say). Omitted, no title area renders. */
  title?: React.ReactNode;
  /** Subtitle under the title ("the same assistant can be added repeatedly"). Only renders with a title. */
  subtitle?: React.ReactNode;
  /** Helper text at the bottom of the list ("the same assistant can be added more than once"). */
  footer?: React.ReactNode;
  /** A persistent prompt below the list, above a divider - "ask the leader to add people", say. */
  guidanceFooter?: React.ReactNode;
  /** Copy shown when the assistant list is empty; omitted, the inner picker shows its default empty state. */
  emptyText?: React.ReactNode;
  /** Row density passed to the inner picker. Defaults to 'modal': compact, no inner borders, suited to a dropdown. */
  density?: 'compact' | 'modal';
};

const TeamAssistantPickerDropdown: React.FC<Props> = ({
  children,
  assistants,
  onSelect,
  visible,
  onVisibleChange,
  disabled = false,
  pendingAssistantId,
  testIdPrefix,
  panelTestId,
  title,
  subtitle,
  footer,
  guidanceFooter,
  emptyText,
  density = 'modal',
}) => {
  const showEmpty = emptyText !== undefined && assistants.length === 0;

  return (
    <Trigger
      popupVisible={visible}
      onVisibleChange={(next) => onVisibleChange(disabled ? false : next)}
      trigger='click'
      position='br'
      popupAlign={{ bottom: 8 }}
      getPopupContainer={() => document.body}
      classNames='team-assistant-picker-dropdown'
      popup={() => (
        <div
          data-testid={panelTestId}
          className='flex max-h-[min(360px,60vh)] w-260px min-h-0 flex-col rounded-10px border border-solid border-3 bg-dialog-fill-0 p-8px shadow-[0_4px_12px_rgba(0,0,0,0.1)]'
          style={{ zIndex: 10020 }}
        >
          {title ? (
            <div
              className='shrink-0 px-4px pb-8px pt-2px'
              data-testid={panelTestId ? `${panelTestId}-header` : undefined}
            >
              <div className='text-14px font-600 leading-20px text-t-primary'>{title}</div>
              {subtitle ? <div className='mt-2px text-12px leading-18px text-t-tertiary'>{subtitle}</div> : null}
            </div>
          ) : null}
          {showEmpty ? (
            <div className='flex items-center justify-center px-12px py-12px text-center text-13px text-t-tertiary'>
              {emptyText}
            </div>
          ) : (
            <TeamAssistantPicker
              assistants={assistants}
              onSelect={onSelect}
              disabled={disabled}
              pendingAssistantId={pendingAssistantId}
              testIdPrefix={testIdPrefix}
              density={density}
              searchVariant='inline'
              footer={footer}
            />
          )}
          {guidanceFooter ? (
            // The divider spans the full dropdown width (negative margins cancel the panel's p-8px), leaving one line and text rather than a box.
            <div
              className='shrink-0 -mx-8px mt-8px px-12px pt-8px border-t border-solid border-3'
              data-testid={panelTestId ? `${panelTestId}-guidance` : undefined}
            >
              {guidanceFooter}
            </div>
          ) : null}
        </div>
      )}
    >
      {children}
    </Trigger>
  );
};

export default TeamAssistantPickerDropdown;
