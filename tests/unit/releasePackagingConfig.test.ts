import { describe, expect, it, vi } from 'vitest';

// These tests spawn real subprocesses / render full dialogs, so their runtime
// is load-dependent: each passes alone in seconds but has timed out at the
// 10 s default when the whole suite runs on a saturated machine. The raised
// budget covers contention, not slower logic.
vi.setConfig({ testTimeout: 30_000 });
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const projectRoot = resolve(__dirname, '../..');
const itWithBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;
// The fork snapshot has no .github directory; skip workflow assertions until CI workflows are restored.
const itWithWorkflows = existsSync(resolve(projectRoot, '.github/workflows/_build-reusable.yml')) ? it : it.skip;

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

describe('release packaging configuration', () => {
  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('builds Windows differential update blockmaps', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const nsisBlock = yamlBlock(config, 'nsis');

    expect(nsisBlock).toContain('  differentialPackage: true');
  });

  itWithWorkflows('uploads mac zip artifacts without a stale Windows zip glob', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/Pavii.Ai-*-mac-*.zip');
    expect(workflow).not.toContain('out/Pavii.Ai-*-win32-*.zip');
  });

  itWithWorkflows('uploads Windows blockmaps from build jobs', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/Pavii.Ai-*.exe.blockmap');
  });

  itWithWorkflows('stages and verifies Windows blockmap release assets', () => {
    // Blockmaps reach the publish job as draft-release assets uploaded by the
    // build jobs (the artifact-mediated `find`-staging is gone with the
    // artifact quota dependency); the publish job must still refuse to go
    // live without both Windows blockmaps.
    const workflow = readProjectFile('.github/workflows/release.yml');

    expect(workflow).toContain('gh release download');
    expect(workflow).toContain('Verify Windows differential update assets are present');
    // Gates key on ARTIFACT_V (read from the built latest.yml), not the tag:
    // installers are named by package.json's version, which an rc tag's
    // version deliberately differs from.
    expect(workflow).toContain('Pavii.Ai-$ARTIFACT_V-win-x64.exe.blockmap');
    expect(workflow).toContain('Pavii.Ai-$ARTIFACT_V-win-arm64.exe.blockmap');
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  it('prefers CI-built local Pavii Engine before upstream release downloads', () => {
    const script = readProjectFile('packages/shared-scripts/src/prepare-paviicore.js');
    const localBinaryIndex = script.indexOf('AIONUI_BACKEND_LOCAL_BINARY');
    const downloadIndex = script.indexOf('Download from GitHub releases only when no explicit local source exists');

    expect(localBinaryIndex).toBeGreaterThan(-1);
    expect(downloadIndex).toBeGreaterThan(-1);
    expect(localBinaryIndex).toBeLessThan(downloadIndex);
  });

  itWithBash('fails release asset preparation when a mac zip is missing', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'aionui-release-assets-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      expect(createResult.status).toBe(0);

      rmSync(resolve(artifactsDir, 'macos-build-arm64', 'Pavii.Ai-1.0.0-mac-arm64.zip'), { force: true });

      const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsDir, outputDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Missing macOS zip artifact');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('keeps the transactional-installer patches and NSIS contracts in place', () => {
    // The 2026-08-27 update failure destroyed a working install. These pins
    // guard the pieces that make that impossible again; the behavior itself
    // is proven by scripts/smoke-installer-rollback.js against compiled NSIS.
    const patcher = readFileSync(resolve(projectRoot, 'scripts/build-with-builder.js'), 'utf8');
    expect(patcher).toContain('event=foreign-install-skipped');
    expect(patcher).toContain('event=old-uninstaller-skipped reason=transactional-update');
    expect(patcher).toContain('aionui_retry_uninstaller_write');
    expect(patcher).toContain('SetOverwrite try');

    const removeRegistry = readFileSync(
      resolve(projectRoot, 'resources/windows/installer-remove-registry.nsh'),
      'utf8'
    );
    expect(removeRegistry).toContain('atomic-silent-retry');
    expect(removeRegistry).toContain('deferredDelete=1');
    expect(removeRegistry).toContain('oldInstallIntact=1');
    // The atomic-failure path must never clear the registry of the intact
    // old install (that is what orphaned it from "Installed apps").
    expect(removeRegistry).not.toContain(
      'AIONUI_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"\n      !insertmacro AIONUI_FAIL_REPORTABLE ${AIONUI_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${AIONUI_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed'
    );

    const errorsSentry = readFileSync(resolve(projectRoot, 'resources/windows/installer-errors-sentry.nsh'), 'utf8');
    expect(errorsSentry).toContain('AIONUI_ROLLBACK_OLD_SNAPSHOT');
    // Every fatal path funnels through FAIL_UX, which must roll back first.
    expect(errorsSentry).toMatch(/AIONUI_FAIL_UX[\s\S]{0,200}AIONUI_ROLLBACK_OLD_SNAPSHOT/);

    const updateVerify = readFileSync(resolve(projectRoot, 'resources/windows/installer-update-verify.nsh'), 'utf8');
    expect(updateVerify).toContain('snapshot-delete');

    const queryLockers = readFileSync(resolve(projectRoot, 'resources/windows/support/query-lockers.ps1'), 'utf8');
    expect(queryLockers).toContain("'Uninstall PaviiAi.exe'");
    expect(queryLockers).toContain('$RuntimeKey');
  });
});
