/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Launch-time restore offer for the default `.pavii` backup, its dismissal,
 * and the backup info shown in settings.
 */

import type { RestoreOffer } from '@/common/types/agent/paviiData';
import { ProcessConfig } from '@process/utils/initStorage';
import { getDefaultBackupPath, readAccountUid, readBackupMeta } from './backup';
import { asArray, engine, isRecord } from './engineApi';

const DISMISSED_KEY = 'paviiData.restoreDismissedFor';
export const LAST_AUTO_SAVE_KEY = 'paviiData.lastAutoSaveAt';

/** True when this profile has no providers, no custom agents and no conversations. */
async function isProfileEmpty(): Promise<boolean> {
  const [providers, agents, conversations] = await Promise.all([
    engine.get<unknown>('/api/providers'),
    engine.get<unknown>('/api/agents/management'),
    engine.get<unknown>('/api/conversations?limit=1'),
  ]);
  if (asArray(providers).length > 0) return false;
  if (asArray(agents).some((agent) => isRecord(agent) && agent.agent_source === 'custom')) return false;
  const items = isRecord(conversations) ? asArray(conversations.items) : asArray(conversations);
  return items.length === 0;
}

/**
 * Offer a restore when the default backup exists, has not been dismissed,
 * and either the profile is empty or a different Pavii account is signed in.
 */
export async function getRestoreOffer(): Promise<RestoreOffer | null> {
  const backupPath = getDefaultBackupPath();
  const meta = await readBackupMeta(backupPath);
  if (!meta) return null;
  const dismissedFor = await ProcessConfig.get(DISMISSED_KEY).catch((): undefined => undefined);
  if (dismissedFor === meta.createdAt) return null;

  const base = { path: backupPath, createdAt: meta.createdAt, hasSecrets: meta.hasSecrets, counts: meta.counts };
  if (await isProfileEmpty()) return { ...base, reason: 'empty-profile' };
  const accountUid = await readAccountUid().catch((): undefined => undefined);
  if (accountUid && meta.accountUid && accountUid !== meta.accountUid) return { ...base, reason: 'new-account' };
  return null;
}

/** Stop offering the current default backup (a newer backup is offered again). */
export async function dismissRestoreOffer(): Promise<void> {
  const meta = await readBackupMeta(getDefaultBackupPath());
  if (meta) await ProcessConfig.set(DISMISSED_KEY, meta.createdAt);
}

export async function getBackupInfo(): Promise<{ path: string; lastAutoSaveAt?: number }> {
  const lastAutoSaveAt = await ProcessConfig.get(LAST_AUTO_SAVE_KEY).catch((): undefined => undefined);
  return { path: getDefaultBackupPath(), ...(typeof lastAutoSaveAt === 'number' ? { lastAutoSaveAt } : {}) };
}
