/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isSlashCommandFetchEnabled, isSlashCommandListEnabled } from '@/common/chat/slash/availability';

describe('isSlashCommandListEnabled', () => {
  it('enables the menu for acp conversations', () => {
    // ACP is the baseline agent type that serves slash commands; if this
    // regressed, "/" would stop opening for the most common conversation kind.
    expect(isSlashCommandListEnabled({ conversation_type: 'acp' })).toBe(true);
  });

  it('enables the menu for aionrs conversations', () => {
    // aionrs is the second supported backend; it shares the same endpoint.
    expect(isSlashCommandListEnabled({ conversation_type: 'aionrs' })).toBe(true);
  });

  it('enables the menu for codex even before its session is active', () => {
    // Regression guard: codex used to be gated on `session_active` for the
    // whole menu, which hid Pavii's builtins and the assistant's skills during
    // warmup and made "/" look broken. Locally known commands must show up
    // immediately, independent of codex readiness.
    expect(isSlashCommandListEnabled({ conversation_type: 'codex' })).toBe(true);
    expect(isSlashCommandListEnabled({ conversation_type: 'codex', codexStatus: 'connecting' })).toBe(true);
  });

  it('keeps the menu disabled for agent types that never serve slash commands', () => {
    // openclaw-gateway / nanobot / remote return an empty list, so opening the
    // menu there would only ever show "no commands".
    expect(isSlashCommandListEnabled({ conversation_type: 'gemini' })).toBe(false);
    expect(isSlashCommandListEnabled({ conversation_type: 'openclaw-gateway' })).toBe(false);
  });

  it('keeps the menu disabled when the conversation type is unknown', () => {
    // Conversation metadata can arrive late; an undefined type must fail closed
    // rather than enabling a menu for a backend that cannot answer.
    expect(isSlashCommandListEnabled({})).toBe(false);
    expect(isSlashCommandListEnabled({ conversation_type: undefined, codexStatus: 'session_active' })).toBe(false);
  });
});

describe('isSlashCommandFetchEnabled', () => {
  it('allows the fetch for acp and aionrs regardless of codexStatus', () => {
    // codexStatus is meaningless for non-codex conversations; letting a stale
    // value leak in would block fetches for perfectly healthy sessions.
    expect(isSlashCommandFetchEnabled({ conversation_type: 'acp' })).toBe(true);
    expect(isSlashCommandFetchEnabled({ conversation_type: 'acp', codexStatus: 'connecting' })).toBe(true);
    expect(isSlashCommandFetchEnabled({ conversation_type: 'aionrs', codexStatus: null })).toBe(true);
  });

  it('blocks the fetch for codex until the session is active', () => {
    // The backend `/slash-commands` endpoint 404s while codex CLI is still
    // connecting; fetching early produces console errors and an error toast.
    expect(isSlashCommandFetchEnabled({ conversation_type: 'codex', codexStatus: 'connecting' })).toBe(false);
    expect(isSlashCommandFetchEnabled({ conversation_type: 'codex', codexStatus: 'session_error' })).toBe(false);
  });

  it('blocks the fetch for codex when the status has not been reported yet', () => {
    // Status is null/undefined during the first render after a conversation
    // opens — the riskiest moment, because that is exactly when the endpoint
    // 404s.
    expect(isSlashCommandFetchEnabled({ conversation_type: 'codex' })).toBe(false);
    expect(isSlashCommandFetchEnabled({ conversation_type: 'codex', codexStatus: null })).toBe(false);
  });

  it('allows the fetch for codex once the session is active', () => {
    // The WS `slash_commands_updated` nudge re-runs this check; it must flip to
    // true or codex's own commands would never merge into the menu.
    expect(isSlashCommandFetchEnabled({ conversation_type: 'codex', codexStatus: 'session_active' })).toBe(true);
  });

  it('blocks the fetch for unknown or missing conversation types', () => {
    // The fetch gate must never be looser than the list gate.
    expect(isSlashCommandFetchEnabled({ conversation_type: 'gemini' })).toBe(false);
    expect(isSlashCommandFetchEnabled({})).toBe(false);
    expect(isSlashCommandFetchEnabled({ conversation_type: undefined, codexStatus: 'session_active' })).toBe(false);
  });
});
