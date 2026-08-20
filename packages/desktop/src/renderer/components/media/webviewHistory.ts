/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Records addresses WebviewHost navigated to itself, so the url prop's echo can be recognised.
 *
 * Background: a browser tab feeds the current address back as the url prop, so every internal
 * navigation closes a loop (internal navigation -> onUrlChange -> parent updates the prop ->
 * reset). Resetting unconditionally would treat every navigation as a new preview target, reloading the page and losing all its state.
 *
 * Why a set rather than just the last address: a redirect chain fires did-navigate repeatedly.
 * After A->B, remembering only B means A's late-arriving echo reads as an external change and
 * sets the address back to A, giving A->B->A forever until the renderer crashes.
 *
 * Remembers addresses recently navigated to from inside WebviewHost so the `url`
 * prop's echo can be recognised.
 *
 * Context: a browser tab feeds its current address back down to WebviewHost as the
 * `url` prop, so every internal navigation forms a loop (internal nav → onUrlChange
 * → parent updates prop → reset). Resetting unconditionally would treat each of its
 * own navigations as "the preview target changed" and reload, losing page state.
 *
 * Why a *set* rather than just the last target: a redirect chain fires did-navigate
 * several times in a row. After A→B only B is remembered, so when A's echo finally
 * arrives it looks external, the address is set back to A, the redirect runs again,
 * and A→B→A ping-pongs until the renderer process dies.
 */
export class InternalNavTracker {
  private readonly recent: string[] = [];

  /** plenty for one redirect chain */
  private static readonly MAX_TRACKED = 10;

  /** record a navigation initiated from inside the host */
  record(url: string): void {
    if (!url) return;
    const existing = this.recent.indexOf(url);
    if (existing !== -1) this.recent.splice(existing, 1);
    this.recent.push(url);
    if (this.recent.length > InternalNavTracker.MAX_TRACKED) this.recent.shift();
  }

  /**
   * Is this url prop the echo of an internal navigation? If so, consume the record and return true.
   *
   * Is this `url` prop the echo of an internal navigation? Consumes the entry and
   * returns true when so.
   */
  consumeEcho(url: string): boolean {
    const index = this.recent.indexOf(url);
    if (index === -1) return false;
    this.recent.splice(index, 1);
    return true;
  }

  /** Cleared after an external address change (switching tabs or preview files) */
  clear(): void {
    this.recent.length = 0;
  }
}

/**
 * Decide whether a url prop change should clear the self-managed back/forward history.
 *
 * Decide whether a change to the `url` prop should clear the self-managed
 * back/forward history.
 *
 * @param incomingUrl the new `url` prop value
 * @param tracker the internal-navigation tracker
 * @returns true true when this is an external change and a reset is due
 */
export const shouldResetHistoryForUrlProp = (incomingUrl: string, tracker: InternalNavTracker): boolean => {
  // The prop is merely the echo of an internal navigation → keep history.
  return !tracker.consumeEcho(incomingUrl);
};
