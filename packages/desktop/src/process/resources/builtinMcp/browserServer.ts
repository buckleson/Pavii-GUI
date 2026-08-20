#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * In-app browser MCP launcher.
 *
 * Why this middle layer exists:
 *
 * chrome-devtools-mcp only accepts the `--browser-url` CLI argument, not env vars. Our
 * CDP port is decided at startup (9230 by default, walking upward when taken; several instances each get their own).
 * Writing the port into the MCP registration's args would mean rewriting that DB row on every launch,
 * and instances sharing one registry would inevitably clobber each other.
 *
 * So the registration never changes (it always points at this script); the port arrives in an
 * env var and this script translates it into `--browser-url` before launching the real chrome-devtools-mcp.
 * The registration stays static, the port stays dynamic, and neither side compromises.
 *
 * Why this indirection exists: chrome-devtools-mcp only accepts the CLI flag
 * `--browser-url` — it has no environment variable for it. Our CDP port is
 * resolved at launch (9230 by default, incremented when taken, distinct per
 * instance). Baking the port into the MCP registration's args would mean
 * rewriting that database record on every launch, and would race across
 * instances sharing one registry. Instead the registration stays static (always
 * pointing at this script) and the port arrives via environment variable, which
 * this script translates into `--browser-url` before spawning the real server.
 */

import { spawn } from 'node:child_process';
import { buildMcpSpawnCommand, resolveBridgeToken, resolveBrowserUrl } from './browserServerPort';

/**
 * A stdio MCP server's stdout is the protocol channel; any extra output breaks the handshake.
 * All diagnostics therefore go to stderr only.
 *
 * A stdio MCP server's stdout is the protocol channel; anything extra breaks the
 * handshake. All diagnostics therefore go to stderr.
 */
const logDiagnostic = (message: string): void => {
  process.stderr.write(`[builtin-mcp-browser] ${message}\n`);
};

const browserUrl = resolveBrowserUrl({ env: process.env });
const bridgeToken = resolveBridgeToken({ env: process.env });

if (!browserUrl || !bridgeToken) {
  /**
   * With no port or token, exit rather than launch an MCP server that would open its own Chrome.
   * The latter is worse: the agent believes it is driving the app's browser while actually
   * driving an invisible standalone Chrome - the side panel shows nothing and the problem is brutal to trace.
   *
   * The token matters as much as the port: the single-target channel requires it, and a
   * token-less connection just gets 403 - at which point chrome-devtools-mcp falls back to opening its own Chrome, exactly the behaviour this exists to kill.
   *
   * Exit rather than launching a server that would spawn its own Chrome. That failure mode
   * is worse: the agent believes it is driving the in-app browser while actually driving an
   * invisible separate Chrome, so nothing happens in the side panel and the cause is very
   * hard to find.
   *
   * The token matters as much as the port: the single-target bridge requires it, and
   * connecting without one is refused with 403 — at which point chrome-devtools-mcp would
   * fall back to spawning its own Chrome, exactly what we are eliminating.
   */
  logDiagnostic(
    'CDP bridge port or token is unavailable — refusing to start so the agent cannot drive a hidden browser instead.'
  );
  process.exit(1);
}

/**
 * The token deliberately stays server-side and is never joined into --browser-url.
 *
 * puppeteer runs `new URL('/json/version', browserUrl)`; the absolute path drops the whole query,
 * so a token appended there never reaches the server - and misleads people into thinking the discovery leg is protected.
 * Real validation happens on the WebSocket leg: the channel returns a tokened ws URL in the
 * /json/version response, puppeteer connects with it verbatim, and the token takes effect on that hop.
 *
 * The env token is still required here: it is the proof the channel actually started - its
 * absence means the channel is down, and the right move is to exit, not let the MCP fall back to a standalone Chrome.
 *
 * The token deliberately stays server-side rather than being appended to --browser-url.
 * puppeteer runs `new URL('/json/version', browserUrl)` and an absolute path drops the
 * whole query, so a token there never reaches the server and would merely create the
 * illusion that discovery is protected. Enforcement lives on the WebSocket leg: the bridge
 * writes a tokened ws address into its /json/version response, which puppeteer reuses
 * verbatim, so the token takes effect on that hop.
 *
 * We still require the token in the env: it is proof the bridge actually started. Its
 * absence means there is no bridge, and we must exit rather than let the MCP fall back to
 * spawning its own Chrome.
 */
logDiagnostic(`Connecting chrome-devtools-mcp to the in-app browser bridge at ${browserUrl}`);

/**
 * Pinned version, not @latest.
 *
 * @latest needs a network resolve on every first start (failing offline outright), and it
 * means an uncontrolled upstream can swap the code driving the browser at any time - a browser holding the user's sessions.
 *
 * Pinned rather than @latest: @latest re-resolves over the network on first launch
 * (silent multi-second delay, hard failure offline) and leaves an uncontrolled
 * upstream able to swap out the code that drives a browser holding the user's live
 * sign-in cookies.
 */
const CHROME_DEVTOOLS_MCP_VERSION = '0.16.0';

/**
 * On Windows, npx is npx.cmd - a batch file that cannot execute without a terminal.
 * A direct spawn('npx.cmd') throws synchronously (Node tightened .cmd handling after
 * CVE-2024-27980, surfacing as EINVAL; see issue #3883), so the MCP never started on Windows at all.
 *
 * The same class of problem was fixed once in shellBridge.ts (#2211, using shell: true).
 * That fix is **deliberately not copied** here, because this call site's arguments differ:
 *
 *  1. Since Node 24, "shell: true + an args array" prints the DEP0190 deprecation warning,
 *     which states the args are only concatenated, never escaped. #3883's reporter runs Node v24.15.0 - copying would just trade the error for a warning.
 *  2. More importantly, browserUrl is dynamic here. Under shell mode it passes through
 *     cmd.exe first, where `&` `|` `^` become metacharacters. Today resolveBrowserUrl()
 *     builds it from a port number as http://127.0.0.1:<port>, which is safe - but pinning
 *     "safe" on how an upstream function happens to build a string makes it an injection point the day that function changes.
 *  3. #2211 passed a fixed folderPath with neither concern, so shell: true is right there
 *     - the two sites conclude differently because their constraints differ, not because one is wrong.
 *
 * cmd.exe /c is the Node documentation's recommended form: array args keep their escaping semantics and DEP0190 never fires.
 *
 * On Windows npx is npx.cmd, a batch file that cannot execute without a terminal, so
 * spawn('npx.cmd') throws synchronously (Node tightened .cmd handling after
 * CVE-2024-27980, surfacing as EINVAL — see issue #3883) and the MCP never starts.
 *
 * shellBridge.ts fixed the same class of bug once (#2211) using shell: true. That approach is
 * deliberately NOT copied here, because this call site differs:
 *
 *  1. Since Node 24, "shell: true + args array" prints the DEP0190 deprecation warning,
 *     which states outright that arguments are concatenated rather than escaped — and the
 *     #3883 reporter is on Node v24.15.0, so copying it would trade one problem for a warning.
 *  2. More importantly this call passes a dynamic argument, browserUrl. Under shell it would
 *     first be parsed by cmd.exe, making `&`, `|`, `^` and friends metacharacters. Today
 *     resolveBrowserUrl() builds it from a port number as http://127.0.0.1:<port>, which is
 *     safe — but resting that safety on how an upstream helper concatenates a string turns
 *     any future change there into an injection point.
 *  3. #2211 passes a fixed folderPath and has neither concern, so shell: true is right there.
 *     The two sites differ in constraints, not in correctness.
 *
 * cmd.exe /c is the approach Node's own docs recommend: each argument keeps its individual
 * escaping and DEP0190 is not triggered.
 */
const spawnPlan = buildMcpSpawnCommand({
  platform: process.platform,
  version: CHROME_DEVTOOLS_MCP_VERSION,
  browserUrl,
});

const child = spawn(spawnPlan.command, spawnPlan.args, {
  // stdio pass-through: this process only forwards; the MCP protocol stream must not be buffered or rewritten by a middle layer
  // Pass stdio straight through: this process is a forwarder, and the MCP
  // protocol stream must not be buffered or rewritten in between.
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  logDiagnostic(`Failed to spawn chrome-devtools-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

// Forward termination signals so no orphan survives the MCP client shutting down.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
