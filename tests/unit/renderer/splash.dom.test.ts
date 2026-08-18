/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissSplash } from '@renderer/utils/ui/splash';

const SPLASH_ID = 'pavii-splash';
const FADE_OUT_CLASS = 'pavii-splash-out';

const mountSplash = (): HTMLElement => {
  const el = document.createElement('div');
  el.id = SPLASH_ID;
  document.body.appendChild(el);
  return el;
};

describe('dismissSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('adds the fade-out class immediately and removes the element after 320ms', () => {
    const el = mountSplash();

    dismissSplash();

    expect(el.classList.contains(FADE_OUT_CLASS)).toBe(true);
    expect(document.getElementById(SPLASH_ID)).toBe(el);

    vi.advanceTimersByTime(319);
    expect(document.getElementById(SPLASH_ID)).toBe(el);

    vi.advanceTimersByTime(1);
    expect(document.getElementById(SPLASH_ID)).toBeNull();
  });

  it('is idempotent: a second call while fading schedules no duplicate work', () => {
    const el = mountSplash();

    dismissSplash();
    expect(vi.getTimerCount()).toBe(1);

    expect(() => dismissSplash()).not.toThrow();
    expect(vi.getTimerCount()).toBe(1);

    vi.runAllTimers();
    expect(document.getElementById(SPLASH_ID)).toBeNull();
    expect(el.isConnected).toBe(false);
  });

  it('does nothing and does not throw when the splash element is absent', () => {
    expect(() => dismissSplash()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves an element that already carries the fade-out class alone', () => {
    const el = mountSplash();
    el.classList.add(FADE_OUT_CLASS);

    dismissSplash();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(document.getElementById(SPLASH_ID)).toBe(el);
  });
});
