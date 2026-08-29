/**
 * Compile-and-run smoke for the desktop-shortcut macro.
 *
 * `AIONUI_ENSURE_DESKTOP_SHORTCUT` lives in installer-update-verify.nsh, which
 * NO existing smoke includes — so before this file its NSIS syntax was only
 * ever exercised by a real Windows release build. A macro that fails to compile
 * (or silently takes the wrong branch) would surface as a broken installer.
 *
 * Lifts the macro verbatim from the shipped .nsh so a copy here cannot rot, and
 * runs both branches:
 *   creates   — no shortcut present: must create one pointing at the exe.
 *   keeps     — shortcut already present: must NOT touch it, so a deliberately
 *               kept (or user-customised) icon survives an update.
 *
 * Usage: node scripts/smoke-installer-shortcut.js
 */
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PROJECT_DIR = join(__dirname, '..');
const VERIFY_NSH = join(PROJECT_DIR, 'resources', 'windows', 'installer-update-verify.nsh');

/**
 * WinShell (SetLnkAUMI) ships in electron-builder's separate nsis-resources
 * package, which a real build puts on the plugin path. Point at the same copy so
 * the plugin call is genuinely resolved here rather than stubbed away -- if the
 * macro ever referenced a plugin the real build lacks, this must fail.
 */
function findPluginDir() {
  const root = join(PROJECT_DIR, '.cache', 'electron-builder');
  const found = [];
  const walk = (dir, depth = 0) => {
    if (depth > 5 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === 'x86-ansi' && existsSync(join(full, 'WinShell.dll'))) found.push(full);
      else walk(full, depth + 1);
    }
  };
  walk(root);
  if (!found.length) throw new Error('WinShell.dll not found under .cache/electron-builder — run a Windows build once');
  return found[0];
}

function findMakensis() {
  if (process.env.MAKENSIS && existsSync(process.env.MAKENSIS)) return process.env.MAKENSIS;
  const found = [];
  const walk = (dir, depth = 0) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === 'makensis.exe') found.push(full);
    }
  };
  walk(join(PROJECT_DIR, '.cache', 'electron-builder'));
  if (found.length) return found[0];
  const fromPath = spawnSync('where.exe', ['makensis.exe'], { encoding: 'utf8' });
  if (fromPath.status === 0) return fromPath.stdout.trim().split(/\r?\n/)[0];
  throw new Error('makensis.exe not found. Run a Windows build once or set MAKENSIS=C:\\path\\to\\makensis.exe');
}

function extractMacro(source, name) {
  const start = source.indexOf(`!macro ${name}`);
  if (start < 0) throw new Error(`macro ${name} not found in installer-update-verify.nsh`);
  const end = source.indexOf('!macroend', start);
  if (end < 0) throw new Error(`macro ${name} has no !macroend`);
  return source.slice(start, end + '!macroend'.length);
}

const q = (p) => p.replace(/\\/g, '\\\\');

function buildScript({ exePath, logPath, desktopDir, instDir }) {
  // $DESKTOP is an NSIS *constant* and cannot be reassigned, so the scratch
  // directory is substituted into the lifted macro. That single token is the
  // ONLY edit -- every branch, guard and log line still comes from the shipped
  // file, so this still catches a syntax error or a wrong branch there.
  const macro = extractMacro(readFileSync(VERIFY_NSH, 'utf8'), 'AIONUI_ENSURE_DESKTOP_SHORTCUT').replace(
    /\$DESKTOP/g,
    q(desktopDir)
  );

  return `
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!addplugindir /x86-ansi "${q(findPluginDir())}"

Name "shortcut-smoke"
OutFile "${q(exePath)}"
RequestExecutionLevel user
SilentInstall silent

Var /GLOBAL AionUiIsUpdated
Var /GLOBAL SmokeLog

; Defines electron-builder supplies in a real build.
!define SHORTCUT_NAME "Pavii.Ai"
!define APP_EXECUTABLE_FILENAME "PaviiAi.exe"
!define APP_DESCRIPTION "Pavii.Ai"
!define APP_ID "com.pavii.ai"

!macro SMOKE_WRITE _TEXT
  FileOpen $9 "$SmokeLog" a
  FileSeek $9 0 END
  FileWrite $9 "\${_TEXT}$\\r$\\n"
  FileClose $9
!macroend

!macro AIONUI_LOG_EVENT _MESSAGE
  !insertmacro SMOKE_WRITE "LOG \${_MESSAGE}"
!macroend

; ---- shipped macro, lifted verbatim from installer-update-verify.nsh ----
${macro}

Section
  StrCpy $SmokeLog "${q(logPath)}"
  StrCpy $AionUiIsUpdated "1"
  StrCpy $INSTDIR "${q(instDir)}"
  !insertmacro AIONUI_ENSURE_DESKTOP_SHORTCUT
  !insertmacro SMOKE_WRITE "REACHED_END"
SectionEnd
`;
}

function run(name, { preCreateShortcut }, assertFn) {
  const dir = mkdtempSync(join(tmpdir(), 'pavii-shortcut-'));
  const desktopDir = join(dir, 'Desktop');
  const instDir = join(dir, 'App');
  require('node:fs').mkdirSync(desktopDir, { recursive: true });
  require('node:fs').mkdirSync(instDir, { recursive: true });
  writeFileSync(join(instDir, 'PaviiAi.exe'), 'stub');

  const lnk = join(desktopDir, 'Pavii.Ai.lnk');
  if (preCreateShortcut) writeFileSync(lnk, 'PRE-EXISTING');

  const nsi = join(dir, `${name}.nsi`);
  const exe = join(dir, `${name}.exe`);
  const log = join(dir, `${name}.log`);
  writeFileSync(nsi, buildScript({ exePath: exe, logPath: log, desktopDir, instDir }));

  const compile = spawnSync(findMakensis(), [nsi], { encoding: 'utf8' });
  if (compile.status !== 0) {
    console.error(compile.stdout);
    console.error(compile.stderr);
    throw new Error(`[${name}] makensis failed with exit ${compile.status}`);
  }

  spawnSync(exe, [], { encoding: 'utf8' });
  const output = existsSync(log) ? readFileSync(log, 'utf8') : '';
  assertFn({ output, lnkExists: existsSync(lnk), lnkBody: existsSync(lnk) ? readFileSync(lnk, 'utf8') : null });
  rmSync(dir, { recursive: true, force: true });
  console.log(`  ok  ${name}`);
}

function main() {
  console.log('desktop shortcut smoke');

  run('creates', { preCreateShortcut: false }, ({ output, lnkExists }) => {
    if (!/result=created/.test(output)) throw new Error(`expected result=created, got:\n${output}`);
    if (!lnkExists) throw new Error('shortcut should have been created');
    if (!/REACHED_END/.test(output)) throw new Error('install should continue past the shortcut step');
  });

  run('keeps', { preCreateShortcut: true }, ({ output, lnkBody }) => {
    if (!/result=kept/.test(output)) throw new Error(`expected result=kept, got:\n${output}`);
    // An existing shortcut must be left byte-identical: recreating it on every
    // update would resurrect an icon the user deliberately customised.
    if (lnkBody !== 'PRE-EXISTING') throw new Error('an existing shortcut must not be overwritten');
    if (!/REACHED_END/.test(output)) throw new Error('install should continue past the shortcut step');
  });

  console.log('all shortcut scenarios passed');
}

main();
