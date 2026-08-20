/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { FolderClose, FolderOpen } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';

interface WorkspaceCollapseProps {
  /** Whether it is expanded */
  expanded: boolean;
  /** Called to toggle the expanded state */
  onToggle: () => void;
  /** Panel title */
  header: React.ReactNode;
  /** Panel content */
  children: React.ReactNode;
  /** Extra class name */
  className?: string;
  /** Whether the sidebar is collapsed; when it is, group titles hide and the indent is removed */
  siderCollapsed?: boolean;
  /** Slot at the end of the title - a hover menu button, say; clicking it does not fire onToggle */
  trailing?: React.ReactNode;
  /** Keep the header pinned while scrolling - for long project groups, so the project title changes as you scroll */
  stickyHeader?: boolean;
  /** Offset in px from the top of the scroll container while pinned, leaving room for the section header above */
  stickyTop?: number;
}

/**
 * Workspace collapse: a simple collapsible panel for workspace groups
 */
const WorkspaceCollapse: React.FC<WorkspaceCollapseProps> = ({
  expanded,
  onToggle,
  header,
  children,
  className,
  siderCollapsed = false,
  trailing,
  stickyHeader = false,
  stickyTop,
}) => {
  // With the sidebar collapsed, force the content open and hide the header
  const showContent = siderCollapsed || expanded;
  // Pin only while expanded: collapsed project headers need not persist, and pinning them would stack several at the top
  const stickyEnabled = stickyHeader && expanded && !siderCollapsed;

  return (
    <div className={classNames('workspace-collapse min-w-0', className)}>
      {/* Collapse header, hidden when the sidebar is collapsed. While pinned the outer layer uses an opaque bg-2 as a mask, so
          the inner translucent hover highlight sits on the mask rather than showing the scrolling content beneath. */}
      {!siderCollapsed && (
        <div
          className={classNames(stickyEnabled && 'sticky z-[9] bg-[var(--bg-2)]')}
          style={stickyEnabled ? { top: stickyTop ?? 0 } : undefined}
        >
          <div
            className='flex items-center gap-8px h-34px pl-10px pr-8px cursor-pointer hover:bg-fill-3 rd-8px transition-colors min-w-0 group'
            onClick={onToggle}
          >
            <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
              {expanded ? (
                <FolderOpen theme='outline' size={16} fill='currentColor' className='line-height-0' />
              ) : (
                <FolderClose theme='outline' size={16} fill='currentColor' className='line-height-0' />
              )}
            </span>

            {/* Title content - the flex container is what makes the inner header span's truncate work */}
            <div className='flex-1 min-w-0 flex items-center overflow-hidden'>{header}</div>

            {/* Trailing action slot - a fixed width truncates the text early; a hover-only button may overflow left over the last character or two */}
            {trailing && (
              <div className='shrink-0 flex items-center justify-end w-22px' onClick={(e) => e.stopPropagation()}>
                {trailing}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsed content - rows stay full width so the selected background fills them; the visual indent is handled by ConversationRow's dimIcon branch */}
      {showContent && <div className='workspace-collapse-content min-w-0'>{children}</div>}
    </div>
  );
};

export default WorkspaceCollapse;
