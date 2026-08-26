#!/usr/bin/env node

/**
 * Transactional-update smoke: proves a failed update can no longer destroy a
 * working installation (live failure 2026-08-27: E1010 after the old install
 * was already gone, plus an atomic-failed path that cleared the registry of
 * an intact install).
 *
 * Scenario `restore`: customRemoveFiles snapshots the old install, then a
 * simulated fatal extract failure hits the failure funnel — the old install
 * must be back in place, the snapshot gone, `rollback-restored` logged, and
 * the installer must exit 2.
 *
 * Scenario `atomic-intact`: a file inside the install dir is exclusively
 * locked so the atomic rename cannot happen. Silent mode must retry
 * (atomic-silent-retry events), then fail with `oldInstallIntact=1` and leave
 * the install dir untouched.
 */

const {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function nsisQuote(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '$\\"').replace(/\$/g, '$$');
}

function findMakensis() {
  if (process.env.MAKENSIS && existsSync(process.env.MAKENSIS)) {
    return process.env.MAKENSIS;
  }
  const candidates = [];
  const cacheRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache') : '';
  function walk(dir, depth = 0) {
    if (!dir || depth > 5 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === 'makensis.exe') candidates.push(full);
    }
  }
  walk(cacheRoot);
  candidates.sort((a, b) => b.localeCompare(a));
  if (candidates[0]) return candidates[0];
  const fromPath = spawnSync('where.exe', ['makensis.exe'], { encoding: 'utf8' });
  if (fromPath.status === 0) {
    const first = fromPath.stdout.split(/\r?\n/).find(Boolean);
    if (first && existsSync(first)) return first;
  }
  throw new Error('makensis.exe not found. Run a Windows build once or set MAKENSIS=C:\\path\\to\\makensis.exe');
}

function readJsonl(logPath) {
  return readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line.replace(/^\uFEFF/, '')));
}

/** Stage a project mirror with an empty Sentry DSN, like the messagebox smoke. */
function copyHarnessProject(projectRoot) {
  const windowsDir = path.join(projectRoot, 'resources', 'windows');
  const supportDir = path.join(windowsDir, 'support');
  mkdirSync(supportDir, { recursive: true });
  for (const file of [
    'installer-observability.nsh',
    'installer-errors-sentry.nsh',
    'installer-messages.nsh',
    'installer-process-control.nsh',
    'installer-remove-registry.nsh',
  ]) {
    copyFileSync(path.join(repoRoot, 'resources', 'windows', file), path.join(windowsDir, file));
  }
  for (const file of ['report-installer-failure.ps1', 'query-lockers.ps1']) {
    copyFileSync(path.join(repoRoot, 'resources', 'windows', 'support', file), path.join(supportDir, file));
  }
  writeFileSync(path.join(supportDir, '_sentry-dsn.generated.nsh'), '!define AIONUI_SENTRY_DSN ""\n', 'utf8');
}

function buildHarness({ root, projectRoot, installDir, logPath, silent }) {
  const nsiPath = path.join(root, 'aionui-rollback-smoke.nsi');
  const exePath = path.join(root, 'aionui-rollback-smoke.exe');
  const windowsDir = path.join(projectRoot, 'resources', 'windows');

  const nsi = `
Unicode true
Name "Pavii.Ai Rollback Smoke"
OutFile "${nsisQuote(exePath)}"
RequestExecutionLevel user
${silent ? 'SilentInstall silent' : ''}
!define VERSION "rollback-smoke"
!define AIONUI_TARGET_ARCH "x64"
!define AIONUI_RUNTIME_KEY "win32-x64"
# AIONUI_APP_EXECUTABLE_FILENAME / AIONUI_FALLBACK_LOG come from
# installer-observability.nsh, which also declares the session globals.
!define UNINSTALL_FILENAME "Uninstall PaviiAi.exe"
!define UNINSTALL_REGISTRY_KEY "Software\\PaviiRollbackSmoke\\Uninstall"
!define INSTALL_REGISTRY_KEY "Software\\PaviiRollbackSmoke\\Install"
!define PROJECT_DIR "${nsisQuote(projectRoot)}"
!include LogicLib.nsh

# Harness stand-ins for electron-builder context.
Var HarnessUpdated
!macro _isUpdated _a _b _t _f
  StrCmp $HarnessUpdated "1" \`\${_t}\` \`\${_f}\`
!macroend
!define isUpdated \`"" isUpdated ""\`
!macro AIONUI_CLEAR_ACTIVE_INSTALLER_MARKER
!macroend

!include "${nsisQuote(path.join(windowsDir, 'installer-observability.nsh'))}"
!include "${nsisQuote(path.join(windowsDir, 'installer-errors-sentry.nsh'))}"
!include "${nsisQuote(path.join(windowsDir, 'installer-process-control.nsh'))}"
!include "${nsisQuote(path.join(windowsDir, 'installer-remove-registry.nsh'))}"

Section
  StrCpy $INSTDIR "${nsisQuote(installDir)}"
  StrCpy $AionUiSessionId "rollback"
  StrCpy $AionUiIsUpdated "1"
  StrCpy $HarnessUpdated "1"
  StrCpy $AionUiSessionLogPath "${nsisQuote(logPath)}"
  InitPluginsDir
  SetOutPath $TEMP

  !insertmacro customRemoveFiles

  # Reaching here means the old install was snapshotted; simulate the extract
  # phase dying (the E1010 class) so the funnel must restore the snapshot.
  !insertmacro AIONUI_FAIL_REPORTABLE \${AIONUI_E_EXTRACT_FAILED} "event=session-end result=fail code=\${AIONUI_E_EXTRACT_FAILED} phase=smoke-simulated fatal=1" "\${AIONUI_MSG_ROLLBACK_RESTORED_EN}" "\${AIONUI_MSG_CLOSE_SHOWN_FILE_ACTION_EN}"
SectionEnd
`;

  writeFileSync(nsiPath, nsi, 'utf8');
  const makensis = findMakensis();
  const compile = spawnSync(makensis, [nsiPath], { encoding: 'utf8' });
  if (compile.status !== 0) {
    process.stdout.write(compile.stdout || '');
    process.stderr.write(compile.stderr || '');
    throw new Error(`makensis failed with exit ${compile.status}`);
  }
  return exePath;
}

function newLogPath(tag) {
  return path.join(process.env.TEMP || tmpdir(), `aionui-installer-rollback-${tag}-${Date.now()}-log.jsonl`);
}

function assertEvent(events, name, extra) {
  const hit = events.filter((event) => event.event === name).at(-1);
  if (!hit) {
    throw new Error(
      `expected JSONL event '${name}', events seen: ${[...new Set(events.map((e) => e.event))].join(', ')}`
    );
  }
  if (extra) extra(hit);
  return hit;
}

function scenarioRestore() {
  const root = mkdtempSync(path.join(tmpdir(), 'aionui-rollback-restore-'));
  const projectRoot = path.join(root, 'project');
  copyHarnessProject(projectRoot);
  const installDir = path.join(root, 'install-dir');
  mkdirSync(installDir, { recursive: true });
  writeFileSync(path.join(installDir, 'PaviiAi.exe'), 'OLD-INSTALL-SENTINEL', 'utf8');
  const logPath = newLogPath('restore');

  try {
    const exePath = buildHarness({ root, projectRoot, installDir, logPath, silent: true });
    const run = spawnSync(exePath, [], { encoding: 'utf8' });
    if (run.status !== 2) {
      throw new Error(`expected installer exit 2 after simulated failure, got ${run.status}`);
    }

    if (!existsSync(path.join(installDir, 'PaviiAi.exe'))) {
      throw new Error('old install was NOT restored after the simulated failure');
    }
    const sentinel = readFileSync(path.join(installDir, 'PaviiAi.exe'), 'utf8');
    if (sentinel !== 'OLD-INSTALL-SENTINEL') {
      throw new Error('restored PaviiAi.exe does not carry the old-install content');
    }
    if (existsSync(`${installDir}.__old`)) {
      throw new Error('snapshot directory was left behind after restore');
    }

    const events = readJsonl(logPath);
    assertEvent(events, 'rollback-restored');
    assertEvent(events, 'session-end');
    console.log('[rollback] restore scenario ok');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(logPath, { force: true });
  }
}

function scenarioAtomicIntact() {
  const root = mkdtempSync(path.join(tmpdir(), 'aionui-rollback-atomic-'));
  const projectRoot = path.join(root, 'project');
  copyHarnessProject(projectRoot);
  const installDir = path.join(root, 'install-dir');
  mkdirSync(installDir, { recursive: true });
  writeFileSync(path.join(installDir, 'PaviiAi.exe'), 'OLD-INSTALL-SENTINEL', 'utf8');
  const lockedFile = path.join(installDir, 'locked-by-smoke.txt');
  writeFileSync(lockedFile, 'locked', 'utf8');
  const logPath = newLogPath('atomic');

  // Hold an exclusive handle inside the dir so Rename of the dir fails.
  const locker = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `$f=[System.IO.File]::Open('${lockedFile.replace(/'/g, "''")}','Open','Read','None'); Start-Sleep -Seconds 120`,
    ],
    { stdio: 'ignore' }
  );

  try {
    // Give the locker a moment to acquire the handle.
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2']);

    const exePath = buildHarness({ root, projectRoot, installDir, logPath, silent: true });
    const run = spawnSync(exePath, [], { encoding: 'utf8', timeout: 180000 });
    if (run.status !== 2) {
      throw new Error(`expected installer exit 2 on atomic failure, got ${run.status}`);
    }

    if (!existsSync(path.join(installDir, 'PaviiAi.exe'))) {
      throw new Error('install dir was damaged by a failed atomic rename');
    }

    const events = readJsonl(logPath);
    const retries = events.filter((event) => event.event === 'atomic-silent-retry');
    if (retries.length !== 3) {
      throw new Error(`expected 3 silent atomic retries, saw ${retries.length}`);
    }
    const sessionEnd = assertEvent(events, 'session-end');
    if (!String(sessionEnd.message || '').includes('oldInstallIntact=1')) {
      throw new Error(`session-end must record oldInstallIntact=1: ${sessionEnd.message}`);
    }
    if (events.some((event) => event.event === 'registry-clear')) {
      throw new Error('atomic failure must NOT clear the registry of an intact install');
    }
    console.log('[rollback] atomic-intact scenario ok');
  } finally {
    try {
      locker.kill();
    } catch {
      /* already gone */
    }
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 1']);
    rmSync(root, { recursive: true, force: true });
    rmSync(logPath, { force: true });
  }
}

try {
  if (process.platform !== 'win32') {
    throw new Error('This smoke test only runs on Windows.');
  }
  scenarioRestore();
  scenarioAtomicIntact();
  console.log('[rollback] all scenarios ok');
} catch (err) {
  console.error(`[rollback] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
