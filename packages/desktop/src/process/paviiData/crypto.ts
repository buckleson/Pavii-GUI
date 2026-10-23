/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Password encryption for the secrets block of a `.pavii` backup:
 * scrypt (N=2^15, r=8, p=1) → 32-byte key, AES-256-GCM with a 12-byte IV.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import type { PaviiBackupFile } from '@/common/types/agent/paviiData';

export type EncryptedSecrets = NonNullable<PaviiBackupFile['secrets']>;

const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Thrown when the password does not open the secrets (GCM auth tag mismatch). */
export class WrongPasswordError extends Error {
  constructor() {
    super('wrong backup password');
    this.name = 'WrongPasswordError';
  }
}

const deriveKey = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => (error ? reject(error) : resolve(key)));
  });

/** Encrypt `JSON.stringify(secrets)` with `password`. */
export async function encryptSecrets(secrets: Record<string, unknown>, password: string): Promise<EncryptedSecrets> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  return {
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** Decrypt a secrets block; throws {@link WrongPasswordError} when the password is wrong. */
export async function decryptSecrets(block: EncryptedSecrets, password: string): Promise<Record<string, unknown>> {
  const key = await deriveKey(password, Buffer.from(block.salt, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(block.iv, 'base64'));
  let plain: string;
  try {
    decipher.setAuthTag(Buffer.from(block.tag, 'base64'));
    plain = Buffer.concat([decipher.update(Buffer.from(block.ciphertext, 'base64')), decipher.final()]).toString(
      'utf8'
    );
  } catch {
    throw new WrongPasswordError();
  }
  const parsed: unknown = JSON.parse(plain);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new WrongPasswordError();
  return parsed as Record<string, unknown>;
}
