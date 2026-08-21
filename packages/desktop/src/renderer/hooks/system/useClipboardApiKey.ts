/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { looksLikeApiKey } from '@/renderer/components/settings/SettingsModal/contents/models/freeModelTypes';

/**
 * Offer the API key the user just copied from a provider's website.
 *
 * A provider site cannot hand a key back to a desktop app — `pavii://add-provider`
 * exists but only a site we control can invoke it, and Google AI Studio or Groq
 * never will. The clipboard is the one channel the user already uses: they copy
 * the key on the provider's page, and the next thing they do is come back here.
 *
 * So the hook is armed when the user opens a provider's key page, and reads the
 * clipboard exactly once when the window regains focus. Deliberate limits:
 *
 * - it only reads while armed, never speculatively;
 * - the value is offered, never applied on its own — the user confirms;
 * - the value is never logged, and is dropped as soon as it is used or dismissed;
 * - a denied or empty clipboard is silent, because the add-provider form is
 *   pre-filled anyway and manual paste still works.
 */
export const useClipboardApiKey = () => {
  const [candidate, setCandidate] = useState<string | null>(null);
  const armedRef = useRef(false);

  /** Start watching for a key. Called when the user opens a provider's key page. */
  const arm = useCallback(() => {
    armedRef.current = true;
  }, []);

  /** Stop watching and forget any pending candidate. */
  const reset = useCallback(() => {
    armedRef.current = false;
    setCandidate(null);
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (!armedRef.current) return;
      // One shot: disarm before the async read so a rapid re-focus cannot
      // queue a second prompt for the same trip to the provider.
      armedRef.current = false;
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (looksLikeApiKey(text)) setCandidate(text.trim());
        })
        .catch(() => {
          // Permission denied or no clipboard access: manual paste still works.
        });
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return { candidate, arm, reset };
};
