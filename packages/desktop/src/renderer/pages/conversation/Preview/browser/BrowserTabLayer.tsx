/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import type { PreviewTab, PreviewTabPatch } from '../context/PreviewContext';
import BrowserViewer from './BrowserViewer';

export interface BrowserTabLayerProps {
  /** Every browser-type tab */
  browserTabs: PreviewTab[];
  /** Active tab id (may not be a browser tab) */
  activeTabId: string | null;
  /** Patch fields back onto a tab */
  updateTab: (tabId: string, patch: PreviewTabPatch) => void;
}

/**
 * Always-mounted browser layer.
 *
 * The preview panel used to render only the active tab. That is fine for documents and fatal
 * for browsers: switching away and back reloads the page, losing scroll position, form
 * contents and any uncommitted action, and interrupting whatever the agent was doing.
 *
 * So this layer keeps every browser tab mounted and only toggles visibility: the webview
 * process survives and page state is kept intact. Inactive tabs hide with visibility rather
 * than display:none, so they keep real dimensions and need no relayout when you switch back.
 *
 * The preview panel renders only the active tab, which is fine for documents but
 * fatal for a browser: switching away and back would reload the page, losing
 * scroll position, form input, and any in-flight agent operation. This layer keeps
 * every browser tab mounted and only toggles visibility, so the webview process
 * survives. Inactive tabs are hidden via `visibility` rather than `display:none`
 * so they retain real dimensions and need no relayout when shown again.
 */
const BrowserTabLayer: React.FC<BrowserTabLayerProps> = ({ browserTabs, activeTabId, updateTab }) => {
  const handleUrlChange = useCallback(
    (tabId: string, url: string) => {
      // Address lives in content, like other tab types
      updateTab(tabId, { content: url });
    },
    [updateTab]
  );

  const handleTitleChange = useCallback((tabId: string, title: string) => updateTab(tabId, { title }), [updateTab]);

  const handleFaviconChange = useCallback(
    (tabId: string, favicon: string) => updateTab(tabId, { metadata: { favicon } }),
    [updateTab]
  );

  if (browserTabs.length === 0) return null;

  const isBrowserActive = browserTabs.some((tab) => tab.id === activeTabId);

  return (
    <div className='relative flex-1 overflow-hidden' style={{ display: isBrowserActive ? undefined : 'none' }}>
      {browserTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className='absolute inset-0 flex flex-col'
            style={{
              visibility: isActive ? 'visible' : 'hidden',
              pointerEvents: isActive ? undefined : 'none',
              zIndex: isActive ? 1 : 0,
            }}
          >
            <BrowserViewer
              url={tab.content}
              tabId={tab.id}
              onUrlChange={handleUrlChange}
              onTitleChange={handleTitleChange}
              onFaviconChange={handleFaviconChange}
            />
          </div>
        );
      })}
    </div>
  );
};

export default BrowserTabLayer;
