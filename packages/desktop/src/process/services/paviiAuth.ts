/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pavii account authentication (Firebase).
 *
 * The sign-in UI lives at https://www.pavii.tech/login (Firebase JS SDK). After
 * sign-in the page redirects to `pavii://auth#id_token=<firebase-id-token>`;
 * the deep-link handler passes the token here. We verify the RS256 signature
 * against Google's public securetoken certificates and the Firebase project's
 * issuer/audience, then persist a lightweight local session.
 */

import { verify, decode, type JwtHeader } from 'jsonwebtoken';
import { readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Firebase project id — must match the web config used by pavii.tech/login.
 * Overridable via env for development.
 */
export const PAVII_FIREBASE_PROJECT_ID = process.env.PAVII_FIREBASE_PROJECT_ID || 'pavii-ai3';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CERT_CACHE_TTL_MS = 60 * 60 * 1000;

export type PaviiAccountSession = {
  uid: string;
  email?: string;
  name?: string;
  signedInAt: number;
};

let certCache: { certs: Record<string, string>; fetchedAt: number } | null = null;

async function getGoogleCerts(fetchImpl: typeof fetch = fetch): Promise<Record<string, string>> {
  if (certCache && Date.now() - certCache.fetchedAt < CERT_CACHE_TTL_MS) return certCache.certs;
  const response = await fetchImpl(GOOGLE_CERTS_URL);
  if (!response.ok) throw new Error(`Failed to fetch Google signing certs (${response.status})`);
  const certs = (await response.json()) as Record<string, string>;
  certCache = { certs, fetchedAt: Date.now() };
  return certs;
}

/** Reset the cert cache (tests). */
export function __resetCertCacheForTests(): void {
  certCache = null;
}

/**
 * Verify a Firebase ID token and return the session it represents.
 * Throws on any validation failure (bad signature, wrong project, expired).
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string = PAVII_FIREBASE_PROJECT_ID,
  fetchImpl: typeof fetch = fetch
): Promise<PaviiAccountSession> {
  if (!projectId || projectId === 'REPLACE_ME') {
    throw new Error('Pavii Firebase project id is not configured (PAVII_FIREBASE_PROJECT_ID)');
  }

  const decoded = decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') throw new Error('Malformed ID token');
  const header = decoded.header as JwtHeader;
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unexpected token algorithm');

  const certs = await getGoogleCerts(fetchImpl);
  const cert = certs[header.kid];
  if (!cert) throw new Error('Unknown token signing key');

  const payload = verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  }) as Record<string, unknown>;

  const uid = typeof payload.user_id === 'string' ? payload.user_id : String(payload.sub ?? '');
  if (!uid) throw new Error('Token has no user id');

  return {
    uid,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    signedInAt: Date.now(),
  };
}

/** Build the pavii.tech sign-in URL that redirects back into the app. */
export function buildSignInUrl(redirectUri = 'pavii://auth', mode?: 'signin' | 'signup'): string {
  const base = `https://www.pavii.tech/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
  return mode === 'signup' ? `${base}&mode=signup` : base;
}

// ---------------------------------------------------------------------------
// Local session persistence (config dir, token-free)
// ---------------------------------------------------------------------------

const SESSION_FILE_NAME = 'pavii-account.json';

function sessionFilePath(configDir: string): string {
  return join(configDir, SESSION_FILE_NAME);
}

/** Persist a verified session next to the app config. */
export async function storeSession(configDir: string, session: PaviiAccountSession): Promise<void> {
  await writeFile(sessionFilePath(configDir), JSON.stringify(session, null, 2), 'utf-8');
}

/** Read the persisted session; null when absent or unreadable. */
export async function readStoredSession(configDir: string): Promise<PaviiAccountSession | null> {
  try {
    const raw = JSON.parse(await readFile(sessionFilePath(configDir), 'utf-8')) as Partial<PaviiAccountSession>;
    if (typeof raw.uid !== 'string' || raw.uid.length === 0) return null;
    return {
      uid: raw.uid,
      email: typeof raw.email === 'string' ? raw.email : undefined,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      signedInAt: typeof raw.signedInAt === 'number' ? raw.signedInAt : 0,
    };
  } catch {
    return null;
  }
}

/** Remove the persisted session (sign out). Missing file is not an error. */
export async function clearStoredSession(configDir: string): Promise<void> {
  try {
    await rm(sessionFilePath(configDir));
  } catch {
    // already gone
  }
}
