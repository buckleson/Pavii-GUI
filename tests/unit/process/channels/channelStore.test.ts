/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannelStore, writeChannelStore } from '@process/services/channels/channelStore';
import type { ChannelStore } from '@process/services/channels/channelStore';

const mocks = vi.hoisted(() => ({ configDir: '' }));

vi.mock('@process/utils/utils', () => ({
  getConfigPath: () => mocks.configDir,
}));

describe('channelStore', () => {
  beforeEach(() => {
    mocks.configDir = mkdtempSync(join(tmpdir(), 'pavii-channel-store-'));
  });

  afterEach(() => {
    rmSync(mocks.configDir, { recursive: true, force: true });
  });

  it('returns an empty store when the file does not exist', async () => {
    await expect(readChannelStore()).resolves.toEqual({});
  });

  it('round-trips a store through write and read', async () => {
    const store: ChannelStore = {
      slack: {
        enabled: true,
        credentials: { botToken: 'xoxb-test', appToken: 'xapp-test' },
        conversations: { C123: 'conv-1', D456: 'conv-2' },
      },
    };
    await writeChannelStore(store);
    await expect(readChannelStore()).resolves.toEqual(store);
  });

  it('returns an empty store for a corrupt file', async () => {
    writeFileSync(join(mocks.configDir, 'pavii-channels.json'), '{ not json !!', 'utf-8');
    await expect(readChannelStore()).resolves.toEqual({});
  });

  it('returns an empty store for a non-object JSON payload', async () => {
    writeFileSync(join(mocks.configDir, 'pavii-channels.json'), '"just a string"', 'utf-8');
    await expect(readChannelStore()).resolves.toEqual({});
  });

  it('overwrites the previous store on write', async () => {
    await writeChannelStore({ slack: { enabled: true } });
    await writeChannelStore({ discord: { enabled: false } });
    await expect(readChannelStore()).resolves.toEqual({ discord: { enabled: false } });
  });
});
