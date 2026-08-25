/**
 * Whole-surface guards for the renderer -> engine bridge.
 *
 * `ipcBridge.ts` declares every call the renderer can make, through three
 * mechanisms with very different failure modes:
 *
 *   - `httpGet/httpPost/...('/api/...')` — routed to the engine over HTTP. A
 *     path with no matching engine route 404s at runtime and nothing catches it
 *     at build time, because the path is just a string.
 *   - `bridge.buildProvider('key')` — real IPC, answered in the main process.
 *   - `stubProvider(name, default)` — deliberately NOT implemented; returns a
 *     canned value. A stub behind a button makes that button silently do
 *     nothing while reporting success.
 *
 * These tests enumerate each surface rather than sampling it, so a new call
 * cannot be added without either wiring it up or updating the record here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const bridgePath = join(repoRoot, 'packages/desktop/src/common/adapter/ipcBridge.ts');
const engineCratesDir = join(repoRoot, 'the-remaa/AionCore/crates');

function readRustFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `target` holds build output; it can contain generated sources.
      if (entry.name === 'target' || entry.name === 'node_modules') continue;
      readRustFiles(full, out);
    } else if (entry.name.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

/** Every axum path the engine registers, e.g. `/api/system/info`. */
function engineRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of readRustFiles(engineCratesDir)) {
    const text = readFileSync(file, 'utf-8');
    for (const match of text.matchAll(/\.route\(\s*"([^"]+)"/g)) {
      // A same-named `.route(` on the WebSocket router takes a ConnectionId,
      // not a path; requiring a leading slash filters those out.
      if (match[1].startsWith('/')) routes.add(match[1]);
    }
  }
  return routes;
}

type BridgeCall = { method: string; path: string };

/** Every HTTP path `ipcBridge.ts` calls, literal or template. */
function bridgeHttpCalls(): BridgeCall[] {
  const text = readFileSync(bridgePath, 'utf-8');
  const calls: BridgeCall[] = [];
  for (const match of text.matchAll(/http(Get|Post|Put|Patch|Delete)</g)) {
    const window = text.slice(match.index ?? 0, (match.index ?? 0) + 400);
    const literal =
      window.match(/\(\s*'([^']+)'/) ??
      window.match(/\(\s*`([^`]+)`/) ??
      window.match(/=>\s*`([^`]+)`/) ??
      window.match(/=>\s*'([^']+)'/);
    if (literal) calls.push({ method: match[1].toUpperCase(), path: literal[1] });
  }
  return calls;
}

/**
 * Collapse the two ways a path segment can be dynamic — `${id}` on the client
 * and `{id}` on the engine — so the two sides compare structurally.
 */
function normalize(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/\{[^}]*\}/g, '*')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');
}

function matches(routePattern: string, callPath: string): boolean {
  const routeSegments = routePattern.split('/');
  const callSegments = callPath.split('/');
  if (routeSegments.length !== callSegments.length) return false;
  return routeSegments.every((segment, i) => segment === '*' || callSegments[i] === '*' || segment === callSegments[i]);
}

describe('bridge HTTP calls resolve to engine routes', () => {
  it('finds the vendored engine source', () => {
    expect(statSync(engineCratesDir).isDirectory()).toBe(true);
  });

  /**
   * Paths the engine does not serve. Every entry needs a reason, and a reason
   * that is only "not built yet" must say what gates it — an unreachable call
   * is tolerable, a reachable one is a 404 waiting to happen.
   */
  const KNOWN_MISSING_ROUTES: Record<string, string> = {
    '/api/google/subscription-status':
      'Google subscription checks have no engine route. Unreachable today because ' +
      'googleAuth.status is stubbed to success:false, so useGoogleAuthModels never ' +
      'enables the fetch. Implementing Google auth in the engine activates this path ' +
      'and it will 404 until the route exists.',
  };

  it('every ipcBridge HTTP path has a matching engine route', () => {
    const routes = [...engineRoutes()].map(normalize);
    const calls = bridgeHttpCalls();

    // Guard the extractors themselves: if a refactor breaks the regexes, the
    // comparison would pass vacuously.
    expect(routes.length).toBeGreaterThan(100);
    expect(calls.length).toBeGreaterThan(100);

    const unmatched = calls
      .map((call) => ({ ...call, normalized: normalize(call.path) }))
      .filter((call) => call.normalized.startsWith('/'))
      .filter((call) => !routes.some((route) => matches(route, call.normalized)))
      .filter((call) => !(call.path in KNOWN_MISSING_ROUTES))
      .map((call) => `${call.method} ${call.path}`);

    expect(unmatched).toEqual([]);
  });

  it('every recorded missing route is still missing', () => {
    // A gap that has since been implemented should be deleted from the record,
    // otherwise the allowlist quietly grows into a place bugs hide.
    const routes = [...engineRoutes()].map(normalize);
    const stillMissing = Object.keys(KNOWN_MISSING_ROUTES).filter(
      (path) => !routes.some((route) => matches(route, normalize(path)))
    );
    expect(stillMissing).toEqual(Object.keys(KNOWN_MISSING_ROUTES));
  });
});

describe('IPC channels are answered in the main process', () => {
  /**
   * `group.member` for every `bridge.buildProvider` declared inside an exported
   * object. A channel the renderer can invoke with nothing registered against it
   * never resolves — the caller hangs rather than failing, so it is invisible
   * until someone clicks the control.
   */
  function exportedIpcAccessors(): string[] {
    const lines = readFileSync(bridgePath, 'utf-8').split('\n');
    const accessors: string[] = [];
    let group: string | null = null;
    let depth = 0;
    for (const line of lines) {
      const opening = line.match(/^export const (\w+) = \{/);
      if (opening) {
        group = opening[1];
        depth = 1;
        continue;
      }
      if (!group) continue;
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      const member = line.match(/^\s{2}(\w+):\s*bridge\.buildProvider/);
      if (member) accessors.push(`${group}.${member[1]}`);
      if (depth <= 0) group = null;
    }
    return accessors;
  }

  function desktopSources(): string {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          files.push(full);
        }
      }
    };
    walk(join(repoRoot, 'packages/desktop/src'));
    return files.map((file) => readFileSync(file, 'utf-8')).join('\n');
  }

  it('every exported IPC channel has a registered provider', () => {
    const accessors = exportedIpcAccessors();
    // Fails loudly if the declaration style changes and the scan goes blind.
    expect(accessors.length).toBeGreaterThan(40);

    const sources = desktopSources();
    const unregistered = accessors.filter((accessor) => !sources.includes(`${accessor}.provider(`));
    expect(unregistered).toEqual([]);
  });

  it('accounts for every buildProvider declaration', () => {
    const text = readFileSync(bridgePath, 'utf-8');
    const declared = (text.match(/bridge\.buildProvider/g) ?? []).length;
    // `nativeShowOpen` is module-local and re-exported through a wrapper that
    // forwards `.provider`, so it has no `group.member` form of its own.
    // Covered by tests/unit/common-adapter/ipcBridgeShowOpen.test.ts.
    const moduleLocal = 1;
    expect(exportedIpcAccessors().length + moduleLocal).toBe(declared);
  });
});

describe('stubbed bridge calls', () => {
  /**
   * Calls answered by `stubProvider`: the backend has no implementation, so the
   * canned value is returned and the caller cannot tell. Anything listed here
   * that is wired to a control makes that control do nothing.
   *
   * Adding an entry is a decision, not a detail — a stub reached from the UI
   * needs either a real implementation or a disabled control.
   *
   * - `googleAuth.status` returns `success: false`, so `isGoogleAuth` is always
   *   false and the "Gemini Google Auth" provider never appears in the model
   *   list (`useModelProviderList.ts`). Unreachable rather than wrong.
   * - `task.getRunningCount` has no callers. The tray's count comes from
   *   `conversation.activeCount`, which is a real endpoint.
   *
   * `task.stopAll` used to be here — a stub reporting success from the tray's
   * "Pause All" while cancelling nothing. It is now a real call to
   * `POST /api/conversations/cancel-all`, enforced by the route check above.
   */
  const KNOWN_STUBS = ['googleAuth.status', 'task.getRunningCount'];

  it('only the recorded calls are stubbed', () => {
    const text = readFileSync(bridgePath, 'utf-8');
    // Scan past the type arguments rather than trying to match them: they nest
    // (`stubProvider<IBridgeResponse<{...}>, ...>`), so a `[^>]*` bound stops at
    // the inner `>` and silently misses that declaration.
    const found = [...text.matchAll(/stubProvider[\s\S]{0,200}?\(\s*'([^']+)'/g)].map((match) => match[1]).toSorted();
    expect(found).toEqual([...KNOWN_STUBS].toSorted());
  });
});
