import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = 'resources/windows/support/verify-bundled-paviicore-install.ps1';
const script = readFileSync(scriptPath, 'utf8');

function writeFile(filePath: string, contents = '') {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeJson(filePath: string, value: unknown) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTempInstall() {
  const root = join(process.cwd(), '.cache', 'tests');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'aionui-install-verify-'));
}

function writeValidInstallBase(installDir: string, managedManifest: unknown) {
  const baseDir = join(installDir, 'resources', 'bundled-paviicore', 'win32-x64');
  const managedRoot = join(baseDir, 'managed-resources');

  writeFile(join(baseDir, 'paviicore.exe'), 'x');
  writeJson(join(baseDir, 'manifest.json'), {
    platform: 'win32',
    arch: 'x64',
  });
  writeFile(join(managedRoot, 'node', 'node-v24.11.0-win-x64', 'node.exe'), 'x');
  writeJson(join(managedRoot, 'manifest.json'), managedManifest);
}

function runVerifier(installDir: string, logPath: string) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-InstallDir',
      installDir,
      '-RuntimeKey',
      'win32-x64',
      '-LogPath',
      logPath,
    ],
    { encoding: 'utf8' }
  );
}

describe('Windows bundled aioncore install verifier', () => {
  it('reads managed resources manifest instead of deriving Codex platform paths', () => {
    expect(script).toContain("Join-Path $managedRoot 'manifest.json'");
    expect(script).toContain('schemaVersion');
    expect(script).toContain('$Cli.executable');
    expect(script).not.toContain('Get-CodexPlatformExecutable');
    expect(script).not.toContain('x86_64-pc-windows-msvc');
  });

  it('logs machine-readable contract failures', () => {
    expect(script).toContain('duplicate_cli_name');
    expect(script).not.toContain('missing_required_cli');
    expect(script).toContain('unsupported_schema_version');
    expect(script).toContain('invalid_schema');
    expect(script).toContain('result=fail runtime=$RuntimeKey failures=$summary');
  });

  it('requires numeric schemaVersion without PowerShell string coercion', () => {
    expect(script).toContain("Test-NumberField $contract 'schemaVersion'");
    expect(script).not.toContain('if ($contract.schemaVersion -ne 2)');
  });

  const runOnWindows = process.platform === 'win32' ? it : it.skip;

  runOnWindows('passes when managed resources intentionally include no CLIs', () => {
    const tmp = makeTempInstall();
    const installDir = join(tmp, 'install');
    const logPath = join(tmp, 'verify.log');

    try {
      writeValidInstallBase(installDir, {
        schemaVersion: 2,
        runtimeKey: 'win32-x64',
        node: {
          version: '24.11.0',
          root: 'node/node-v24.11.0-win-x64',
          executable: 'node.exe',
        },
        clis: [],
      });

      const result = runVerifier(installDir, logPath);

      expect(result.status).toBe(0);
      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('result=ok');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  runOnWindows('fails malformed CLI entries that are present in the manifest', () => {
    const tmp = makeTempInstall();
    const installDir = join(tmp, 'install');
    const logPath = join(tmp, 'verify.log');

    try {
      writeValidInstallBase(installDir, {
        schemaVersion: 2,
        runtimeKey: 'win32-x64',
        node: {
          version: '24.11.0',
          root: 'node/node-v24.11.0-win-x64',
          executable: 'node.exe',
        },
        clis: [
          {
            name: 'codex',
            version: '0.144.6',
            root: 'cli/codex/0.144.6/win32-x64',
            platformDirectory: 'win32-x64',
            requiredFiles: [],
            requiredDirectories: [],
          },
        ],
      });

      const result = runVerifier(installDir, logPath);

      expect(result.status).not.toBe(0);
      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('codex');
      expect(log).toContain('invalid_schema');
      expect(log).toContain('result=fail');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
