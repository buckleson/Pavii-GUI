/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared application constants
 */

// In-app browser =====

/**
 * Persistent session partition shared by every browser tab.
 *
 * Lives in common rather than the renderer: the renderer creates webviews with
 * it and the main process clears sessions and caches with it - both sides must use the same string, and two hardcoded copies drift apart eventually.
 *
 * The persistent session partition shared by every in-app browser tab. It lives in
 * common rather than the renderer because the renderer uses it to create webviews
 * while the main process uses it to clear sign-in state and caches; two hardcoded
 * copies would eventually drift apart.
 *
 * One fixed value (rather than per-tab / per-project) is deliberate: sessions must be shared
 * across every tab and project and survive restarts - that is what lets the user clear login walls for the agent.
 *
 * A single fixed value (rather than per-tab or per-project) is deliberate: sign-in
 * state must be shared across all tabs and projects and survive restarts, so a
 * user can log in once on the agent's behalf.
 */
// NOTE: keeps the legacy spelling on purpose. This is a persisted Electron
// session partition holding the user's browser cookies/logins; renaming it
// would orphan every saved sign-in. The user-visible MCP name below is what
// carries the Pavii branding.
export const BROWSER_SESSION_PARTITION = 'persist:aionui-browser';

/**
 * Registration name of the built-in browser MCP.
 *
 * Lives in common for the same reason as above, only stronger: the main process registers
 * the MCP under this name and the renderer recognizes "the agent is driving the browser" in
 * the tool-call stream to light the badge. Two copies eventually diverge - and the symptom, a badge that never lights, is painful to trace.
 *
 * Registered name of the built-in browser MCP.
 *
 * Lives in common for the same reason as the partition above, only more so: the
 * main process registers the built-in MCP under this name, while the renderer uses
 * it to recognise "the agent is driving the browser" in the tool-call stream and
 * light up the activity badge. Both sides must agree exactly; separate copies would
 * eventually drift, and the symptom of drift is a badge that silently never lights.
 */
export const BUILTIN_BROWSER_MCP_NAME = 'pavii-browser';

/**
 * Pre-rebrand name of the same server. Still recognised so browser activity in
 * conversations created before the rename keeps rendering, and so startup
 * migration can rename the existing row instead of inserting a duplicate.
 */
export const LEGACY_BUILTIN_BROWSER_MCP_NAME = 'aionui-browser';

// ===== File handling constants =====

/** Timestamp separator for temp files */
export const AIONUI_TIMESTAMP_SEPARATOR = '_aionui_';

/** Regex matching and stripping the timestamp suffix */
export const AIONUI_TIMESTAMP_REGEX = /_aionui_\d{13}(\.\w+)?$/;
export const AIONUI_FILES_MARKER = '[[AION_FILES]]';

// ===== Media type constants =====

/** Supported image file extensions */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'] as const;

/** File extension to MIME type map */
export const MIME_TYPE_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

/** MIME type to file extension map */
export const MIME_TO_EXT_MAP: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  bmp: '.bmp',
  tiff: '.tiff',
  'svg+xml': '.svg',
};

/** Default image file extension */
export const DEFAULT_IMAGE_EXTENSION = '.png';

// ===== WebUI constants =====

/** WebUI default port: 25808 for production, 25809 for development, 25810 for multi-instance dev */
export const WEBUI_DEFAULT_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if (process.env.AIONUI_MULTI_INSTANCE === '1') return 25810;
  return 25809;
})();

export const TEAM_MODE_ENABLED = true;

// ===== AI provider constants =====

// Stable ID for the Google Auth virtual provider.
// Shared between frontend (useModelProviderList) and backend (SystemActions).
export const GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini';
