/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { fromApiConversation } from '@/common/adapter/apiModelMapper';
import { PAVII_AVATAR_DATA_URI } from '@/common/utils/paviiAvatarDataUri';

type Snapshot = { id?: string; name?: string; avatar?: string };

const convo = (assistant: Snapshot) =>
  fromApiConversation({ id: 'c1', name: 'chat', assistant } as never) as unknown as { assistant: Snapshot };

describe('conversation snapshot branding (header/sider identity)', () => {
  it('replaces the butler engine-avatar URL with the Pavii mark', () => {
    const out = convo({
      id: 'aionui-assistant',
      name: 'AionUi Butler',
      avatar: '/api/assistants/aionui-assistant/avatar?v=123',
    });
    expect(out.assistant.name).toBe('Your Pavii');
    expect(out.assistant.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('replaces a butler emoji avatar with the Pavii mark', () => {
    const out = convo({ id: 'aionui-assistant', name: 'AionUi Butler', avatar: '🤵' });
    expect(out.assistant.avatar).toBe(PAVII_AVATAR_DATA_URI);
  });

  it('leaves non-butler assistants with their own avatars', () => {
    const out = convo({ id: 'word-creator', name: 'Word Creator', avatar: '/api/assistants/word-creator/avatar' });
    expect(out.assistant.name).toBe('Word Creator');
    expect(out.assistant.avatar).toBe('/api/assistants/word-creator/avatar');
  });

  it('still scrubs id-less snapshots by name', () => {
    const out = convo({ name: 'Aion CLI' });
    expect(out.assistant.name).toBe('Pavii CLI');
  });
});
