/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImportBackupResult } from '@/common/types/agent/paviiData';

type ImportBackupError = Extract<ImportBackupResult, { success: false }>['error'];

const IMPORT_ERROR_KEYS: Record<ImportBackupError, string> = {
  'invalid-file': 'settings.paviiData.errors.invalidFile',
  'unsupported-version': 'settings.paviiData.errors.unsupportedVersion',
  'password-required': 'settings.paviiData.errors.passwordRequired',
  'wrong-password': 'settings.paviiData.errors.wrongPassword',
  'read-failed': 'settings.paviiData.errors.readFailed',
};

/** i18n key for a failed backup import. */
export function importBackupErrorKey(error: ImportBackupError | undefined): string {
  return (error && IMPORT_ERROR_KEYS[error]) || 'settings.paviiData.errors.unknown';
}

/** True when the user can fix the failure by entering a different password. */
export function isPasswordError(error: ImportBackupError): boolean {
  return error === 'wrong-password' || error === 'password-required';
}

/** File name for a new export, e.g. `pavii-backup-2026-10-23.pavii` (local date). */
export function defaultBackupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `pavii-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.pavii`;
}

/** True for a path or file name ending in `.pavii` (case-insensitive). */
export function isPaviiBackupPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pavii');
}
