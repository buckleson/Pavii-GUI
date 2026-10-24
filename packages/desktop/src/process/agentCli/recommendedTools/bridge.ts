/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pavii agent tools bridge. The services are imported on first use,
 * so registering these handlers costs nothing at launch.
 */

import { ipcBridge } from '@/common';
import { RECOMMENDED_TOOLS } from '@/common/types/agent/recommendedTools';

const loadToolState = () => import('./toolState');
const loadInstaller = () => import('./install');

export function initRecommendedToolsBridge(): void {
  ipcBridge.recommendedTools.getStatus.provider(async () => {
    try {
      return await (await loadToolState()).getRecommendedToolStates();
    } catch (error) {
      console.warn('[RecommendedTools] status failed:', error);
      return RECOMMENDED_TOOLS.map((tool) => ({ id: tool.id, installed: false }));
    }
  });
  ipcBridge.recommendedTools.install.provider(async ({ tools }) => {
    try {
      return await (await loadInstaller()).installRecommendedTools(tools);
    } catch (error) {
      console.warn('[RecommendedTools] install failed:', error);
      return { outcomes: tools.map((id) => ({ id, success: false, error: 'command-failed' })) };
    }
  });
  ipcBridge.recommendedTools.setEnabled.provider(async ({ id, enabled }) => {
    try {
      await (await loadToolState()).setRecommendedToolEnabled(id, enabled);
    } catch (error) {
      console.warn('[RecommendedTools] switching the tool failed:', error);
      throw error;
    }
  });
}
