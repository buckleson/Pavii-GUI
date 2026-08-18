/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign } from 'jsonwebtoken';
import {
  buildSignInUrl,
  verifyFirebaseIdToken,
  storeSession,
  readStoredSession,
  clearStoredSession,
  __resetCertCacheForTests,
  type PaviiAccountSession,
} from '@/process/services/paviiAuth';

const PROJECT_ID = 'test-project';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KID = 'kid1';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

type SignOverrides = {
  keyid?: string;
  audience?: string;
  issuer?: string;
  expiresIn?: number;
  claims?: Record<string, unknown>;
};

const makeToken = (overrides: SignOverrides = {}): string => {
  const { keyid = KID, audience = PROJECT_ID, issuer = ISSUER, expiresIn = 3600, claims } = overrides;
  return sign(
    {
      user_id: 'uid-1',
      email: 'a@b.c',
      name: 'Tester',
      ...claims,
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid,
      audience,
      issuer,
      subject: 'uid-1',
      expiresIn,
    }
  );
};

const makeFetch = (certs: Record<string, string> = { [KID]: publicKey }, ok = true, status = 200) =>
  vi.fn(async () => ({
    ok,
    status,
    json: async () => certs,
  })) as unknown as typeof fetch;

describe('buildSignInUrl', () => {
  it('encodes the default pavii://auth redirect into the login URL', () => {
    expect(buildSignInUrl()).toBe('https://www.pavii.tech/login?redirect_uri=pavii%3A%2F%2Fauth');
  });

  it('honors a custom redirect uri and URL-encodes it', () => {
    const url = buildSignInUrl('myapp://callback?x=1&y=2');
    expect(url).toBe(`https://www.pavii.tech/login?redirect_uri=${encodeURIComponent('myapp://callback?x=1&y=2')}`);
    expect(url).not.toContain('myapp://');
  });

  it('appends mode=signup only when requested', () => {
    expect(buildSignInUrl('pavii://auth', 'signup')).toBe(
      'https://www.pavii.tech/login?redirect_uri=pavii%3A%2F%2Fauth&mode=signup'
    );
    expect(buildSignInUrl('pavii://auth', 'signin')).not.toContain('mode=');
    expect(buildSignInUrl()).not.toContain('mode=');
  });
});

describe('verifyFirebaseIdToken', () => {
  beforeEach(() => {
    __resetCertCacheForTests();
  });

  it('verifies a valid token and returns the session', () => {
    const before = Date.now();
    return verifyFirebaseIdToken(makeToken(), PROJECT_ID, makeFetch()).then((session) => {
      expect(session.uid).toBe('uid-1');
      expect(session.email).toBe('a@b.c');
      expect(session.name).toBe('Tester');
      expect(typeof session.signedInAt).toBe('number');
      expect(session.signedInAt).toBeGreaterThanOrEqual(before);
    });
  });

  it('omits email/name when the token lacks them', async () => {
    const token = sign({ user_id: 'uid-2' }, privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      audience: PROJECT_ID,
      issuer: ISSUER,
      subject: 'uid-2',
      expiresIn: 3600,
    });
    const session = await verifyFirebaseIdToken(token, PROJECT_ID, makeFetch());
    expect(session.uid).toBe('uid-2');
    expect(session.email).toBeUndefined();
    expect(session.name).toBeUndefined();
  });

  it('rejects when the project id is not configured', async () => {
    await expect(verifyFirebaseIdToken(makeToken(), 'REPLACE_ME', makeFetch())).rejects.toThrow(/not configured/);
  });

  it('rejects an empty project id', async () => {
    await expect(verifyFirebaseIdToken(makeToken(), '', makeFetch())).rejects.toThrow(/not configured/);
  });

  it('rejects a malformed token string without fetching certs', async () => {
    const fetchImpl = makeFetch();
    await expect(verifyFirebaseIdToken('not-a-jwt', PROJECT_ID, fetchImpl)).rejects.toThrow('Malformed ID token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-RS256 token', async () => {
    const hsToken = sign({ user_id: 'uid-1' }, 'shared-secret', {
      algorithm: 'HS256',
      keyid: KID,
      audience: PROJECT_ID,
      issuer: ISSUER,
      expiresIn: 3600,
    });
    await expect(verifyFirebaseIdToken(hsToken, PROJECT_ID, makeFetch())).rejects.toThrow('Unexpected token algorithm');
  });

  it('rejects a token signed with an unknown kid', async () => {
    await expect(verifyFirebaseIdToken(makeToken({ keyid: 'kid-unknown' }), PROJECT_ID, makeFetch())).rejects.toThrow(
      'Unknown token signing key'
    );
  });

  it('rejects a token with the wrong audience', async () => {
    await expect(
      verifyFirebaseIdToken(makeToken({ audience: 'other-project' }), PROJECT_ID, makeFetch())
    ).rejects.toThrow(/audience/i);
  });

  it('rejects a token with the wrong issuer', async () => {
    await expect(
      verifyFirebaseIdToken(
        makeToken({ issuer: 'https://securetoken.google.com/other-project' }),
        PROJECT_ID,
        makeFetch()
      )
    ).rejects.toThrow(/issuer/i);
  });

  it('rejects an expired token', async () => {
    await expect(verifyFirebaseIdToken(makeToken({ expiresIn: -10 }), PROJECT_ID, makeFetch())).rejects.toThrow(
      /expired/i
    );
  });

  it('rejects when the cert fetch fails', async () => {
    const fetchImpl = makeFetch({}, false, 503);
    await expect(verifyFirebaseIdToken(makeToken(), PROJECT_ID, fetchImpl)).rejects.toThrow(
      /Failed to fetch Google signing certs \(503\)/
    );
  });

  it('caches certs across verifications within the TTL', async () => {
    const fetchImpl = makeFetch();
    await verifyFirebaseIdToken(makeToken(), PROJECT_ID, fetchImpl);
    await verifyFirebaseIdToken(makeToken(), PROJECT_ID, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('session store (pavii-account.json)', () => {
  let configDir: string;

  const sessionFile = () => join(configDir, 'pavii-account.json');

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'pavii-auth-test-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('round-trips a full session through store and read', async () => {
    const session: PaviiAccountSession = {
      uid: 'uid-1',
      email: 'a@b.c',
      name: 'Tester',
      signedInAt: 1234567890,
    };
    await storeSession(configDir, session);
    await expect(readStoredSession(configDir)).resolves.toEqual(session);
  });

  it('returns null when no session file exists', async () => {
    await expect(readStoredSession(configDir)).resolves.toBeNull();
  });

  it('returns null when the session file contains malformed JSON', async () => {
    writeFileSync(sessionFile(), '{not json!!', 'utf-8');
    await expect(readStoredSession(configDir)).resolves.toBeNull();
  });

  it('returns null when uid is missing', async () => {
    writeFileSync(sessionFile(), JSON.stringify({ email: 'a@b.c', signedInAt: 1 }), 'utf-8');
    await expect(readStoredSession(configDir)).resolves.toBeNull();
  });

  it('returns null when uid is an empty string', async () => {
    writeFileSync(sessionFile(), JSON.stringify({ uid: '', signedInAt: 1 }), 'utf-8');
    await expect(readStoredSession(configDir)).resolves.toBeNull();
  });

  it('normalizes missing optional fields and non-number signedInAt', async () => {
    writeFileSync(sessionFile(), JSON.stringify({ uid: 'uid-2', signedInAt: 'yesterday' }), 'utf-8');
    const session = await readStoredSession(configDir);
    expect(session).toEqual({
      uid: 'uid-2',
      email: undefined,
      name: undefined,
      signedInAt: 0,
    });
  });

  it('clearStoredSession removes the file so a subsequent read returns null', async () => {
    await storeSession(configDir, { uid: 'uid-3', signedInAt: 1 });
    expect(existsSync(sessionFile())).toBe(true);
    await clearStoredSession(configDir);
    expect(existsSync(sessionFile())).toBe(false);
    await expect(readStoredSession(configDir)).resolves.toBeNull();
  });

  it('clearStoredSession does not throw when the file is already absent', async () => {
    await expect(clearStoredSession(configDir)).resolves.toBeUndefined();
  });
});
