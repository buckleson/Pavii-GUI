/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolve the CDP address the in-app browser MCP should connect to.
 *
 * A separate file for testability: browserServer.ts is a launch script with top-level
 * side effects (it spawns a child), so unit tests cannot import it directly.
 *
 * Resolves which CDP endpoint the in-app browser MCP should connect to. Kept in
 * its own module for testability: browserServer.ts is an entry script with
 * top-level side effects (it spawns a child), so it cannot be imported by tests.
 */

const DEFAULT_CDP_HOST = '127.0.0.1';

export type ResolveBrowserUrlDeps = {
  env: NodeJS.ProcessEnv;
};

const toBrowserUrl = (port: number): string | null => {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return `http://${DEFAULT_CDP_HOST}:${port}`;
};

/**
 * Only the port inherited through our own process tree is accepted.
 *
 * The Electron main process writes it into AIONUI_CDP_ACTIVE_PORT and it reaches here through
 * the engine's inheritance - so "missing" means either the user disabled CDP or we were not
 * launched from the app. Both must refuse to start rather than guess a port - a wrong guess connects the agent to another instance's browser.
 *
 * Only trust the port inherited down this process tree. The Electron main process
 * writes it into AIONUI_CDP_ACTIVE_PORT and aioncore passes it down, so failing to
 * read it means one of two things: the user disabled CDP, or this was not launched by
 * the app. Both must refuse to start rather than guess a port — guessing wrong
 * connects the agent to a *different* instance's browser.
 */
export const resolveBrowserUrl = (deps: ResolveBrowserUrlDeps): string | null => {
  const { env } = deps;

  const rawPort = env.AIONUI_CDP_ACTIVE_PORT?.trim();
  if (rawPort) {
    const fromEnv = toBrowserUrl(Number(rawPort));
    if (fromEnv) return fromEnv;
  }

  return null;
};

/**
 * Access token for the single-target CDP channel.
 *
 * The main process generates it randomly and writes it into env, whence it inherits down to
 * here. Its job is to **block blind connections**: anything that never read the discovery leg and carries no token gets 403ed.
 *
 * It is **not identity proof** - the HTTP discovery leg is unauthenticated and its response
 * carries the token, so any same-user process can fetch it with one GET (see cdpBridge.ts's threat model).
 * Requiring it in env really means "the channel actually started": its absence means the bridge
 * is down (or CDP was disabled), and the right move is to exit rather than let the MCP fall back to an invisible standalone Chrome.
 *
 * Access token for the single-target CDP bridge. The main process generates it randomly and
 * writes it into the env, from where it travels down the process inheritance chain. Its job is
 * to **prevent blind connections**: anything connecting without it (i.e. without having read
 * discovery) is refused with a 403.
 *
 * It is **not proof of identity** — HTTP discovery is unauthenticated and its response embeds
 * the token, so any process running as the same user can fetch it with one GET (see the threat
 * model note in cdpBridge.ts). Requiring it here really means "the bridge is up": its absence
 * means there is no bridge (or CDP is switched off), and we must exit rather than let the MCP
 * fall back to spawning a separate Chrome the user cannot see.
 */
export const resolveBridgeToken = (deps: ResolveBrowserUrlDeps): string | null => {
  const raw = deps.env.AIONUI_CDP_BRIDGE_TOKEN?.trim();
  return raw ? raw : null;
};

/**
 * Decide the command line that launches chrome-devtools-mcp.
 *
 * Extracted purely for testability: browserServer.ts spawns at top level and unit tests cannot
 * import it, so the Windows branch used to have zero coverage - exactly how issue #3883 slipped through.
 *
 * On Windows npx is npx.cmd; a batch file cannot execute without a terminal, and a direct
 * spawn throws EINVAL (Node tightened .cmd handling after CVE-2024-27980). This goes through
 * cmd.exe /c rather than shell: true - see browserServer.ts for the full reasoning (DEP0190 + browserUrl being shell-parsed).
 *
 * Decides the command line used to launch chrome-devtools-mcp. Extracted purely for
 * testability: browserServer.ts spawns at module scope so tests cannot import it, which left
 * the Windows branch with no coverage at all — the reason issue #3883 slipped through.
 *
 * On Windows npx is npx.cmd, a batch file that cannot execute without a terminal, so spawning
 * it directly throws EINVAL (Node tightened .cmd handling after CVE-2024-27980). We route
 * through cmd.exe /c rather than shell: true; see browserServer.ts for the full rationale
 * (DEP0190, plus browserUrl would be parsed by the shell).
 */
export const buildMcpSpawnCommand = (deps: {
  platform: string;
  version: string;
  browserUrl: string;
}): { command: string; args: string[] } => {
  const mcpArgs = ['-y', `chrome-devtools-mcp@${deps.version}`, '--browser-url', deps.browserUrl];
  return deps.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/c', 'npx', ...mcpArgs] }
    : { command: 'npx', args: mcpArgs };
};
