/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RecommendedToolId } from '@/common/types/agent/recommendedTools';

const PURPOSE_KEYS: Record<RecommendedToolId, string> = {
  trail: 'settings.recommendedTools.purpose.trail',
  headroom: 'settings.recommendedTools.purpose.headroom',
  graphify: 'settings.recommendedTools.purpose.graphify',
  reach: 'settings.recommendedTools.purpose.reach',
};

const INSTALL_ERROR_KEYS: Record<string, string> = {
  'unsupported-platform': 'settings.recommendedTools.errors.unsupportedPlatform',
  'download-failed': 'settings.recommendedTools.errors.downloadFailed',
  'checksum-mismatch': 'settings.recommendedTools.errors.checksumMismatch',
  'npm-missing': 'settings.recommendedTools.errors.npmMissing',
  timeout: 'settings.recommendedTools.errors.timeout',
  'command-failed': 'settings.recommendedTools.errors.commandFailed',
};

/** i18n key of a Pavii agent tool's one-line purpose. */
export function toolPurposeKey(id: RecommendedToolId): string {
  return PURPOSE_KEYS[id];
}

/** i18n key for a failed install error code; unknown codes map to a generic message. */
export function installErrorKey(error: string | undefined): string {
  return (error && INSTALL_ERROR_KEYS[error]) || 'settings.recommendedTools.errors.unknown';
}
