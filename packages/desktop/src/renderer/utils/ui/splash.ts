/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

const SPLASH_ID = 'pavii-splash';
const FADE_OUT_CLASS = 'pavii-splash-out';
const FADE_OUT_MS = 320;

/**
 * Fade out and remove the launch splash painted by index.html.
 * Idempotent; a no-op when the splash element is absent (web build, tests).
 */
export function dismissSplash(): void {
  const el = document.getElementById(SPLASH_ID);
  if (!el || el.classList.contains(FADE_OUT_CLASS)) return;
  el.classList.add(FADE_OUT_CLASS);
  window.setTimeout(() => el.remove(), FADE_OUT_MS);
}
