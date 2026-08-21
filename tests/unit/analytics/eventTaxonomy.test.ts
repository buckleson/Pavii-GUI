/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_PROPERTY_KEYS, ANALYTICS_EVENTS, isAnalyticsDisabled, posthogKey } from '@/common/analytics/config';
import { scrubEvent } from '@/common/analytics/scrub';

const RENDERER = join(process.cwd(), 'packages', 'desktop', 'src', 'renderer');

describe('event taxonomy', () => {
  it('uses object_verb names and no duplicates', () => {
    const names = Object.values(ANALYTICS_EVENTS);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    }
  });

  it('survives the scrub with every declared property key', () => {
    // A property key that is not allowlisted is silently dropped, so an event
    // declared with one would look empty on the dashboard. Prove each key we
    // actually send round-trips.
    const sample: Record<string, unknown> = {};
    for (const key of ALLOWED_PROPERTY_KEYS) sample[key] = 'ok';
    const out = scrubEvent({ event: ANALYTICS_EVENTS.appOpened, properties: sample });
    for (const key of ALLOWED_PROPERTY_KEYS) {
      expect(out?.properties, `property "${key}" was dropped by the scrub`).toHaveProperty(key);
    }
  });

  it('drops a property key that was never allowlisted', () => {
    const out = scrubEvent({
      event: ANALYTICS_EVENTS.mcpConnected,
      properties: { transport: 'stdio', serverUrl: 'https://internal.example.com/mcp' },
    });
    expect(out?.properties).toHaveProperty('transport');
    expect(out?.properties).not.toHaveProperty('serverUrl');
  });
});

describe('analytics config', () => {
  it('falls back to the built-in public project key when POSTHOG_KEY is empty', () => {
    // Vite `define` substitutes '' rather than undefined, so the fallback must
    // be a truthiness check — `??` would keep the empty string and break capture.
    const previous = process.env.POSTHOG_KEY;
    process.env.POSTHOG_KEY = '';
    expect(posthogKey()).toMatch(/^phc_/);
    process.env.POSTHOG_KEY = 'phc_override';
    expect(posthogKey()).toBe('phc_override');
    if (previous === undefined) delete process.env.POSTHOG_KEY;
    else process.env.POSTHOG_KEY = previous;
  });

  it('treats only 1/true as disabled', () => {
    const previous = process.env.POSTHOG_DISABLED;
    for (const [value, expected] of [
      ['', false],
      ['0', false],
      ['false', false],
      ['1', true],
      ['true', true],
    ] as const) {
      process.env.POSTHOG_DISABLED = value;
      expect(isAnalyticsDisabled()).toBe(expected);
    }
    if (previous === undefined) delete process.env.POSTHOG_DISABLED;
    else process.env.POSTHOG_DISABLED = previous;
  });
});

describe('ph-no-capture markers', () => {
  // Autocapture runs in allowlist mode, so these markers are defence in depth —
  // but removing one silently widens what a future config change would expose.
  const cases: Array<[string, string]> = [
    ['message list', 'pages/conversation/Messages/MessageList.tsx'],
    ['composer', 'components/chat/SendBox/index.tsx'],
    ['conversation history row', 'pages/conversation/GroupedHistory/ConversationRow.tsx'],
    ['workspace file tree', 'pages/conversation/explorer/ExplorerPanel.tsx'],
    ['file preview panel', 'pages/conversation/Preview/components/PreviewPanel/PreviewPanel.tsx'],
    ['settings pages', 'pages/settings/components/SettingsPageWrapper.tsx'],
    ['markdown renderer', 'components/Markdown/index.tsx'],
  ];

  it.each(cases)('%s carries ph-no-capture', (_label, relativePath) => {
    const source = readFileSync(join(RENDERER, relativePath), 'utf-8');
    expect(source).toContain('ph-no-capture');
  });
});
