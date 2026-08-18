/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { getConfigPath } from '../../utils/utils';

/**
 * Local persistence for the app-hosted channel bridges (Slack/Discord):
 * credentials, enabled flags, and the channel→conversation mapping.
 * Lives next to the app config; tokens never leave the machine.
 */

export type BridgePlatformStore = {
  enabled?: boolean;
  credentials?: { botToken: string; appToken?: string };
  conversations?: Record<string, string>;
};

export type ChannelStore = {
  slack?: BridgePlatformStore;
  discord?: BridgePlatformStore;
};

const STORE_FILE = 'pavii-channels.json';

const storePath = (): string => join(getConfigPath(), STORE_FILE);

export async function readChannelStore(): Promise<ChannelStore> {
  try {
    const parsed: unknown = JSON.parse(await readFile(storePath(), 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as ChannelStore) : {};
  } catch {
    return {};
  }
}

export async function writeChannelStore(store: ChannelStore): Promise<void> {
  await writeFile(storePath(), JSON.stringify(store, null, 2), 'utf-8');
}
