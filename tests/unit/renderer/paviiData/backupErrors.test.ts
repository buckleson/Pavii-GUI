/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  defaultBackupFileName,
  importBackupErrorKey,
  isPasswordError,
  isPaviiBackupPath,
} from '@/renderer/components/settings/PaviiBackup/backupErrors';

describe('importBackupErrorKey', () => {
  it.each([
    ['invalid-file', 'settings.paviiData.errors.invalidFile'],
    ['unsupported-version', 'settings.paviiData.errors.unsupportedVersion'],
    ['password-required', 'settings.paviiData.errors.passwordRequired'],
    ['wrong-password', 'settings.paviiData.errors.wrongPassword'],
    ['read-failed', 'settings.paviiData.errors.readFailed'],
  ] as const)('maps %s to its i18n key', (error, key) => {
    expect(importBackupErrorKey(error)).toBe(key);
  });

  it('falls back to the unknown key when the error is missing', () => {
    expect(importBackupErrorKey(undefined)).toBe('settings.paviiData.errors.unknown');
  });

  it('falls back to the unknown key for an unrecognised error code', () => {
    const unknownCode = 'disk-on-fire' as Parameters<typeof importBackupErrorKey>[0];
    expect(importBackupErrorKey(unknownCode)).toBe('settings.paviiData.errors.unknown');
  });
});

describe('isPasswordError', () => {
  it('treats wrong-password and password-required as retryable with a new password', () => {
    expect(isPasswordError('wrong-password')).toBe(true);
    expect(isPasswordError('password-required')).toBe(true);
  });

  it('rejects non-password failures', () => {
    expect(isPasswordError('invalid-file')).toBe(false);
    expect(isPasswordError('unsupported-version')).toBe(false);
    expect(isPasswordError('read-failed')).toBe(false);
  });
});

describe('defaultBackupFileName', () => {
  it('formats the local date with zero-padded month and day', () => {
    expect(defaultBackupFileName(new Date(2026, 0, 5))).toBe('pavii-backup-2026-01-05.pavii');
  });

  it('keeps two-digit months and days unchanged', () => {
    expect(defaultBackupFileName(new Date(2026, 11, 31, 23, 59))).toBe('pavii-backup-2026-12-31.pavii');
  });

  it('uses the current date when no date is passed', () => {
    expect(defaultBackupFileName()).toMatch(/^pavii-backup-\d{4}-\d{2}-\d{2}\.pavii$/);
  });
});

describe('isPaviiBackupPath', () => {
  it('accepts .pavii paths regardless of extension case', () => {
    expect(isPaviiBackupPath('C:\\Users\\me\\backup.pavii')).toBe(true);
    expect(isPaviiBackupPath('/home/me/Backup.PAVII')).toBe(true);
  });

  it('rejects other extensions, empty strings and names that only contain .pavii', () => {
    expect(isPaviiBackupPath('C:\\Users\\me\\backup.zip')).toBe(false);
    expect(isPaviiBackupPath('')).toBe(false);
    expect(isPaviiBackupPath('/home/me/backup.pavii.txt')).toBe(false);
  });
});
