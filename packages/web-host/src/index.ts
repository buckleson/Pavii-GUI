import type { WebHostOptions, WebHostHandle } from './types.js';

export type { AppMetadata, BackendBinaryResolver, WebHostOptions, WebHostHandle } from './types.js';
export { getLanIPCandidates, startStaticServer, stopStaticServer } from './static-server.js';
export type { StaticServerOptions, StaticServerHandle } from './static-server.js';

// Backend launcher exports (M4)
export {
  BackendStartupCancelledError,
  BackendLifecycleManager,
  buildSpawnArgs,
  buildSpawnEnv,
  findAvailablePort,
  startBackend,
  stopBackend,
} from './backend-launcher.js';
export type { BackendDirConfig, BackendLaunchOptions, BackendHandle, BackendStartOptions } from './backend-launcher.js';

// OpenCode CLI availability — PATH registration shared by both distributions.
export {
  ensureOpencodeInstalled,
  findBundledNpm,
  getBundledOpencodeDir,
  getManagedToolsDir,
  getManagedToolsPathEntries,
  registerManagedToolsOnPath,
  registerOpencodeOnPath,
} from './ensure-opencode.js';

/**
 * Start WebHost (main entry point).
 *
 * Orchestrates backend-launcher + static-server. web-host itself holds no
 * persistent configuration — callers (Electron main process, `bun run webui`
 * CLI) are responsible for resolving port / allowRemote from their own source
 * of truth (Electron ProcessConfig, CLI flags, env vars).
 */
export async function startWebHost(opts: WebHostOptions): Promise<WebHostHandle> {
  const { startBackend } = await import('./backend-launcher.js');
  const { startStaticServer } = await import('./static-server.js');
  const { registerOpencodeOnPath } = await import('./ensure-opencode.js');

  // OpenCode is the default agent, and the engine resolves agents only through
  // the PATH it inherits at spawn — so this must happen before startBackend,
  // not after. Registering later leaves the whole first session without a
  // usable default.
  //
  // `process.env` is mutated deliberately rather than a constructed env object:
  // `buildSpawnEnv` passes `process.env` straight through by reference when no
  // `dirs` are supplied, so mutating a copy would miss that path entirely.
  // Registration is idempotent, so the desktop app doing this itself before
  // reaching here costs nothing.
  registerOpencodeOnPath({
    dataDir: opts.dataDir ?? opts.app.userDataPath,
    resourcesPath: opts.app.resourcesPath,
  });

  // 1. Start backend (M4)
  let backendHandle;
  if (opts.backend.kind === 'ownBackend') {
    backendHandle = await startBackend({
      app: opts.app,
      resolveBackend: opts.backend.resolveBackend,
      dataDir: opts.dataDir,
      logDir: opts.logDir,
      dirs: opts.dirs,
    });
  } else {
    // useExistingBackend: create a fake handle
    backendHandle = {
      port: opts.backend.port,
      stop: async () => {
        // no-op: external backend
      },
    };
  }

  let staticHandle;
  try {
    // 2. Start static-server (M5)
    staticHandle = await startStaticServer({
      staticDir: opts.staticDir,
      backendPort: backendHandle.port,
      port: opts.port,
      allowRemote: opts.allowRemote ?? false,
    });
  } catch (err) {
    // If static-server fails, clean up backend
    await backendHandle.stop();
    throw err;
  }

  // 3. Return combined handle
  return {
    port: staticHandle.port,
    backendPort: backendHandle.port,
    url: staticHandle.url,
    localUrl: staticHandle.localUrl,
    networkUrl: staticHandle.networkUrl,
    lanIP: staticHandle.lanIP,
    async stop() {
      await staticHandle.stop();
      await backendHandle.stop();
    },
  };
}
