/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * assistantBranding — display-level rebrand overrides applied on the HTTP
 * adapter. Backend ids ('aionui-assistant', agent_type 'aionrs') are upstream
 * contracts and never change; only displayed name/name_i18n/avatar do.
 */

import { describe, expect, it } from 'vitest';
import {
  BUTLER_ASSISTANT_ID,
  BUTLER_DISPLAY_NAME,
  BUILTIN_AGENT_DISPLAY_NAME,
  applyAgentBranding,
  applyAssistantBranding,
  applyAssistantDetailBranding,
  applyHubExtensionBranding,
  brandAgents,
  brandAssistants,
  brandHubExtensions,
  isButlerAssistantId,
  scrubBrandText,
} from '@/common/utils/assistantBranding';
import { PAVII_AVATAR_DATA_URI } from '@/common/utils/paviiAvatarDataUri';

describe('isButlerAssistantId', () => {
  it('matches the exact backend manifest id', () => {
    expect(isButlerAssistantId('aionui-assistant')).toBe(true);
    expect(BUTLER_ASSISTANT_ID).toBe('aionui-assistant');
  });

  it('matches the builtin-prefixed form', () => {
    expect(isButlerAssistantId('builtin-aionui-assistant')).toBe(true);
  });

  it('rejects unknown ids, empty string, and undefined', () => {
    expect(isButlerAssistantId('my-assistant')).toBe(false);
    expect(isButlerAssistantId('aionui-assistant-2')).toBe(false);
    expect(isButlerAssistantId('')).toBe(false);
    expect(isButlerAssistantId(undefined)).toBe(false);
  });
});

describe('applyAssistantBranding', () => {
  it('overrides name, every name_i18n locale, and avatar for the butler assistant', () => {
    const branded = applyAssistantBranding({
      id: 'aionui-assistant',
      name: 'AionUi Butler',
      name_i18n: { 'en-US': 'AionUi Butler', 'zh-CN': 'AionUi 管家', 'ja-JP': 'AionUi バトラー' },
      avatar: 'old-avatar.png',
    });

    expect(branded.name).toBe(BUTLER_DISPLAY_NAME);
    expect(branded.name_i18n).toEqual({
      'en-US': 'Your Pavii',
      'zh-CN': 'Your Pavii',
      'ja-JP': 'Your Pavii',
    });
    expect(branded.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('brands the builtin-prefixed id too', () => {
    const branded = applyAssistantBranding({ id: 'builtin-aionui-assistant', name: 'AionUi Butler' });
    expect(branded.name).toBe('Your Pavii');
    expect(branded.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('leaves name_i18n undefined when the source has none', () => {
    const branded = applyAssistantBranding({ id: 'aionui-assistant', name: 'AionUi Butler' });
    expect(branded.name_i18n).toBeUndefined();
  });

  it('replaces the upstream Aion brand logo with the Pavii mark', () => {
    const branded = applyAssistantBranding({
      id: 'bare:632f31d2',
      name: 'Aion CLI',
      avatar: '/api/assets/logos/brand/aion.svg',
    });
    expect(branded.name).toBe('Pavii CLI');
    expect(branded.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('keeps custom avatars on assistants that merely run on the aionrs engine', () => {
    const branded = applyAssistantBranding({
      id: 'word-creator',
      name: 'Word Creator',
      avatar: '/api/assistants/word-creator/avatar?v=17',
    });
    expect(branded.avatar).toBe('/api/assistants/word-creator/avatar?v=17');
  });

  it('passes non-butler assistants through with identical contents', () => {
    const other = {
      id: 'user-writer',
      name: 'Writer',
      name_i18n: { 'en-US': 'Writer', 'zh-CN': '写作助手' },
      avatar: 'writer.png',
    };
    const snapshot = structuredClone(other);
    const result = applyAssistantBranding(other);
    expect(result).toBe(other);
    expect(result).toEqual(snapshot);
  });

  it('overrides the avatar with a PNG data URI', () => {
    const branded = applyAssistantBranding({ id: 'aionui-assistant', name: 'AionUi Butler' });
    expect(branded.avatar).toMatch(/^data:image\/png;base64,/);
  });
});

describe('brandAssistants', () => {
  it('maps only butler rows in a mixed list', () => {
    const rows = brandAssistants([
      { id: 'aionui-assistant', name: 'AionUi Butler' },
      { id: 'user-writer', name: 'Writer' },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Your Pavii', 'Writer']);
  });

  it('returns an empty array unchanged', () => {
    expect(brandAssistants([])).toEqual([]);
  });

  it('passes non-array payloads through untouched', () => {
    const notArray = { error: 'nope' } as unknown as Parameters<typeof brandAssistants>[0];
    expect(brandAssistants(notArray)).toBe(notArray);
    expect(brandAssistants(undefined as unknown as Parameters<typeof brandAssistants>[0])).toBeUndefined();
    expect(brandAssistants(null as unknown as Parameters<typeof brandAssistants>[0])).toBeNull();
  });
});

describe('applyAssistantDetailBranding', () => {
  it('overrides name, name_i18n, and avatar under .profile for the butler detail', () => {
    const branded = applyAssistantDetailBranding({
      id: 'aionui-assistant',
      profile: {
        name: 'AionUi Butler',
        name_i18n: { 'en-US': 'AionUi Butler', 'zh-CN': 'AionUi 管家' },
        avatar: 'old.png',
      },
    });

    expect(branded.profile.name).toBe('Your Pavii');
    expect(branded.profile.name_i18n).toEqual({ 'en-US': 'Your Pavii', 'zh-CN': 'Your Pavii' });
    expect(branded.profile.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('sets the avatar even when the source detail has none', () => {
    const branded = applyAssistantDetailBranding({
      id: 'builtin-aionui-assistant',
      profile: { name: 'AionUi Butler', name_i18n: {} },
    });
    expect(branded.profile.avatar).toBe(PAVII_AVATAR_DATA_URI);
    expect(branded.profile.name_i18n).toEqual({});
  });

  it('passes non-butler details through with identical contents', () => {
    const detail = {
      id: 'user-writer',
      profile: { name: 'Writer', name_i18n: { 'en-US': 'Writer' }, avatar: 'w.png' },
    };
    const snapshot = structuredClone(detail);
    const result = applyAssistantDetailBranding(detail);
    // Non-butler details are scrubbed (new object) but stay content-identical
    // when they contain no upstream brand strings.
    expect(result).toEqual(snapshot);
  });
});

describe('scrubBrandText', () => {
  it('replaces each upstream brand name with its Pavii equivalent', () => {
    expect(scrubBrandText('Aion CLI')).toBe('Pavii CLI');
    expect(scrubBrandText('AionUi Butler')).toBe('Your Pavii');
    expect(scrubBrandText('AionCore')).toBe('Pavii Engine');
    expect(scrubBrandText('AionUi')).toBe('Pavii.Ai');
  });

  it('leaves neutral text unchanged', () => {
    const neutral = 'A friendly writing assistant';
    expect(scrubBrandText(neutral)).toBe(neutral);
    expect(scrubBrandText('')).toBe('');
  });
});

describe('applyAgentBranding', () => {
  it("renames the built-in 'aionrs' agent and all its name_i18n locales", () => {
    const branded = applyAgentBranding({
      agent_type: 'aionrs',
      name: 'Aion CLI',
      name_i18n: { 'en-US': 'Aion CLI', 'zh-CN': 'Aion 命令行' },
    });
    expect(branded.name).toBe(BUILTIN_AGENT_DISPLAY_NAME);
    expect(branded.name).toBe('Pavii CLI');
    expect(branded.name_i18n).toEqual({ 'en-US': 'Pavii CLI', 'zh-CN': 'Pavii CLI' });
  });

  it('sets both icon and avatar to the Pavii PNG data URI for the aionrs agent', () => {
    const branded = applyAgentBranding({
      agent_type: 'aionrs',
      name: 'Aion CLI',
      icon: 'old-icon.svg',
      avatar: 'old-avatar.png',
    });
    expect(branded.icon).toBe(PAVII_AVATAR_DATA_URI);
    expect(branded.avatar).toBe(PAVII_AVATAR_DATA_URI);
    expect(branded.icon).toMatch(/^data:image\/png;base64,/);
  });

  it('sets icon and avatar even when the aionrs agent has none', () => {
    const branded = applyAgentBranding({ agent_type: 'aionrs', name: 'Aion CLI' });
    expect(branded.icon).toBe(PAVII_AVATAR_DATA_URI);
    expect(branded.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('leaves non-aionrs agent icon and avatar untouched', () => {
    const acp = { agent_type: 'acp', name: 'Claude Code', icon: 'claude.svg', avatar: 'claude.png' };
    const result = applyAgentBranding(acp);
    expect(result.icon).toBe('claude.svg');
    expect(result.avatar).toBe('claude.png');
  });

  it('leaves name_i18n undefined when the aionrs agent has none', () => {
    const branded = applyAgentBranding({ agent_type: 'aionrs', name: 'Aion CLI' });
    expect(branded.name_i18n).toBeUndefined();
  });

  it("passes non-aionrs agents (e.g. 'acp') through with identical contents", () => {
    const acp = { agent_type: 'acp', name: 'Claude Code', name_i18n: { 'en-US': 'Claude Code' } };
    const snapshot = structuredClone(acp);
    const result = applyAgentBranding(acp);
    expect(result).toBe(acp);
    expect(result).toEqual(snapshot);
  });

  it('passes agents without an agent_type through unchanged', () => {
    const agent = { name: 'Mystery' };
    expect(applyAgentBranding(agent)).toBe(agent);
  });

  it("brands rows keyed by backend 'aionrs' even when agent_type is 'acp'", () => {
    const branded = applyAgentBranding({
      agent_type: 'acp',
      backend: 'aionrs',
      name: 'Aion CLI',
      name_i18n: { 'en-US': 'Aion CLI' },
      icon: 'old-icon.svg',
      avatar: 'old-avatar.png',
    });
    expect(branded.name).toBe(BUILTIN_AGENT_DISPLAY_NAME);
    expect(branded.name_i18n).toEqual({ 'en-US': 'Pavii CLI' });
    expect(branded.icon).toBe(PAVII_AVATAR_DATA_URI);
    expect(branded.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('only scrubs text for rows with neither agent_type nor backend aionrs', () => {
    const acp = {
      agent_type: 'acp',
      backend: 'claude',
      name: 'AionUi Claude adapter',
      icon: 'claude.svg',
      avatar: 'claude.png',
    };
    const result = applyAgentBranding(acp);
    expect(result.name).toBe('Pavii.Ai Claude adapter');
    // Scrub-only rows keep their own icon/avatar — no Pavii identity override.
    expect(result.icon).toBe('claude.svg');
    expect(result.avatar).toBe('claude.png');
  });
});

describe('brandAgents', () => {
  it('maps only aionrs rows in a mixed list', () => {
    const rows = brandAgents([
      { agent_type: 'aionrs', name: 'Aion CLI' },
      { agent_type: 'acp', name: 'Claude Code' },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Pavii CLI', 'Claude Code']);
  });

  it('returns an empty array unchanged', () => {
    expect(brandAgents([])).toEqual([]);
  });

  it('passes non-array payloads through untouched', () => {
    const notArray = 'oops' as unknown as Parameters<typeof brandAgents>[0];
    expect(brandAgents(notArray)).toBe(notArray);
  });
});

describe('applyHubExtensionBranding', () => {
  it('scrubs upstream brand names from display_name, description, and author', () => {
    const branded = applyHubExtensionBranding({
      display_name: 'AionUi Claude Code adapter',
      description: 'Connects AionCore to the AionHub catalog',
      author: 'AionUi Team',
    });
    expect(branded.display_name).toBe('Pavii.Ai Claude Code adapter');
    expect(branded.description).toBe('Connects Pavii Engine to the Pavii Hub catalog');
    expect(branded.author).toBe('Pavii.Ai Team');
  });

  it('leaves author undefined when the source has none', () => {
    const branded = applyHubExtensionBranding({
      display_name: 'AionUi bridge',
      description: 'plain',
    });
    expect(branded.display_name).toBe('Pavii.Ai bridge');
    expect(branded.author).toBeUndefined();
  });

  it('returns unbranded rows by reference with identical contents', () => {
    const extension = {
      display_name: 'Weather toolkit',
      description: 'Forecast helpers',
      author: 'Acme',
    };
    const snapshot = structuredClone(extension);
    const result = applyHubExtensionBranding(extension);
    expect(result).toBe(extension);
    expect(result).toEqual(snapshot);
  });
});

describe('brandHubExtensions', () => {
  it('maps only branded rows in a mixed list', () => {
    const rows = brandHubExtensions([
      { display_name: 'AionUi Claude Code adapter', description: 'via AionHub' },
      { display_name: 'Weather toolkit', description: 'Forecast helpers' },
    ]);
    expect(rows.map((r) => r.display_name)).toEqual(['Pavii.Ai Claude Code adapter', 'Weather toolkit']);
    expect(rows[0].description).toBe('via Pavii Hub');
  });

  it('returns an empty array unchanged', () => {
    expect(brandHubExtensions([])).toEqual([]);
  });

  it('passes non-array payloads through untouched', () => {
    const notArray = { error: 'nope' } as unknown as Parameters<typeof brandHubExtensions>[0];
    expect(brandHubExtensions(notArray)).toBe(notArray);
    expect(brandHubExtensions(undefined as unknown as Parameters<typeof brandHubExtensions>[0])).toBeUndefined();
  });
});
