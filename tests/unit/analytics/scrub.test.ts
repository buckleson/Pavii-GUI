/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { REDACTED, scrubEvent, type AnalyticsCaptureResult } from '@/common/analytics/scrub';
import { APP_URL_HOST } from '@/common/analytics/config';

/**
 * A worst-case autocapture event from the packaged Windows app: a `file://`
 * install path, element text lifted from a chat message, an API key, a
 * workspace file path, an email, an over-long prompt and a multi-line value.
 */
const hostileEvent = (): AnalyticsCaptureResult => ({
  event: '$autocapture',
  properties: {
    $current_url:
      'file:///C:/Users/alice/AppData/Local/Programs/PaviiAi/out/renderer/index.html#/settings/skills/detail/tax-helper',
    $pathname: '/C:/Users/alice/AppData/Local/Programs/PaviiAi/out/renderer/index.html',
    $host: '',
    $el_text: 'Explain my 2024 tax return',
    title: 'Pavii.Ai — divorce paperwork draft',
    $referrer: 'file:///C:/Users/alice/AppData/Local/Programs/PaviiAi/index.html',
    distinct_id: '5b1e6f2a-9d3c-4f8b-a1e2-7c9d0f3a5b6e',
    skill: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
    provider: 'C:\\Users\\alice\\Documents\\secret.md',
    reason: 'contact alice@example.com for help',
    ok: true,
    session_seconds: 42,
    prompt: 'x'.repeat(3000),
    model_platform: 'line one\nline two',
  },
  $set: {
    $initial_current_url: 'file:///C:/Users/alice/AppData/Local/Programs/PaviiAi/index.html',
  },
  $set_once: {
    $initial_pathname: '/C:/Users/alice/AppData/Local/Programs/PaviiAi/index.html',
    $initial_host: '',
  },
});

describe('scrubEvent — nothing sensitive survives', () => {
  it('leaves no trace of paths, keys, prompts or emails anywhere in the payload', () => {
    const serialised = JSON.stringify(scrubEvent(hostileEvent()));

    expect(serialised).not.toContain('alice');
    expect(serialised).not.toContain('sk-ant');
    expect(serialised).not.toContain('tax return');
    expect(serialised).not.toContain('divorce');
    expect(serialised).not.toContain('secret.md');
    expect(serialised).not.toContain('alice@example.com');
    expect(serialised).not.toContain('file:');
    expect(serialised).not.toContain('AppData');
    expect(serialised).not.toContain('C:');
    expect(serialised).not.toContain('x'.repeat(200));
  });

  it('rewrites every URL-shaped key to the synthetic origin, including $set_once', () => {
    const out = scrubEvent(hostileEvent());
    expect(out?.properties.$current_url).toBe('app://pavii/settings/skills/detail/:skillName');
    expect(out?.properties.$pathname).toBe('/settings/skills/detail/:skillName');
    expect(out?.properties.$host).toBe(APP_URL_HOST);
    // $initial_* is persisted to localStorage, so it has to be caught in $set/$set_once too.
    expect(out?.$set?.$initial_current_url).toBe('app://pavii/settings/skills/detail/:skillName');
    expect(out?.$set_once?.$initial_pathname).toBe('/settings/skills/detail/:skillName');
    expect(out?.$set_once?.$initial_host).toBe(APP_URL_HOST);
  });

  it('redacts secrets and paths and flags them so a leak upstream is alertable', () => {
    const out = scrubEvent(hostileEvent());
    expect(out?.properties.skill).toBe(REDACTED);
    expect(out?.properties.provider).toBe(REDACTED);
    expect(out?.properties.reason).toBe(REDACTED);
    expect(out?.properties.$scrub_secret_hit).toBe(true);
    expect(out?.properties.$scrub_path_hit).toBe(true);
  });

  it('deletes the autocapture text carriers outright', () => {
    const out = scrubEvent(hostileEvent());
    expect(out?.properties).not.toHaveProperty('$el_text');
    expect(out?.properties).not.toHaveProperty('title');
    expect(out?.properties).not.toHaveProperty('$referrer');
  });

  it('drops unknown property keys, over-long values and multi-line values', () => {
    const out = scrubEvent(hostileEvent());
    expect(out?.properties).not.toHaveProperty('prompt'); // not in ALLOWED_PROPERTY_KEYS
    expect(out?.properties).not.toHaveProperty('model_platform'); // multi-line
  });

  it('keeps the legitimate dimensions and PostHog identifiers intact', () => {
    const out = scrubEvent(hostileEvent());
    expect(out?.properties.ok).toBe(true);
    expect(out?.properties.session_seconds).toBe(42);
    expect(out?.properties.distinct_id).toBe('5b1e6f2a-9d3c-4f8b-a1e2-7c9d0f3a5b6e');
  });
});

describe('scrubEvent — fails closed', () => {
  it('returns null rather than an unscrubbed event when anything throws', () => {
    const exploding = {
      event: 'app_opened',
      get properties(): Record<string, unknown> {
        throw new Error('boom');
      },
    } as unknown as AnalyticsCaptureResult;
    expect(scrubEvent(exploding)).toBeNull();
  });

  it('passes a null result straight through', () => {
    expect(scrubEvent(null)).toBeNull();
  });

  it('drops event classes we never want', () => {
    for (const event of ['$copy_autocapture', '$dead_click', '$exception', '$web_vitals']) {
      expect(scrubEvent({ event, properties: {} })).toBeNull();
    }
  });
});

describe('scrubEvent — curated events', () => {
  it('passes a well-formed event through unchanged', () => {
    const out = scrubEvent({
      event: 'conversation_started',
      properties: { agent_kind: 'aionrs', skill_count: 3, mcp_count: 0, route: '/guid' },
    });
    expect(out?.properties).toMatchObject({
      agent_kind: 'aionrs',
      skill_count: 3,
      mcp_count: 0,
      route: '/guid',
    });
    expect(out?.properties).not.toHaveProperty('$scrub_secret_hit');
    expect(out?.properties).not.toHaveProperty('$scrub_path_hit');
  });

  it('drops a nested sensitive value rather than the whole event', () => {
    const out = scrubEvent({
      event: 'mcp_connected',
      properties: { transport: 'stdio', reason: { detail: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } },
    });
    expect(JSON.stringify(out)).not.toContain('ghp_');
    expect(out?.properties.transport).toBe('stdio');
  });

  it('redacts an opaque high-entropy token in one of our own dimensions', () => {
    const out = scrubEvent({
      event: 'skill_enabled',
      properties: { skill: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', is_builtin: false },
    });
    expect(out?.properties.skill).toBe(REDACTED);
    expect(out?.properties.is_builtin).toBe(false);
  });

  it('redacts an $elements_chain whose class names carry a path', () => {
    const out = scrubEvent({
      event: '$autocapture',
      properties: {
        $elements_chain: 'div:nth-child="2"attr__class="file-C:\\Users\\alice\\notes.md"',
        route: '/guid',
      },
    });
    expect(out?.properties.$elements_chain).toBe(REDACTED);
    expect(out?.properties.$scrub_path_hit).toBe(true);
    expect(JSON.stringify(out)).not.toContain('alice');
  });

  it('keeps a clean $elements_chain, which is long but harmless once masked', () => {
    const chain = `div:nth-child="2";button:nth-child="1"attr__class="${'flex items-center gap-8px '.repeat(20)}"`;
    const out = scrubEvent({ event: '$autocapture', properties: { $elements_chain: chain, route: '/guid' } });
    expect(out?.properties.$elements_chain).toBe(chain);
  });
});
