/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preview panel related constants
 */

/**
 * Scroll sync debounce time (milliseconds)
 */
export const SCROLL_SYNC_DEBOUNCE = 100;

/**
 * Tab overflow detection threshold (pixels)
 */
export const TAB_OVERFLOW_THRESHOLD = 2;

/**
 * Left/right gradient indicator width (pixels)
 */
export const TAB_FADE_INDICATOR_WIDTH = 32;

/**
 * Toolbar height (pixels)
 */
export const TOOLBAR_HEIGHT = 40;

/**
 * Default split panel ratio (percentage)
 */
export const DEFAULT_SPLIT_RATIO = 50;

/**
 * Minimum split panel width (percentage)
 */
export const MIN_SPLIT_WIDTH = 20;

/**
 * Maximum split panel width (percentage)
 */
export const MAX_SPLIT_WIDTH = 80;

/**
 * Code editor degradation threshold in characters: past it, highlighting and folding switch off to stay responsive. Content is never truncated.
 * Threshold (chars) above which the code editor disables syntax highlighting
 * and folding to stay responsive. Content is never truncated.
 */
export const LARGE_TEXT_VIEWER_THRESHOLD = 30_000;

/**
 * File types with built-in open buttons
 */
export const FILE_TYPES_WITH_BUILTIN_OPEN = ['word', 'ppt', 'pdf', 'excel'] as const;

/**
 * Editable content types
 */
export const EDITABLE_CONTENT_TYPES = ['markdown', 'html', 'code', 'csv'] as const;
