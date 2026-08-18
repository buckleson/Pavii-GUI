import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const buildScript = readFileSync('scripts/build-with-builder.js', 'utf8');

describe('Windows fast build scripts', () => {
  it('provides an x64 fast installer build that lowers compression but keeps exe branding', () => {
    const script = packageJson.scripts['build-win:x64:fast'];

    expect(script).toBeTypeOf('string');
    expect(script).toContain('ELECTRON_BUILDER_COMPRESSION_LEVEL=1');
    expect(script).toContain('node scripts/build-with-builder.js x64 --win --x64');
    // Skipping rcedit leaves Electron's stock ProductName/FileDescription and
    // icon on PaviiAi.exe — the OS would identify the app as "Electron".
    expect(script).not.toContain('--config.win.signAndEditExecutable=false');
  });

  it('warns that the rcedit-skipping fallback build is not shippable', () => {
    expect(buildScript).toContain('--config.win.signAndEditExecutable=false');
    expect(buildScript).toMatch(/WARNING: the retried exe keeps Electron stock version info\/icon/);
  });

  it('supports a temporary build-time auto-update version override', () => {
    expect(buildScript).toContain("DEBUG_AUTO_UPDATE_CURRENT_VERSION_ENV = 'AIONUI_DEBUG_AUTO_UPDATE_CURRENT_VERSION'");
    expect(buildScript).toContain('applyDebugAutoUpdateVersionOverride(packageJsonPath)');
    expect(buildScript).toContain('const originalPackageJsonText = fs.readFileSync(packageJsonPath,');
    expect(buildScript).toContain('packageJson.version = debugAutoUpdateCurrentVersion');
    expect(buildScript).toContain('fs.writeFileSync(packageJsonPath, originalPackageJsonText)');
    expect(buildScript).toMatch(/finally\s*{[\s\S]*restorePackageVersionOverride\(\);[\s\S]*}/);
  });
});
