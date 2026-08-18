/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isActionableSlackEvent, stripSlackMention } from '@process/services/channels/slackBridge';

describe('stripSlackMention', () => {
  it('removes the bot mention and trims', () => {
    expect(stripSlackMention('<@U123BOT> hello there', 'U123BOT')).toBe('hello there');
  });

  it('removes every occurrence of the mention', () => {
    expect(stripSlackMention('<@U123BOT> hi <@U123BOT> again', 'U123BOT')).toBe('hi  again');
  });

  it('passes text through (trimmed) when botId is null', () => {
    expect(stripSlackMention('  <@U123BOT> hello  ', null)).toBe('<@U123BOT> hello');
  });

  it('leaves other user mentions intact', () => {
    expect(stripSlackMention('<@UOTHER> hello', 'U123BOT')).toBe('<@UOTHER> hello');
  });

  it('returns empty string for a mention-only message', () => {
    expect(stripSlackMention('<@U123BOT>', 'U123BOT')).toBe('');
  });
});

describe('isActionableSlackEvent', () => {
  const dm = {
    type: 'message',
    channel: 'D111',
    channel_type: 'im',
    user: 'U222',
    text: 'hi',
  };

  it('accepts a human DM message with channel_type im', () => {
    expect(isActionableSlackEvent(dm, 'UBOT')).toBe(true);
  });

  it('accepts an app_mention event', () => {
    expect(
      isActionableSlackEvent({ type: 'app_mention', channel: 'C333', user: 'U222', text: '<@UBOT> hi' }, 'UBOT')
    ).toBe(true);
  });

  it('rejects bot-authored events', () => {
    expect(isActionableSlackEvent({ ...dm, bot_id: 'B999' }, 'UBOT')).toBe(false);
  });

  it('rejects events with a subtype', () => {
    expect(isActionableSlackEvent({ ...dm, subtype: 'message_changed' }, 'UBOT')).toBe(false);
  });

  it('rejects the bridge bot echoing its own messages', () => {
    expect(isActionableSlackEvent({ ...dm, user: 'UBOT' }, 'UBOT')).toBe(false);
  });

  it('rejects events missing channel, user, or type', () => {
    expect(isActionableSlackEvent({ ...dm, channel: undefined }, 'UBOT')).toBe(false);
    expect(isActionableSlackEvent({ ...dm, user: undefined }, 'UBOT')).toBe(false);
    expect(isActionableSlackEvent({ ...dm, type: undefined }, 'UBOT')).toBe(false);
    expect(isActionableSlackEvent(undefined, 'UBOT')).toBe(false);
  });

  it('rejects plain channel messages that are not DMs', () => {
    expect(isActionableSlackEvent({ ...dm, channel_type: 'channel' }, 'UBOT')).toBe(false);
    expect(isActionableSlackEvent({ ...dm, channel_type: undefined }, 'UBOT')).toBe(false);
  });

  it('still accepts a DM when the own bot user id is unknown', () => {
    expect(isActionableSlackEvent(dm, null)).toBe(true);
  });
});
