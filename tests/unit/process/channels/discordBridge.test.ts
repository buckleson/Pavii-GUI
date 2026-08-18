/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  chunkDiscordMessage,
  isActionableDiscordMessage,
  stripDiscordMention,
} from '@process/services/channels/discordBridge';

describe('chunkDiscordMessage', () => {
  it('returns a single chunk for short messages', () => {
    expect(chunkDiscordMessage('hello')).toEqual(['hello']);
  });

  it('returns a single chunk at exactly the limit', () => {
    const text = 'a'.repeat(2000);
    expect(chunkDiscordMessage(text)).toEqual([text]);
  });

  it('prefers newline breaks past half the window', () => {
    const first = 'a'.repeat(80);
    const second = 'b'.repeat(50);
    const chunks = chunkDiscordMessage(`${first}\n${second}`, 100);
    expect(chunks[0]).toBe(first);
    expect(chunks[1].trim().length === second.length || chunks[1].includes('b')).toBe(true);
    expect(chunks.join('')).toContain(second);
  });

  it('hard-breaks when there is no usable newline', () => {
    const text = 'x'.repeat(250);
    const chunks = chunkDiscordMessage(text, 100);
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
  });

  it('reassembles to the original text and emits no empty chunks', () => {
    const text = `${'line one '.repeat(30)}\n${'line two '.repeat(30)}\n${'tail'.repeat(10)}`;
    const chunks = chunkDiscordMessage(text, 120);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0);
  });
});

describe('stripDiscordMention', () => {
  it('removes plain and nickname mention forms', () => {
    expect(stripDiscordMention('<@123> hello', '123')).toBe('hello');
    expect(stripDiscordMention('<@!123> hello', '123')).toBe('hello');
  });

  it('removes multiple mentions of the bot', () => {
    expect(stripDiscordMention('<@123> hi <@123> there', '123')).toBe('hi  there');
  });

  it('keeps other users mentions intact', () => {
    expect(stripDiscordMention('<@999> hello', '123')).toBe('<@999> hello');
  });

  it('trims without a bot id', () => {
    expect(stripDiscordMention('  hello  ', null)).toBe('hello');
  });
});

describe('isActionableDiscordMessage', () => {
  const human = { id: 'U1' };

  it('accepts a human DM (no guild_id)', () => {
    expect(isActionableDiscordMessage({ channel_id: 'C1', author: human, content: 'hi' }, 'BOT')).toBe(true);
  });

  it('accepts a guild message that mentions the bot', () => {
    expect(
      isActionableDiscordMessage({ channel_id: 'C1', guild_id: 'G1', author: human, mentions: [{ id: 'BOT' }] }, 'BOT')
    ).toBe(true);
  });

  it('rejects a guild message without a bot mention', () => {
    expect(
      isActionableDiscordMessage({ channel_id: 'C1', guild_id: 'G1', author: human, mentions: [{ id: 'X' }] }, 'BOT')
    ).toBe(false);
  });

  it('rejects bot authors and own echoes', () => {
    expect(isActionableDiscordMessage({ channel_id: 'C1', author: { id: 'B2', bot: true } }, 'BOT')).toBe(false);
    expect(isActionableDiscordMessage({ channel_id: 'C1', author: { id: 'BOT' } }, 'BOT')).toBe(false);
  });

  it('rejects missing channel, author, or event', () => {
    expect(isActionableDiscordMessage(undefined, 'BOT')).toBe(false);
    expect(isActionableDiscordMessage({ author: human }, 'BOT')).toBe(false);
    expect(isActionableDiscordMessage({ channel_id: 'C1' }, 'BOT')).toBe(false);
  });

  it('accepts a DM even when the bot id is unknown yet', () => {
    expect(isActionableDiscordMessage({ channel_id: 'C1', author: human }, null)).toBe(true);
  });
});
