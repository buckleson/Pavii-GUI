/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer } from 'node:http';

export type AuthCallbackHandle = {
  port: number;
  close: () => void;
};

export type AuthCallbackOptions = {
  /** Bring the app window to the front ("Open Pavii" on the success page). */
  onFocus?: () => void;
  /** How long to wait for the token before giving up. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** How long /focus stays available after a successful sign-in. */
const POST_AUTH_GRACE_MS = 10 * 60 * 1000;

const SUCCESS_HTML =
  '<!doctype html><meta charset="utf-8"><title>Pavii.Ai</title>' +
  '<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
  '<p>Signed in. You can close this tab and return to Pavii.Ai.</p></body>';

/**
 * Loopback HTTP listener for the pavii.tech sign-in hand-off.
 *
 * Browsers can silently refuse to launch the pavii:// custom scheme (stale
 * protocol-handler caches), so the sign-in flow prefers a loopback redirect:
 * the app listens on an ephemeral 127.0.0.1 port and the login page delivers
 * the Firebase ID token to `/auth?id_token=...` with a same-machine request.
 *
 * Token delivery is single-use: after the first delivery the `/auth` route is
 * spent. On success the server lingers for a grace window so the success
 * page's "Open Pavii" button can raise the app via `GET /focus` (204); failed
 * deliveries close the server immediately. Binds 127.0.0.1 only.
 *
 * @param onToken Receives the raw ID token; returns whether sign-in succeeded.
 */
export function startAuthCallbackServer(
  onToken: (idToken: string) => Promise<boolean>,
  options: AuthCallbackOptions = {}
): Promise<AuthCallbackHandle> {
  const { onFocus, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    let closed = false;
    let authSpent = false;
    let timer: NodeJS.Timeout;

    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      server.close();
    };

    const armTimer = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(close, ms);
      // Do not keep the process alive just for a pending sign-in window.
      timer.unref?.();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/focus') {
        onFocus?.();
        res.writeHead(204).end();
        return;
      }

      const idToken = url.searchParams.get('id_token');
      if (url.pathname !== '/auth' || !idToken || authSpent) {
        res.writeHead(404).end();
        return;
      }
      authSpent = true;
      void onToken(idToken)
        .then((ok) => {
          if (ok) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_HTML);
            armTimer(POST_AUTH_GRACE_MS);
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Sign-in could not be verified.');
            close();
          }
        })
        .catch(() => {
          res.writeHead(500).end();
          close();
        });
    });

    server.on('error', (error) => {
      close();
      reject(error);
    });

    armTimer(timeoutMs);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        close();
        reject(new Error('Auth callback server has no port'));
        return;
      }
      resolve({ port: address.port, close });
    });
  });
}
