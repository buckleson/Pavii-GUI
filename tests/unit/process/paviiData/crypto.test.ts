/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backup secrets encryption: scrypt + AES-256-GCM round trip, wrong password
 * and tamper detection, and fresh salt/IV per call.
 */

import { describe, expect, it } from 'vitest';
import { decryptSecrets, encryptSecrets, WrongPasswordError } from '@process/paviiData/crypto';

const SECRETS = { 'provider:p1': { api_key: 'sk-test-value' }, 'mcp:server': { transport: { env: { K: 'v' } } } };

/** Flip the first byte of a base64 field. */
const tamper = (base64: string): string => {
  const bytes = Buffer.from(base64, 'base64');
  bytes[0] ^= 0xff;
  return bytes.toString('base64');
};

describe('encryptSecrets / decryptSecrets', () => {
  it('decrypts to the original secrets with the same password', async () => {
    const block = await encryptSecrets(SECRETS, 'correct horse');

    await expect(decryptSecrets(block, 'correct horse')).resolves.toEqual(SECRETS);
  });

  it('never stores the plaintext in the encrypted block', async () => {
    const block = await encryptSecrets(SECRETS, 'pw');

    expect(block.kdf).toBe('scrypt');
    expect(JSON.stringify(block)).not.toContain('sk-test-value');
  });

  it('rejects a wrong password with WrongPasswordError', async () => {
    const block = await encryptSecrets(SECRETS, 'right');

    await expect(decryptSecrets(block, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('rejects a tampered ciphertext', async () => {
    const block = await encryptSecrets(SECRETS, 'pw');

    await expect(decryptSecrets({ ...block, ciphertext: tamper(block.ciphertext) }, 'pw')).rejects.toBeInstanceOf(
      WrongPasswordError
    );
  });

  it('rejects a tampered auth tag', async () => {
    const block = await encryptSecrets(SECRETS, 'pw');

    await expect(decryptSecrets({ ...block, tag: tamper(block.tag) }, 'pw')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('rejects a truncated auth tag instead of accepting it', async () => {
    const block = await encryptSecrets(SECRETS, 'pw');

    await expect(decryptSecrets({ ...block, tag: '' }, 'pw')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('uses a different salt and IV for every call', async () => {
    const first = await encryptSecrets(SECRETS, 'pw');
    const second = await encryptSecrets(SECRETS, 'pw');

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects a block whose decrypted payload is not an object', async () => {
    // An array encrypts fine but is not a valid secrets map.
    const block = await encryptSecrets([1, 2] as unknown as Record<string, unknown>, 'pw');

    await expect(decryptSecrets(block, 'pw')).rejects.toBeInstanceOf(WrongPasswordError);
  });
});
