/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessConfig } from '@process/utils/initStorage';
import { getRecommendedToolStatus } from './status';

const DISMISSED_KEY = 'recommendedTools.firstRunDismissed';

/** True when no recommended tool is installed and the user has not dismissed the prompt. */
export async function getFirstRunOffer(): Promise<boolean> {
  const dismissed = await ProcessConfig.get(DISMISSED_KEY).catch((): undefined => undefined);
  if (dismissed === true) return false;
  return getRecommendedToolStatus().every((status) => !status.installed);
}

/** Never show the first-run prompt again. */
export async function dismissFirstRunOffer(): Promise<void> {
  await ProcessConfig.set(DISMISSED_KEY, true);
}
