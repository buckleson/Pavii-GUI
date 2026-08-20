/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/styles/colors';
import { Close, Plus } from '@icon-park/react';
import { IconShrink } from '@arco-design/web-react/icon';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TabFadeState } from '../../hooks/useTabOverflow';

/**
 * Maximum width of a single tab.
 *
 * Page titles can be arbitrarily long, and without a cap one tab can fill the whole strip,
 * leaving the user unable to see that any others exist. 180px fits a recognisable domain or a
 * dozen-odd wide characters, and still lets the edge of a second tab show at the panel minimum
 * width (260px), giving the visual hint that there is more.
 *
 * Maximum width of a single tab. Page titles can be arbitrarily long, and without a
 * cap one tab fills the whole strip so the user cannot tell other tabs exist. 180px
 * fits a recognizable domain or a dozen CJK characters while still leaving the edge
 * of a second tab visible at the panel's 260px minimum width — the visual cue that
 * more tabs are there.
 */
const MAX_TAB_WIDTH_PX = 180;

/**
 * Tab information
 */
export interface PreviewTab {
  /**
   * Tab ID
   */
  id: string;

  /**
   * Tab title
   */
  title: string;

  /**
   * Whether there are unsaved changes
   */
  isDirty?: boolean;

  /**
   * Site icon URL, browser tabs only
   */
  favicon?: string;

  /**
   * Agent is currently driving this browser tab
   */
  agentActive?: boolean;
}

/**
 * PreviewTabs component props
 */
interface PreviewTabsProps {
  /**
   * Tabs list
   */
  tabs: PreviewTab[];

  /**
   * Current active tab ID
   */
  activeTabId: string | null;

  /**
   * Tab fade state (left/right overflow indicators)
   */
  tabFadeState: TabFadeState;

  /**
   * Tabs container ref
   */
  tabsContainerRef: React.RefObject<HTMLDivElement>;

  /**
   * Switch tab callback
   */
  onSwitchTab: (tabId: string) => void;

  /**
   * Close tab callback
   */
  onCloseTab: (tabId: string) => void;

  /**
   * Tab context menu callback
   */
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;

  /**
   * Close preview panel callback
   */
  onClosePanel?: () => void;

  /**
   * Called to open a new browser tab; supplied only when a browser tab already exists, so a document-only panel shows no pointless plus
   * New browser tab callback. Only supplied when a browser tab already exists, so
   * the plus button never appears in a document-only panel.
   */
  onNewBrowserTab?: () => void;
}

/**
 * Preview panel tabs bar component
 *
 * Displays multiple tabs, supports switching, closing, and context menu
 *
 * Includes left/right gradient indicators to prompt users that more tabs can be scrolled
 */
const PreviewTabs: React.FC<PreviewTabsProps> = ({
  tabs,
  activeTabId,
  tabFadeState,
  tabsContainerRef,
  onSwitchTab,
  onCloseTab,
  onContextMenu,
  onClosePanel,
  onNewBrowserTab,
}) => {
  const { t } = useTranslation();
  const { left: showLeftFade, right: showRightFade } = tabFadeState;

  return (
    <div
      className='relative flex-shrink-0 bg-bg-2'
      style={{ minHeight: '36px', borderBottom: '1px solid var(--border-base)' }}
    >
      <div className='flex items-center h-36px w-full'>
        {/* Tabs scroll area */}
        <div ref={tabsContainerRef} className='flex items-center h-full flex-1 overflow-x-auto'>
          {tabs.length > 0 ? (
            tabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex items-center gap-6px px-10px h-full cursor-pointer transition-colors flex-shrink-0 ${tab.id === activeTabId ? 'bg-bg-1 text-t-primary' : 'text-t-secondary hover:bg-bg-3'}`}
                style={{ maxWidth: `${MAX_TAB_WIDTH_PX}px` }}
                onClick={() => onSwitchTab(tab.id)}
                onContextMenu={(e) => onContextMenu(e, tab.id)}
                // Middle-click to close.
                //
                // Routed through onCloseTab rather than closing directly, so an unsaved tab still prompts:
                // middle-click must not become a second path around that confirmation.
                //
                // Routed through onCloseTab rather than closing directly, so a tab with
                // unsaved edits still asks first: middle-click must not become a second
                // path around that confirmation.
                //
                // preventDefault is scoped to this tab: middle-click triggers autoscroll by default, and
                // intercepting globally would break legitimate middle-click behaviour elsewhere on the page.
                //
                // preventDefault is scoped to this tab: middle-click otherwise starts
                // autoscroll, and intercepting it globally would break legitimate
                // middle-click behaviour elsewhere on the page.
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                {/* min-w-0 is what makes the ellipsis work: flex children size to content and refuse to shrink by default
                    min-w-0 is what makes truncation possible: a flex child defaults
                    to its content width and refuses to shrink below it. */}
                <span className='text-12px flex items-center gap-4px min-w-0'>
                  {/* Site icon (browser tabs) */}
                  {tab.favicon && (
                    <img
                      src={tab.favicon}
                      alt=''
                      className='w-12px h-12px flex-shrink-0 rd-2px'
                      // Hide silently on load failure
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  {/* Only the title text shrinks and ellipsizes; icons and indicators stay fully visible.
                      The title attribute carries the full text so nothing is lost to truncation.
                      Only the title text shrinks and ellipsizes; icons and indicators
                      stay fully visible. The title attribute exposes the full text so
                      truncation never hides information. */}
                  <span className='truncate' title={tab.title}>
                    {tab.title}
                  </span>
                  {/* Agent activity indicator */}
                  {tab.agentActive && (
                    <span
                      className='w-6px h-6px rd-full bg-success animate-pulse flex-shrink-0'
                      title={t('preview.browser.agentActiveTooltip')}
                    />
                  )}
                  {/* Unsaved indicator */}
                  {tab.isDirty && (
                    <span
                      className='w-6px h-6px rd-full bg-primary flex-shrink-0'
                      title={t('preview.unsavedChangesTitle')}
                    />
                  )}
                </span>
                {/* The cross *looks* bigger than the plus because the plus sits on a 24px hover box while the
                    cross is a bare icon. So the cross gets the same treatment: a 16px box (one step below the
                    plus's 24px, since it lives inside a tab) with the glyph itself down to 12px, which matches
                    the two visually.
                    The close glyph looked bigger than the plus because the plus sits in a
                    24px hover box while the close icon was bare. Giving it the same kind
                    of box (16px — one step down from the plus's 24px since it lives inside
                    a tab) and trimming the glyph to 12px evens out their visual weight. */}
                <span
                  className='flex items-center justify-center w-16px h-16px rd-4px flex-shrink-0 hover:bg-bg-3 transition-colors'
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <Close theme='outline' size='12' fill={iconColors.secondary} className='hover:fill-primary' />
                </span>
              </div>
            ))
          ) : (
            <div className='text-12px text-t-tertiary px-10px'>{t('preview.noTabs')}</div>
          )}

          {/* New browser tab */}
          {onNewBrowserTab && (
            <div
              className='flex items-center justify-center w-24px h-24px ml-4px rd-4px cursor-pointer flex-shrink-0 hover:bg-bg-3 transition-colors'
              onClick={onNewBrowserTab}
              title={t('preview.browser.newTab')}
            >
              <Plus theme='outline' size='14' fill={iconColors.secondary} />
            </div>
          )}
        </div>

        {/* Collapse panel button */}
        {onClosePanel && (
          <div className='flex items-center h-full px-10px flex-shrink-0 rounded-tr-[16px]'>
            <div
              className='flex items-center justify-center w-20px h-20px rd-4px cursor-pointer hover:bg-bg-3 transition-colors'
              onClick={onClosePanel}
              title={t('preview.collapsePanel')}
            >
              <IconShrink style={{ fontSize: 14, color: iconColors.secondary }} />
            </div>
          </div>
        )}
      </div>

      {/* Left gradient indicator */}
      {showLeftFade && (
        <div
          className='pointer-events-none absolute left-0 top-0 bottom-0 w-32px rounded-tl-[16px]'
          style={{
            background: 'linear-gradient(90deg, var(--bg-2) 0%, transparent 100%)',
          }}
        />
      )}

      {/* Right gradient indicator */}
      {showRightFade && (
        <div
          className='pointer-events-none absolute right-0 top-0 bottom-0 w-32px rounded-tr-[16px]'
          style={{
            background: 'linear-gradient(270deg, var(--bg-2) 0%, transparent 100%)',
          }}
        />
      )}
    </div>
  );
};

export default PreviewTabs;
