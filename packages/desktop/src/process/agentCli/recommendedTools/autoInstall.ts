/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { RecommendedToolId, RecommendedToolInstallRecords } from '@/common/types/agent/recommendedTools';
import { getInstallRecords, installRecommendedTools } from './install';
import { getRecommendedToolStatus } from './status';

/**
 * Tools the automatic install should try: not installed, and not already
 * failed with this app version (the user retries those in Settings → Tools).
 */
export function selectAutoInstallTools(
  installed: ReadonlyMap<RecommendedToolId, boolean>,
  records: RecommendedToolInstallRecords,
  appVersion: string
): RecommendedToolId[] {
  return [...installed.entries()]
    .filter(([id, isInstalled]) => {
      if (isInstalled) return false;
      const record = records[id];
      return !(record && !record.success && record.appVersion === appVersion);
    })
    .map(([id]) => id);
}

/**
 * Install the missing tools one after another, then tell the renderer (it
 * shows a short notice). Nothing is sent when there was nothing to install.
 * Failures are only logged.
 */
export async function runRecommendedToolsAutoInstall(): Promise<void> {
  try {
    const installed = new Map(getRecommendedToolStatus().map((status) => [status.id, status.installed]));
    const ids = selectAutoInstallTools(installed, await getInstallRecords(), app.getVersion());
    if (ids.length === 0) return;
    console.log(`[RecommendedTools] automatic install: ${ids.join(', ')}`);
    const result = await installRecommendedTools(ids);
    if (result.outcomes.length > 0) ipcBridge.recommendedTools.autoInstallFinished.emit(result);
  } catch (error) {
    console.warn('[RecommendedTools] automatic install failed:', error);
  }
}
