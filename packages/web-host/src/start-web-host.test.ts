/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * startWebHost ordering.
 *
 * NOTE ON LOCATION: vitest only includes test files under `packages/web-host/src`,
 * so `packages/web-host/tests/` is never executed by `bun run test`. These tests
 * live in `src/` deliberately — placed next door in `tests/` they would pass by
 * never running.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * OpenCode is the default agent, and the engine resolves agents only through the
 * PATH it inherits when it is spawned. Registering after `startBackend` leaves
 * the entire first session without a usable default — the exact bug the desktop
 * bundle was built to fix. This pins the ordering so the web distribution cannot
 * regress into it.
 */
describe('startWebHost registers OpenCode before spawning the engine', () => {
  const originalPath = process.env.PATH;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    vi.doUnmock('./backend-launcher.js');
    vi.doUnmock('./static-server.js');
    vi.doUnmock('./ensure-opencode.js');
  });

  test('PATH is already registered by the time startBackend runs', async () => {
    const callOrder: string[] = [];

    vi.doMock('./ensure-opencode.js', () => ({
      registerOpencodeOnPath: vi.fn((opts: { dataDir: string; resourcesPath?: string }) => {
        callOrder.push(`register:${opts.resourcesPath}:${opts.dataDir}`);
      }),
    }));
    vi.doMock('./backend-launcher.js', () => ({
      startBackend: vi.fn().mockImplementation(async () => {
        callOrder.push('startBackend');
        return { port: 55555, stop: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    vi.doMock('./static-server.js', () => ({
      startStaticServer: vi.fn().mockResolvedValue({
        port: 33000,
        url: 'http://127.0.0.1:33000',
        localUrl: 'http://127.0.0.1:33000',
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    const { startWebHost } = await import('./index.js');
    const handle = await startWebHost({
      app: { version: '1.0.0', isPackaged: true, resourcesPath: '/cli-root', userDataPath: '/home/.pavii-web' },
      staticDir: '/tmp/static',
      backend: { kind: 'ownBackend', resolveBackend: () => '/bin/backend' },
    });

    expect(callOrder).toEqual(['register:/cli-root:/home/.pavii-web', 'startBackend']);
    await handle.stop();
  });

  test('prefers an explicit dataDir over the app userDataPath', async () => {
    const seen: Array<{ dataDir: string }> = [];
    vi.doMock('./ensure-opencode.js', () => ({
      registerOpencodeOnPath: vi.fn((opts: { dataDir: string }) => seen.push({ dataDir: opts.dataDir })),
    }));
    vi.doMock('./backend-launcher.js', () => ({
      startBackend: vi.fn().mockResolvedValue({ port: 1, stop: vi.fn().mockResolvedValue(undefined) }),
    }));
    vi.doMock('./static-server.js', () => ({
      startStaticServer: vi.fn().mockResolvedValue({
        port: 2,
        url: 'u',
        localUrl: 'u',
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    const { startWebHost } = await import('./index.js');
    const handle = await startWebHost({
      app: { version: '1.0.0', isPackaged: true, resourcesPath: '/cli-root', userDataPath: '/fallback' },
      dataDir: '/explicit',
      staticDir: '/tmp/static',
      backend: { kind: 'ownBackend', resolveBackend: () => '/bin/backend' },
    });

    expect(seen).toEqual([{ dataDir: '/explicit' }]);
    await handle.stop();
  });
});
