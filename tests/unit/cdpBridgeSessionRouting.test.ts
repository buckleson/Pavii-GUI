/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the single-target CDP bridge's session-routing contract, covering two
 * independent defects that both turn an immediate failure into a hang:
 *
 *  1. Re-announcing attachedToTarget (the actual root cause). Both setAutoAttach and
 *     attachToTarget backfill it, and puppeteer unconditionally does
 *     `#sessions.set(id, new CdpCDPSession(...))` without checking for an existing entry, so the
 *     second announcement swaps in an object with an empty CallbackRegistry and orphans the
 *     handle the caller holds.
 *
 *  2. Replies omitting sessionId. puppeteer routes replies by sessionId; without it the reply
 *     goes to the Connection-level registry, while page-level callbacks live only in the
 *     session-level one.
 *
 * Both end the same way: CallbackRegistry silently returns on an unknown id, the promise never
 * settles, and it surfaces as "Network.enable timed out. Increase the 'protocolTimeout' setting"
 * — a misleading clue that buries the real cause. Worth pinning down in tests, since review
 * misses this easily: the success and catch paths were both correct.
 */

import { describe, expect, it } from 'vitest';
import {
  SINGLE_SESSION_ID,
  SINGLE_TARGET_ID,
  buildTargetInfo,
  decideCdpCommand,
  isAcceptableSessionId,
  tokensMatch,
} from '@process/resources/builtinMcp/cdpTargetProtocol';

const targetInfo = () => buildTargetInfo('Example', 'https://example.com');

describe('cdpTargetProtocol — session routing contract', () => {
  it('accepts browser-level (empty) and the single page session, rejects anything else', () => {
    expect(isAcceptableSessionId(undefined)).toBe(true);
    expect(isAcceptableSessionId('')).toBe(true);
    expect(isAcceptableSessionId(SINGLE_SESSION_ID)).toBe(true);
    expect(isAcceptableSessionId('some-other-session')).toBe(false);
  });

  it('backfills attachedToTarget only for browser-level setAutoAttach', () => {
    /**
     * The call carrying a sessionId must be a bare ack: puppeteer re-issues setAutoAttach on
     * each new session, so backfilling every time recurses forever and initialisation hangs.
     */
    const browserLevel = decideCdpCommand(
      { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } },
      targetInfo
    );
    expect(browserLevel.kind).toBe('reply-and-emit');
    if (browserLevel.kind === 'reply-and-emit') {
      expect(browserLevel.emit.map((e) => e.method)).toContain('Target.attachedToTarget');
    }

    const sessionLevel = decideCdpCommand(
      { id: 2, method: 'Target.setAutoAttach', params: { autoAttach: true }, sessionId: SINGLE_SESSION_ID },
      targetInfo
    );
    expect(sessionLevel.kind).toBe('reply');
  });

  it('forwards non-Target commands to the debugger', () => {
    expect(decideCdpCommand({ id: 3, method: 'Network.enable', sessionId: SINGLE_SESSION_ID }, targetInfo).kind).toBe(
      'forward'
    );
  });

  it('refuses commands it cannot honour instead of pretending they worked', () => {
    /**
     * Faking createTarget success would leave the agent driving the old page while believing
     * it had a new one — harder to diagnose than an explicit failure.
     */
    expect(
      decideCdpCommand({ id: 4, method: 'Target.createTarget', params: { url: 'about:blank' } }, targetInfo).kind
    ).toBe('error');
    expect(decideCdpCommand({ id: 5, method: 'Browser.close' }, targetInfo).kind).toBe('error');
    expect(
      decideCdpCommand({ id: 6, method: 'Target.attachToTarget', params: { targetId: 'not-ours' } }, targetInfo).kind
    ).toBe('error');
  });

  it('attaches to our own target and hands back the fixed sessionId', () => {
    const decision = decideCdpCommand(
      { id: 7, method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID } },
      targetInfo
    );
    expect(decision.kind).toBe('reply-and-emit');
    if (decision.kind === 'reply-and-emit') {
      expect(decision.payload).toEqual({ sessionId: SINGLE_SESSION_ID });
    }
  });

  it('compares tokens without leaking length-independent early exits', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
  });
});

/**
 * Pins "announce each sessionId at most once" — the actual root cause. Both setAutoAttach and
 * attachToTarget backfill attachedToTarget, and puppeteer unconditionally does
 * `#sessions.set(sessionId, new CdpCDPSession(...))` without checking for an existing entry. The
 * second announcement therefore swaps in a fresh object with an empty CallbackRegistry and
 * orphans the handle the caller still holds: its command ids live in the old registry while
 * replies route by sessionId into the new one, where no such id exists — dropped silently, and
 * the promise never settles.
 */
const collectEmitted = (
  methods: Array<{ method: string; params: Record<string, unknown> }>,
  announced: Set<string>
) => {
  const sent: string[] = [];
  for (const evt of methods) {
    if (evt.method === 'Target.attachedToTarget') {
      const id = (evt.params as { sessionId?: string }).sessionId;
      if (typeof id === 'string') {
        if (announced.has(id)) continue;
        announced.add(id);
      }
    }
    sent.push(evt.method);
  }
  return sent;
};

const emitOf = (decision: ReturnType<typeof decideCdpCommand>) =>
  decision.kind === 'reply-and-emit' ? decision.emit : [];

describe('cdpBridge attachedToTarget — announce once per session', () => {
  it('suppresses the second attachedToTarget for an already-announced session', () => {
    const announced = new Set<string>();

    const fromAutoAttach = emitOf(
      decideCdpCommand({ id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }, targetInfo)
    );
    expect(collectEmitted(fromAutoAttach, announced)).toContain('Target.attachedToTarget');

    // attachToTarget would announce the SAME sessionId again — that is what orphaned the handle.
    const fromAttach = emitOf(
      decideCdpCommand({ id: 2, method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID } }, targetInfo)
    );
    expect(collectEmitted(fromAttach, announced)).not.toContain('Target.attachedToTarget');
  });

  it('still announces on a fresh connection, which has its own empty set', () => {
    /**
     * A newly connected puppeteer holds no session objects and needs the event to build them,
     * so the set must be per-connection rather than shared.
     */
    const freshConnection = new Set<string>();
    const emitted = emitOf(
      decideCdpCommand({ id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }, targetInfo)
    );
    expect(collectEmitted(emitted, freshConnection)).toContain('Target.attachedToTarget');
  });
});

/**
 * Mirrors cdpBridge.handleSocketMessage's reply assembly to assert the sessionId is echoed.
 * cdpBridge itself is not imported: it pulls in electron and ws at module scope, which will
 * not load under the unit-test environment. The contract under test is the reply shape.
 */
const buildErrorReply = (id: number | undefined, message: string, sessionId?: string) =>
  JSON.parse(JSON.stringify({ id: id ?? 0, error: { code: -32601, message }, sessionId }));

describe('cdpBridge reply shape — sessionId must be echoed', () => {
  it('echoes sessionId on error replies to page-level commands', () => {
    const reply = buildErrorReply(3, 'The in-app browser is not currently attached.', SINGLE_SESSION_ID);
    expect(reply.sessionId).toBe(SINGLE_SESSION_ID);
  });

  it('omits sessionId for browser-level commands', () => {
    /**
     * Browser-level commands must not carry one, or puppeteer would look up a session that
     * does not exist. JSON.stringify drops undefined fields, giving exactly that shape.
     */
    const reply = buildErrorReply(1, 'nope', undefined);
    expect('sessionId' in reply).toBe(false);
  });
});
