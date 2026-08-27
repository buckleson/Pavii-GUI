/**
 * Compile-and-run smoke for the E1020 free-space gate.
 *
 * The gate lives in NSIS, where a mistake is a compile error or a silently
 * skipped branch rather than a failing unit test — an earlier `Var /GLOBAL`
 * placed inside a macro compiled fine and was invisible to its caller. This
 * builds a real installer stub around the shipped macros and runs it, so both
 * the syntax and the branch selection are proven against makensis itself.
 *
 * Scenarios:
 *   sufficient   — threshold of 1 MB, a real drive: must take the "ok" branch.
 *   insufficient — absurd threshold: must raise E1020 and quit non-zero.
 *   unmeasurable — unrooted $INSTDIR, so the probe emits nothing: must FAIL
 *                  OPEN (continue, log unknown) despite an unmet threshold.
 *
 * Usage: node scripts/smoke-installer-disk-gate.js
 */
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PROJECT_DIR = join(__dirname, '..');

function findMakensis() {
  if (process.env.MAKENSIS && existsSync(process.env.MAKENSIS)) return process.env.MAKENSIS;
  const roots = [join(PROJECT_DIR, '.cache', 'electron-builder')];
  const found = [];
  const walk = (dir, depth = 0) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === 'makensis.exe') found.push(full);
    }
  };
  for (const root of roots) walk(root);
  if (found.length) return found[0];
  const fromPath = spawnSync('where.exe', ['makensis.exe'], { encoding: 'utf8' });
  if (fromPath.status === 0) return fromPath.stdout.trim().split(/\r?\n/)[0];
  throw new Error('makensis.exe not found. Run a Windows build once or set MAKENSIS=C:\\path\\to\\makensis.exe');
}

const q = (p) => p.replace(/\\/g, '\\\\');

const ERRORS_NSH = join(PROJECT_DIR, 'resources', 'windows', 'installer-errors-sentry.nsh');
const MESSAGES_NSH = join(PROJECT_DIR, 'resources', 'windows', 'installer-messages.nsh');

/**
 * Lift a macro out of the shipped .nsh verbatim.
 *
 * The harness must run the REAL macro text, not a copy of it: a copy passes
 * forever while the shipped file rots. Anything that cannot be found here is a
 * hard error rather than a skipped assertion.
 */
function extractMacro(source, name) {
  const start = source.indexOf(`!macro ${name}`);
  if (start < 0) throw new Error(`macro ${name} not found in installer-errors-sentry.nsh`);
  const end = source.indexOf('!macroend', start);
  if (end < 0) throw new Error(`macro ${name} has no !macroend`);
  return source.slice(start, end + '!macroend'.length);
}

/**
 * A standalone script that pulls in the real macro definitions. The heavy
 * includes (process control, registry) are not needed and drag in electron-
 * builder template state, so only the two files under test are included and
 * the handful of macros they call are stubbed to log instead.
 */
function buildScript({ exePath, logPath, minFreeMb, instDir }) {
  const source = readFileSync(ERRORS_NSH, 'utf8');
  const realMacros = [
    extractMacro(source, 'AIONUI_MEASURE_FREE_MB'),
    extractMacro(source, 'AIONUI_ASSERT_FREE_SPACE'),
  ].join('\n\n');

  return `
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "${q(MESSAGES_NSH)}"

Name "disk-gate-smoke"
OutFile "${q(exePath)}"
RequestExecutionLevel user
SilentInstall silent

Var /GLOBAL AionUiFreeMbExit
Var /GLOBAL AionUiFreeMb
Var /GLOBAL SmokeLog

!define AIONUI_MIN_FREE_MB ${minFreeMb}
!define AIONUI_E_DISK_INSUFFICIENT "E1020"

!macro SMOKE_WRITE _TEXT
  FileOpen $9 "$SmokeLog" a
  FileSeek $9 0 END
  FileWrite $9 "\${_TEXT}$\\r$\\n"
  FileClose $9
!macroend

; Stubs for the collaborators the gate calls.
!macro AIONUI_LOG_EVENT _MESSAGE
  !insertmacro SMOKE_WRITE "LOG \${_MESSAGE}"
!macroend

!macro AIONUI_FAIL_REPORTABLE_DIAGNOSTICS _CODE _DETAIL _MSG_EN _ACTION_EN _DIAGNOSTICS_EN
  !insertmacro SMOKE_WRITE "FAIL code=\${_CODE}"
  !insertmacro SMOKE_WRITE "FAIL detail=\${_DETAIL}"
  SetErrorLevel 2
  Quit
!macroend

; ---- shipped macros, lifted verbatim from installer-errors-sentry.nsh ----
${realMacros}

Section
  StrCpy $SmokeLog "${q(logPath)}"
  StrCpy $INSTDIR "${instDir}"
  !insertmacro AIONUI_ASSERT_FREE_SPACE "pre-remove"
  !insertmacro SMOKE_WRITE "REACHED_END"
SectionEnd
`;
}

function run(name, opts, assertFn) {
  const dir = mkdtempSync(join(tmpdir(), 'pavii-disk-gate-'));
  const nsi = join(dir, `${name}.nsi`);
  const exe = join(dir, `${name}.exe`);
  const log = join(dir, `${name}.log`);
  writeFileSync(nsi, buildScript({ exePath: exe, logPath: log, ...opts }));

  const compile = spawnSync(findMakensis(), [nsi], { encoding: 'utf8' });
  if (compile.status !== 0) {
    console.error(compile.stdout);
    console.error(compile.stderr);
    throw new Error(`[${name}] makensis failed with exit ${compile.status}`);
  }

  const runResult = spawnSync(exe, [], { encoding: 'utf8' });
  const output = existsSync(log) ? readFileSync(log, 'utf8') : '';
  assertFn({ exit: runResult.status, output });
  console.log(`  ok  ${name}`);
}

function main() {
  console.log('E1020 free-space gate smoke');

  // A threshold of 1 MB always passes on a working temp drive.
  run('sufficient', { minFreeMb: 1, instDir: '$TEMP' }, ({ exit, output }) => {
    if (!/result=ok/.test(output)) throw new Error(`expected the ok branch, got:\n${output}`);
    if (!/REACHED_END/.test(output)) throw new Error('install should have continued past the gate');
    if (exit !== 0) throw new Error(`expected exit 0, got ${exit}`);
  });

  // A petabyte threshold cannot be satisfied, so the gate must stop the install.
  run('insufficient', { minFreeMb: 999999999, instDir: '$TEMP' }, ({ exit, output }) => {
    if (!/result=insufficient/.test(output)) throw new Error(`expected the insufficient branch, got:\n${output}`);
    if (!/FAIL code=E1020/.test(output)) throw new Error(`expected E1020, got:\n${output}`);
    if (/REACHED_END/.test(output)) throw new Error('install must NOT continue past a failed gate');
    if (exit === 0) throw new Error('a blocked install must not exit 0');
  });

  // An unrooted path makes the REAL probe emit nothing, which is the same
  // shape as a broken PowerShell. Paired with an unsatisfiable threshold, so a
  // gate that failed closed instead of open would be caught here.
  run('unmeasurable', { minFreeMb: 999999999, instDir: '' }, ({ exit, output }) => {
    if (!/result=unknown/.test(output)) throw new Error(`expected the unknown branch, got:\n${output}`);
    if (!/REACHED_END/.test(output)) throw new Error('an unmeasurable drive must FAIL OPEN and continue');
    if (exit !== 0) throw new Error(`fail-open must exit 0, got ${exit}`);
  });

  console.log('all disk-gate scenarios passed');
}

main();
