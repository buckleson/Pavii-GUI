/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recommended agent tools bridge. The services are imported on first use,
 * so registering these handlers costs nothing at launch.
 */

import { ipcBridge } from '@/common';
import { RECOMMENDED_TOOLS } from '@/common/types/agent/recommendedTools';

const loadStatus = () => import('./status');
const loadInstaller = () => import('./install');
const loadFirstRunOffer = () => import('./firstRunOffer');

export function initRecommendedToolsBridge(): void {
  ipcBridge.recommendedTools.getStatus.provider(async () => {
    try {
      return (await loadStatus()).getRecommendedToolStatus();
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
  ipcBridge.recommendedTools.getFirstRunOffer.provider(async () => {
    try {
      return await (await loadFirstRunOffer()).getFirstRunOffer();
    } catch (error) {
      console.warn('[RecommendedTools] first-run offer check failed:', error);
      return false;
    }
  });
  ipcBridge.recommendedTools.dismissFirstRunOffer.provider(async () => {
    try {
      await (await loadFirstRunOffer()).dismissFirstRunOffer();
    } catch (error) {
      console.warn('[RecommendedTools] dismissing the first-run offer failed:', error);
    }
  });
}
