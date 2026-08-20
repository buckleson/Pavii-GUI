/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared constants and address-bar input parsing for in-app browser tabs
 */

/**
 * Re-exported from common for convenient use by the browser code.
 * It lives in common because the main process needs the same value when clearing sessions.
 *
 * Re-exported from common so browser code can reach it locally. It is defined in
 * common because the main process needs the same value when clearing sign-in state.
 */
export { BROWSER_SESSION_PARTITION } from '@/common/config/constants';

/** Initial address for a freshly opened browser tab. */
export const BROWSER_BLANK_URL = 'about:blank';

/**
 * Placeholder title for a browser tab, replaced once the page title arrives.
 */
export const BROWSER_TAB_FALLBACK_TITLE = 'New Tab';

/**
 * Browser tab limit: past it the user is asked to close old tabs, so one webview process per
 * tab cannot exhaust memory.
 *
 * Cap on browser tabs: each tab is a separate webview process, so an unbounded
 * count would exhaust memory. Beyond this the user is asked to close old tabs.
 */
export const MAX_BROWSER_TABS = 10;

/** Default search engine for non-URL input. */
const SEARCH_URL_TEMPLATE = 'https://www.bing.com/search?q={query}';

/**
 * Schemes with no host part — passed through untouched, never guessed at.
 */
const PASSTHROUGH_SCHEMES = ['about:', 'data:', 'blob:', 'chrome:', 'devtools:', 'view-source:'];

/** Input that explicitly carries a scheme. */
const EXPLICIT_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * x`。
 * IP。
 *
 * Host-like input: `example.com`, `localhost:3000`, `192.168.1.5/x`. Requires a
 * TLD-ish suffix, or localhost/IP with a port.
 */
const HOST_LIKE_RE = /^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;
const LOCALHOST_RE = /^localhost(?::\d+)?(?:[/?#].*)?$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/;

/**
 * Parse address-bar input into a navigable URL.
 *
 * The input may be a full URL, a bare domain or a sentence to search for; this decides where to go.
 * Anything containing a space is treated as a search: `example.com/a b` is not a valid host,
 * while "how to configure nginx" is plainly a query.
 *
 * Resolve address-bar input into a navigable URL. Input may be a full URL, a
 * bare hostname, or a search phrase. Anything containing whitespace is treated
 * as a search query.
 */
export const resolveAddressBarInput = (raw: string): string | null => {
  const input = raw.trim();
  if (!input) return null;

  const lower = input.toLowerCase();
  if (PASSTHROUGH_SCHEMES.some((scheme) => lower.startsWith(scheme))) return input;
  if (EXPLICIT_SCHEME_RE.test(input)) return input;

  // Whitespace never appears in a hostname, so this is a search phrase.
  if (!/\s/.test(input)) {
    if (LOCALHOST_RE.test(input) || IPV4_RE.test(input) || HOST_LIKE_RE.test(input)) {
      return `https://${input}`;
    }
  }

  return SEARCH_URL_TEMPLATE.replace('{query}', encodeURIComponent(input));
};

/**
 * Compact label for a tab title, falling back to the hostname until the page provides one.
 * Compact label for a tab title, falling back to the hostname before a real
 * page title arrives.
 */
export const browserTabLabelFromUrl = (url: string): string => {
  if (!url || url === BROWSER_BLANK_URL) return BROWSER_TAB_FALLBACK_TITLE;
  try {
    const parsed = new URL(url);
    return parsed.hostname || BROWSER_TAB_FALLBACK_TITLE;
  } catch {
    return BROWSER_TAB_FALLBACK_TITLE;
  }
};
