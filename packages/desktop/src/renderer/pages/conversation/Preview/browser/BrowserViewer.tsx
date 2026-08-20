/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import WebviewHost from '@/renderer/components/media/WebviewHost';
import {
  BROWSER_BLANK_URL,
  BROWSER_SESSION_PARTITION,
  browserTabLabelFromUrl,
  resolveAddressBarInput,
} from './constants';

export interface BrowserViewerProps {
  /** Current address of this tab */
  url: string;
  /** Id of the owning preview tab */
  tabId: string;
  /** Persist the new address back onto the tab */
  onUrlChange: (tabId: string, url: string) => void;
  /** Persist the page title back onto the tab */
  onTitleChange: (tabId: string, title: string) => void;
  /** Persist the site favicon back onto the tab */
  onFaviconChange: (tabId: string, favicon: string) => void;
}

/**
 * In-app browser view.
 *
 * Three differences from URLViewer, which are also why it exists separately:
 * 1. it uses the shared persistent partition, so sessions survive across tabs and projects;
 * 2. the address bar searches on a plain keyword rather than only prefixing https://;
 * 3. it writes address, title and icon back to the tab, so a restart can restore them.
 *
 * Differs from URLViewer in exactly the three ways that justify a separate
 * component: a shared persistent partition (sign-in survives), keyword search in
 * the address bar, and writing address/title/favicon back onto the owning tab so
 * the browser can be restored after a restart.
 */
const BrowserViewer: React.FC<BrowserViewerProps> = ({ url, tabId, onUrlChange, onTitleChange, onFaviconChange }) => {
  const handleUrlChange = useCallback((next: string) => onUrlChange(tabId, next), [tabId, onUrlChange]);

  const handleTitleChange = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (trimmed) onTitleChange(tabId, trimmed);
    },
    [tabId, onTitleChange]
  );

  const handleFaviconChange = useCallback(
    (favicon: string) => onFaviconChange(tabId, favicon),
    [tabId, onFaviconChange]
  );

  /**
   * about:blank fires no title event, so derive the label here — otherwise a
   * fresh tab would keep showing the previous page's title.
   */
  const handleDidFinishLoad = useCallback(() => {
    if (url === BROWSER_BLANK_URL) onTitleChange(tabId, browserTabLabelFromUrl(url));
  }, [url, tabId, onTitleChange]);

  return (
    <WebviewHost
      url={url || BROWSER_BLANK_URL}
      partition={BROWSER_SESSION_PARTITION}
      showNavBar
      className='bg-bg-1'
      resolveUrlInput={resolveAddressBarInput}
      onUrlChange={handleUrlChange}
      onTitleChange={handleTitleChange}
      onFaviconChange={handleFaviconChange}
      onDidFinishLoad={handleDidFinishLoad}
    />
  );
};

export default BrowserViewer;
