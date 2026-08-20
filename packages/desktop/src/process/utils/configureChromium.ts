/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { getDevAppName } from '@/common/platform';
import { applyGpuRecoveryFlags } from './gpuRecovery';

// ============ E2E test isolation ============
// When running under E2E with an explicit sandbox dir, redirect userData there
// BEFORE any getPath() call so the whole data tree (config, aioncore DB, logs)
// lives in a disposable directory. This keeps tests off the developer's real
// database — critical because AionCore refuses to boot when a shared DB fails
// migration. Guarded by AIONUI_E2E_TEST so it never affects dev/production.
// E2E only: point userData at a disposable sandbox so tests never touch the real database.
const e2eUserDataDir = process.env.AIONUI_E2E_TEST === '1' ? process.env.AIONUI_E2E_USER_DATA_DIR : undefined;
if (e2eUserDataDir && e2eUserDataDir.trim() !== '') {
  fs.mkdirSync(e2eUserDataDir, { recursive: true });
  app.setPath('userData', e2eUserDataDir);
}

// ============ Environment Separation ============
// Set app name before any getPath() call so userData is isolated from production.
// Note: getPlatformServices() auto-registration also applies this as a safety net
// in case Rollup loads initStorage's chunk before this module runs.
// Dev mode gets its own app name so userData is isolated from release builds and both can run
// side by side. Skipped when the E2E sandbox already set userData explicitly, so the dev app name cannot override it.
if (!app.isPackaged && !e2eUserDataDir) {
  const devAppName = getDevAppName();
  app.setName(devAppName);
  // In Electron 28+, setName alone no longer updates userData path on macOS.
  // Explicitly override userData to the dev directory.
  const appSupportDir = path.dirname(app.getPath('userData'));
  app.setPath('userData', path.join(appSupportDir, devAppName));
}

// app.disableHardwareAcceleration() must run before app is ready.
applyGpuRecoveryFlags();

// Configure Chromium command-line flags for WebUI and CLI modes
// Configure Chromium command-line switches for WebUI and CLI modes

const isWebUI = process.argv.some((arg) => arg === '--webui');
const isResetPassword = process.argv.includes('--resetpass');

// Only configure flags for WebUI and --resetpass modes
// Only WebUI and reset-password modes get these switches
if (isWebUI || isResetPassword) {
  // In WebUI/reset-password mode on Linux, force headless Ozone backend.
  // This mode should never depend on X11/Wayland availability.
  // On Linux in WebUI/reset-password mode, force the headless Ozone backend so platform init
  // does not fail when DISPLAY exists but no display server is reachable.
  // Note: Do NOT use --headless (browser automation mode that causes auto-exit).
  // Instead, use --ozone-platform=headless which provides a proper display backend
  // without requiring a display server, keeping the Electron process alive.
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform', 'headless');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  // For root user, disable sandbox to prevent crash
  // For root, disable the sandbox to prevent crashes
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    app.commandLine.appendSwitch('no-sandbox');
  }
}

// ---------------------------------------------------------------------------
// Agent browser control (CDP) — user-facing on/off switch and its persisted config.
//
// This block no longer allocates a port. The single-target bridge (cdpBridge.ts) binds an
// OS-assigned ephemeral port via listen(0) and backfills it here through setActiveCdpPort,
// so there is exactly one port concept in the codebase: the one you can actually connect to.
//
// The 9230-9250 reservation and the ~/.aionui-cdp-registry.json instance registry were
// removed with Chromium's application-wide remote-debugging-port switch. Once that switch
// was gone nothing listened on that range, so the registry tracked a service that did not
// exist, multi-instance avoidance was avoiding phantoms, and — worst of all — the settings
// page displayed the reserved number as "the current CDP port" and built copy-pasteable MCP
// config from it, handing users an address that could never connect.
//
// Do not move the bridge onto a fixed port to bring that bookkeeping back: the ephemeral
// port is the only real barrier against same-user local processes, because the token leaks
// through the unauthenticated discovery endpoint (see the threat model note in cdpBridge.ts).
//
// Configuration file: userData/cdp.config.json
// - enabled: boolean - whether agent browser control is enabled (default: on)
// - port: number - legacy preferred-port field, retained for config compatibility
//
// Override via AIONUI_CDP_PORT env variable. Set to "0" or "false" to disable.
// ---------------------------------------------------------------------------

const CDP_CONFIG_FILE = 'cdp.config.json';

/** CDP configuration stored in userData directory */
export interface CdpConfig {
  /** Whether CDP is enabled (default: true in dev mode, false in production) */
  enabled?: boolean;
  /**
   * Historical field: it used to pick the reserved port. Unread since the channel moved to
   * listen(0), but kept in the type so old config files with the extra key stay valid.
   *
   * Legacy field that used to pick a reserved port. Unread since the bridge moved to
   * listen(0), but kept in the type so existing config files do not trip over an
   * unrecognised key.
   */
  port?: number;
}

/** CDP status information exposed to renderer */
export interface CdpStatus {
  /** Whether CDP is currently enabled */
  enabled: boolean;
  /** Current CDP port (null if disabled or not started) */
  port: number | null;
  /** Whether CDP was enabled at startup (requires restart to change) */
  startupEnabled: boolean;
  /** Whether CDP is enabled in the persisted config file (may differ from runtime) */
  configEnabled: boolean;
  /** Whether the app is running in development mode */
  isDevMode: boolean;
}

/**
 * Also removes the leftover instance-registry file.
 *
 * That file (~/.aionui-cdp-registry.json) used to record which CDP port each instance held.
 * The logic went away with the app-level remote-debugging-port, but upgraded machines still
 * carry the file full of long-dead pids/ports. Leaving it implies the machinery still exists, so clean it up. Best-effort; failure is fine.
 *
 * Remove the leftover instance-registry file. ~/.aionui-cdp-registry.json used to record
 * which CDP port each instance had taken; that logic went away with the application-wide
 * remote-debugging-port switch, but upgraded machines still have the file sitting there full
 * of long-dead pids and ports. Leaving it implies the mechanism still exists, so clean it up.
 * Best-effort: failure is harmless.
 */
function removeLegacyCdpRegistryFile(): void {
  try {
    const legacyRegistry = path.join(os.homedir(), '.aionui-cdp-registry.json');
    if (fs.existsSync(legacyRegistry)) {
      fs.unlinkSync(legacyRegistry);
    }
  } catch {
    // Nothing depends on this succeeding.
  }
}

/**
 * Load CDP configuration from userData directory.
 * This must be called before app.ready, so we use synchronous file operations.
 */
function loadCdpConfig(): CdpConfig {
  try {
    // Try to get userData path - this works even before app.ready
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, CDP_CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
      return {};
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as CdpConfig;
    }
  } catch {
    // Ignore errors when loading config
  }
  return {};
}

/**
 * Save CDP configuration to userData directory.
 */
export function saveCdpConfig(config: CdpConfig): void {
  try {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, CDP_CONFIG_FILE);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[CDP] Failed to save CDP config:', error);
  }
}

/**
 * Determine if CDP should be enabled at startup.
 * Priority: env variable > config file > default (enabled).
 *
 * On by default (release included): the in-app browser cannot be agent-driven without this
 * channel, and "works out of the box" would not hold. It binds 127.0.0.1 only; the user can
 * still disable it in settings, after which the agent cannot drive the browser (the MCP
 * launcher then refuses to start rather than silently opening an invisible Chrome).
 *
 * AIONUI_CDP_PORT is now only a switch ("0"/"false" = off, any other non-empty value = on).
 * Its number no longer picks the port - the channel uses listen(0) and the OS assigns it. The name survives so existing scripts and E2E fixtures keep working.
 *
 * Enabled by default, production included: the in-app browser cannot be driven by the agent
 * without this bridge, so "works out of the box" would otherwise fail. The bridge binds to
 * 127.0.0.1 only and is never externally reachable. Users can still turn it off in settings,
 * after which the agent simply cannot drive the browser (the MCP launcher refuses to start
 * rather than quietly opening a Chrome the user cannot see).
 *
 * AIONUI_CDP_PORT now acts purely as a switch ("0"/"false" disables, any other non-empty
 * value enables). Its numeric value no longer selects a port — the bridge uses listen(0) and
 * the OS assigns one. The name is kept so existing scripts and E2E fixtures keep working.
 */
function shouldEnableCdp(config: CdpConfig): boolean {
  const envVal = process.env.AIONUI_CDP_PORT;
  if (envVal === '0' || envVal === 'false') return false;
  if (envVal) return true;

  if (config.enabled !== undefined) {
    return config.enabled;
  }

  return true;
}

/**
 * The channel's actual listening port, backfilled by cdpBridge after startup; null when disabled or not yet up.
 *
 * Deliberately no longer reserves the 9230-9250 range here. After remote-debugging-port was
 * removed nothing listens on that range - findAvailablePort/registerInstance tracked a service
 * that does not exist, multi-instance avoidance lost its meaning, and the settings page showed
 * it as "current CDP port" and generated copyable MCP configs from it - handing the user an
 * address that cannot connect. The channel uses listen(0) (also the only real local barrier; see cdpBridge.ts's threat model), so the true port is knowable only after the bridge starts -
 * it backfills here, and the app keeps exactly one notion of the port.
 *
 * The bridge's real listening port, backfilled by cdpBridge once it starts; null while agent
 * browser control is off or the bridge has not come up.
 *
 * Deliberately no longer reserves a port from the 9230-9250 range here. With
 * remote-debugging-port gone nothing listens on that range, so findAvailablePort /
 * registerInstance were tracking a service that does not exist: multi-instance avoidance
 * became meaningless, while the settings page displayed it as "the current CDP port" and
 * generated copy-pasteable MCP config from it — handing the user an address that cannot be
 * reached. The bridge uses listen(0) (also the only real local barrier — see the threat model
 * note in cdpBridge.ts), so the real port is only knowable after it starts. It backfills this
 * value, leaving exactly one port concept in the codebase.
 */
export let cdpPort: number | null = null;

/** Called by cdpBridge once it is listening, so status/UI report the reachable port. */
export function setActiveCdpPort(port: number | null): void {
  cdpPort = port;
}

/** Whether CDP was enabled at startup (requires restart to change). */
export let cdpStartupEnabled: boolean = false;

// Load config and initialize CDP at startup
const cdpConfig = loadCdpConfig();
cdpStartupEnabled = shouldEnableCdp(cdpConfig);

if (cdpStartupEnabled) {
  /**
   * Deliberately no longer calls appendSwitch('remote-debugging-port', ...).
   *
   * That Chromium switch is application-wide with no per-target ACL: one flip exposes every
   * WebContents - the preload-bridged main window included - with no authentication at all.
   * Any local process that connects can drive the whole application.
   *
   * cdpBridge now exposes only the side browser's webContents. Port and env writes moved to the
   * bridge startup site (see index.ts); this file only decides whether the user enabled the capability.
   *
   * Deliberately no longer calls appendSwitch('remote-debugging-port', ...). That switch is
   * application-wide with no per-target ACL: it exposes every WebContents — including the
   * main window with its preload bridge — with no authentication, so any local process can
   * drive the whole app. cdpBridge exposes only the in-app browser webview instead. Port
   * allocation and env publication now live where the bridge starts (see index.ts); this
   * block only decides whether the user enabled the capability at all.
   */
  console.log('[CDP] Agent browser control enabled (single-target bridge)');
} else {
  console.log('[CDP] Agent browser control disabled');
}

// Clean once regardless of the switch: users who disabled the capability should not keep the dead file either.
// Runs regardless of the switch: users who turned the capability off should not be left
// with the stale file either.
removeLegacyCdpRegistryFile();

/**
 * verifyCdpReady went away together with remote-debugging-port.
 *
 * It probed the app-level port's /json/version; nothing listens there any more, so keeping it
 * would only put a guaranteed-failure warning in the startup log. The single-target channel's
 * readiness shows directly in startCdpBridge()'s return value; no probe needed.
 *
 * verifyCdpReady was removed together with remote-debugging-port. It probed
 * /json/version on Chromium's application-wide port, where nothing listens any more, so
 * keeping it would only emit a warning that can never succeed. Bridge readiness is now
 * evident from startCdpBridge()'s return value, with no probing required.
 */

/**
 * Get current CDP status for display in UI.
 */
export function getCdpStatus(): CdpStatus {
  const config = loadCdpConfig();
  return {
    /**
     * enabled means "the channel is actually up and reachable", so it reads cdpPort, not config:
     * with the config on but the bridge failed to start, the UI must not claim it is enabled.
     *
     * `enabled` means the bridge is actually up and reachable, so it reads cdpPort rather
     * than the config: with the setting on but bridge startup failed, the UI must not claim
     * the capability is active.
     */
    enabled: cdpPort !== null,
    port: cdpPort,
    startupEnabled: cdpStartupEnabled,
    configEnabled: config.enabled ?? cdpStartupEnabled,
    isDevMode: !app.isPackaged,
  };
}

/**
 * Update CDP configuration and save to disk.
 * Note: Changing the enabled state requires app restart to take effect.
 */
export function updateCdpConfig(newConfig: Partial<CdpConfig>): CdpConfig {
  const currentConfig = loadCdpConfig();
  const updatedConfig = { ...currentConfig, ...newConfig };
  saveCdpConfig(updatedConfig);
  return updatedConfig;
}
