/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  startAuthCallbackServer,
  type AuthCallbackHandle,
  type AuthCallbackOptions,
} from '@/process/services/paviiAuthCallbackServer';

/**
 * Real-HTTP tests: each test starts the server on an ephemeral 127.0.0.1 port
 * and talks to it via fetch. `Connection: close` avoids undici keep-alive
 * pooling so "server closed" checks cannot be satisfied by a reused socket.
 */

const handles: AuthCallbackHandle[] = [];

const start = async (onToken: (idToken: string) => Promise<boolean>, options?: AuthCallbackOptions) => {
  const handle = await startAuthCallbackServer(onToken, options);
  handles.push(handle);
  return handle;
};

const request = (port: number, pathAndQuery: string) =>
  fetch(`http://127.0.0.1:${port}${pathAndQuery}`, { headers: { connection: 'close' } });

/** Asserts the port stops accepting connections, tolerating the small window between response and close. */
const expectServerClosed = async (port: number) => {
  await vi.waitFor(
    async () => {
      await expect(request(port, '/auth?id_token=late')).rejects.toThrow();
    },
    { timeout: 2000, interval: 25 }
  );
};

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

describe('startAuthCallbackServer', () => {
  it('delivers the exact token to onToken and responds 200 with an HTML success page', async () => {
    const onToken = vi.fn().mockResolvedValue(true);
    const { port } = await start(onToken);

    const res = await request(port, '/auth?id_token=tok-123');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(onToken).toHaveBeenCalledExactlyOnceWith('tok-123');
  });

  it('stays open after a successful delivery but spends /auth (second delivery is 404)', async () => {
    const onToken = vi.fn().mockResolvedValue(true);
    const onFocus = vi.fn();
    const { port } = await start(onToken, { onFocus });

    const first = await request(port, '/auth?id_token=tok-123');
    expect(first.status).toBe(200);

    const second = await request(port, '/auth?id_token=tok-456');
    expect(second.status).toBe(404);
    expect(onToken).toHaveBeenCalledExactlyOnceWith('tok-123');

    const focus = await request(port, '/focus');
    expect(focus.status).toBe(204);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('responds 204 to /focus before any token delivery and stays open', async () => {
    const onToken = vi.fn().mockResolvedValue(true);
    const onFocus = vi.fn();
    const { port } = await start(onToken, { onFocus });

    const focus = await request(port, '/focus');
    expect(focus.status).toBe(204);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onToken).not.toHaveBeenCalled();

    const auth = await request(port, '/auth?id_token=tok-after-focus');
    expect(auth.status).toBe(200);
    expect(onToken).toHaveBeenCalledExactlyOnceWith('tok-after-focus');
  });

  it('responds 204 to /focus when no onFocus is provided', async () => {
    const { port } = await start(vi.fn().mockResolvedValue(true));

    const focus = await request(port, '/focus');

    expect(focus.status).toBe(204);
  });

  it('does not invoke onFocus for /auth requests', async () => {
    const onFocus = vi.fn();
    const { port } = await start(vi.fn().mockResolvedValue(true), { onFocus });

    const res = await request(port, '/auth?id_token=tok-123');

    expect(res.status).toBe(200);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('responds 400 when onToken resolves false', async () => {
    const { port } = await start(vi.fn().mockResolvedValue(false));

    const res = await request(port, '/auth?id_token=bad-token');

    expect(res.status).toBe(400);
  });

  it('closes the server after a rejected token (still single-use)', async () => {
    const { port } = await start(vi.fn().mockResolvedValue(false));

    await request(port, '/auth?id_token=bad-token');

    await expectServerClosed(port);
  });

  it('responds 500 when onToken throws', async () => {
    const { port } = await start(vi.fn().mockRejectedValue(new Error('verify blew up')));

    const res = await request(port, '/auth?id_token=tok-123');

    expect(res.status).toBe(500);
  });

  it('closes the server after onToken throws', async () => {
    const { port } = await start(vi.fn().mockRejectedValue(new Error('verify blew up')));

    await request(port, '/auth?id_token=tok-123');

    await expectServerClosed(port);
  });

  it('responds 404 to an unknown path without consuming the server', async () => {
    const onToken = vi.fn().mockResolvedValue(true);
    const { port } = await start(onToken);

    const miss = await request(port, '/other?id_token=x');
    expect(miss.status).toBe(404);
    expect(onToken).not.toHaveBeenCalled();

    const hit = await request(port, '/auth?id_token=tok-after-404');
    expect(hit.status).toBe(200);
    expect(onToken).toHaveBeenCalledExactlyOnceWith('tok-after-404');
  });

  it('responds 404 when /auth is missing id_token and stays open', async () => {
    const onToken = vi.fn().mockResolvedValue(true);
    const { port } = await start(onToken);

    const miss = await request(port, '/auth');
    expect(miss.status).toBe(404);
    expect(onToken).not.toHaveBeenCalled();

    const hit = await request(port, '/auth?id_token=tok-1');
    expect(hit.status).toBe(200);
  });

  it('close() is idempotent', async () => {
    const handle = await start(vi.fn().mockResolvedValue(true));

    handle.close();
    expect(() => handle.close()).not.toThrow();

    await expectServerClosed(handle.port);
  });

  it('closes itself after options.timeoutMs with no token delivery', async () => {
    const onToken = vi.fn().mockResolvedValue(true);
    const { port } = await start(onToken, { timeoutMs: 50 });

    await new Promise((resolve) => setTimeout(resolve, 150));

    await expect(request(port, '/auth?id_token=too-late')).rejects.toThrow();
    expect(onToken).not.toHaveBeenCalled();
  });

  it('round-trips a URL-encoded token exactly', async () => {
    const onToken = vi.fn().mockResolvedValue(true);
    const { port } = await start(onToken);
    const rawToken = 'eyJ0+a/b=c&d ε';

    const res = await request(port, `/auth?id_token=${encodeURIComponent(rawToken)}`);

    expect(res.status).toBe(200);
    expect(onToken).toHaveBeenCalledExactlyOnceWith(rawToken);
  });
});
