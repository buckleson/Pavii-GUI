/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized localStorage keys for the application
 * Centralized management of the application's localStorage keys
 *
 * All localStorage keys should be defined here to:
 * - Avoid key conflicts
 * - Make it easy to find and manage all persisted states
 * - Provide a single source of truth for storage key names
 */
export const STORAGE_KEYS = {
  /** Workspace tree collapse state */
  WORKSPACE_TREE_COLLAPSE: 'aionui_workspace_collapse_state',

  /** Sidebar collapse state */
  SIDEBAR_COLLAPSE: 'aionui_sider_collapsed',

  /** Theme preference */
  THEME: 'aionui_theme',

  /** Language preference */
  LANGUAGE: 'aionui_language',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
