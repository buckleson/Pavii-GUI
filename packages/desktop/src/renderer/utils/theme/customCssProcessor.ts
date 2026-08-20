/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom CSS processing helpers
 * Adds !important to custom CSS and formats it, in one place
 */

import { parse } from 'postcss';

/**
 * Add !important to every CSS declaration
 *
 * Parses with PostCSS into a real AST and appends !important to declarations only, never
 * touching selectors. That handles pseudo-class and pseudo-element selectors correctly
 * (`.btn:hover`, `::before`, `:not()`, `::-webkit-scrollbar-thumb:hover`) and also covers
 * the last declaration in a block when it has no trailing semicolon. Declarations that already carry !important are left alone.
 *
 * @param css - The original CSS
 * @returns The processed CSS, with !important on every declaration
 */
export const addImportantToAll = (css: string): string => {
  if (!css || !css.trim()) {
    return '';
  }

  try {
    const root = parse(css);
    root.walkDecls((decl) => {
      if (!decl.important) {
        decl.important = true;
      }
    });
    return root.toString();
  } catch {
    // On invalid CSS (PostCSS throws CssSyntaxError) the input is returned unchanged, so a parse
    // failure never interrupts applying the theme.
    return css;
  }
};

/**
 * Wrap custom CSS with an explanatory comment
 * @param css - The processed CSS
 * @returns The CSS with its comment header
 */
export const wrapCustomCss = (css: string): string => {
  if (!css || !css.trim()) {
    return '';
  }

  return `
/* User custom styles - !important added automatically to raise specificity */
/* User Custom Styles - Auto !important for highest priority */
${css}
  `.trim();
};

/**
 * Process custom CSS end to end
 * @param css - The original CSS
 * @returns The processed and wrapped CSS
 */
export const processCustomCss = (css: string): string => {
  const processed = addImportantToAll(css);
  return wrapCustomCss(processed);
};

/**
 * Validate CSS syntax (a simple check)
 * @param css - The CSS
 * @returns Whether the CSS is valid
 */
export const validateCss = (css: string): { valid: boolean; error?: string } => {
  if (!css || !css.trim()) {
    return { valid: true };
  }

  try {
    // Simple check: are the braces balanced
    const openBraces = (css.match(/\{/g) || []).length;
    const closeBraces = (css.match(/\}/g) || []).length;

    if (openBraces !== closeBraces) {
      return {
        valid: false,
        error: 'Unmatched braces: { and } count does not match',
      };
    }

    // Check for the basic shape of CSS
    if (openBraces > 0 && !css.includes(':')) {
      return {
        valid: false,
        error: 'Invalid CSS: no property declarations found',
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
