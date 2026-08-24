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

/**
 * Rescued from `packages/web-host/tests/start-web-host.test.ts`, which vitest
 * never executed — it had been passing by not running.
 */
describe('startWebHost handle shape', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // startWebHost now registers OpenCode on PATH for real unless stubbed, and
    // that mutates process.env for every later test in the run.
    vi.doMock('./ensure-opencode.js', () => ({ registerOpencodeOnPath: vi.fn() }));
  });

  afterEach(() => {
    vi.doUnmock('./ensure-opencode.js');
    vi.doUnmock('./backend-launcher.js');
    vi.doUnmock('./static-server.js');
  });

  test('Returns handle without initialPassword', async () => {
    // Mock backend-launcher
    vi.doMock('./backend-launcher.js', () => ({
      startBackend: vi.fn().mockResolvedValue({
        port: 55555,
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    // Mock static-server
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
      app: {
        version: '1.0.0',
        isPackaged: false,
        resourcesPath: '/app',
        userDataPath: '/tmp/test-data',
      },
      staticDir: '/tmp/static',
      backend: {
        kind: 'ownBackend',
        resolveBackend: () => '/bin/backend',
      },
    });

    // No initialPassword field on the handle — admin credentials flow through
    // backend's /api/webui/reset-password, not through startWebHost.
    expect('initialPassword' in handle).toBe(false);
    expect(handle.port).toBe(33000);
    expect(handle.backendPort).toBe(55555);

    await handle.stop();

    vi.doUnmock('./backend-launcher.js');
    vi.doUnmock('./static-server.js');
  });

  test.todo('Backend port conflict: throws and does not leak resources');
  test.todo('Stop cleanup: stops static-server then backend in sequence');
});

/**
 * The paths that only run when something is unusual: an externally managed
 * backend, or a failure partway through startup. These are exactly the paths a
 * developer never exercises by hand, so nothing but a test pins them.
 */
describe('startWebHost non-default and failure paths', () => {
  const staticHandle = () => ({
    port: 33000,
    url: 'http://127.0.0.1:33000',
    localUrl: 'http://127.0.0.1:33000',
    stop: vi.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('./ensure-opencode.js');
    vi.doUnmock('./backend-launcher.js');
    vi.doUnmock('./static-server.js');
  });

  test('registers OpenCode on PATH even when attaching to an existing backend', async () => {
    // `useExistingBackend` is how `bun run webui` attaches to a backend started
    // separately. Registration is unconditional today, which is harmless and
    // idempotent — but note it cannot help that backend, which snapshotted PATH
    // when it was spawned elsewhere. Pinned so the ordering fix is not quietly
    // moved inside the `ownBackend` branch, where the CLI path would lose it.
    const registerOpencodeOnPath = vi.fn();
    const startBackend = vi.fn();
    vi.doMock('./ensure-opencode.js', () => ({ registerOpencodeOnPath }));
    vi.doMock('./backend-launcher.js', () => ({ startBackend }));
    vi.doMock('./static-server.js', () => ({ startStaticServer: vi.fn().mockResolvedValue(staticHandle()) }));

    const { startWebHost } = await import('./index.js');
    const handle = await startWebHost({
      app: { version: '1.0.0', isPackaged: false, resourcesPath: '/app', userDataPath: '/home/.pavii-web' },
      staticDir: '/tmp/static',
      backend: { kind: 'useExistingBackend', port: 4096 },
    });

    expect(registerOpencodeOnPath).toHaveBeenCalledTimes(1);
    expect(startBackend).not.toHaveBeenCalled();
    expect(handle.backendPort).toBe(4096);
    await handle.stop();
  });

  test('fails loudly when PATH registration throws, without spawning a backend behind it', async () => {
    // Registration touches the filesystem (managed-tools dir, bundled binary
    // probe), so an unwritable or missing data dir can throw. Swallowing that
    // would start the host with no default agent and no signal — every session
    // silently agentless. Failing here also guarantees no orphaned engine
    // process is left behind, since the spawn never happens.
    const startBackend = vi.fn();
    vi.doMock('./ensure-opencode.js', () => ({
      registerOpencodeOnPath: vi.fn(() => {
        throw new Error('managed tools dir is not writable');
      }),
    }));
    vi.doMock('./backend-launcher.js', () => ({ startBackend }));
    vi.doMock('./static-server.js', () => ({ startStaticServer: vi.fn().mockResolvedValue(staticHandle()) }));

    const { startWebHost } = await import('./index.js');
    const start = startWebHost({
      app: { version: '1.0.0', isPackaged: false, resourcesPath: '/app', userDataPath: '/home/.pavii-web' },
      staticDir: '/tmp/static',
      backend: { kind: 'ownBackend', resolveBackend: () => '/bin/backend' },
    });

    await expect(start).rejects.toThrow('managed tools dir is not writable');
    expect(startBackend).not.toHaveBeenCalled();
  });

  test('stops the backend when the static server fails to start', async () => {
    // The backend is already spawned by this point. Rethrowing without stopping
    // it would leave an orphaned engine holding its port and the data dir lock,
    // so the retry the user immediately attempts fails too.
    const stop = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./ensure-opencode.js', () => ({ registerOpencodeOnPath: vi.fn() }));
    vi.doMock('./backend-launcher.js', () => ({
      startBackend: vi.fn().mockResolvedValue({ port: 55555, stop }),
    }));
    vi.doMock('./static-server.js', () => ({
      startStaticServer: vi.fn().mockRejectedValue(new Error('listen EADDRINUSE 33000')),
    }));

    const { startWebHost } = await import('./index.js');
    const start = startWebHost({
      app: { version: '1.0.0', isPackaged: false, resourcesPath: '/app', userDataPath: '/home/.pavii-web' },
      staticDir: '/tmp/static',
      backend: { kind: 'ownBackend', resolveBackend: () => '/bin/backend' },
    });

    await expect(start).rejects.toThrow('listen EADDRINUSE 33000');
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
