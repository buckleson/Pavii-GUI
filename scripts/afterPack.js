const { Arch } = require('builder-util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  normalizeArch,
  rebuildSingleModule,
  verifyModuleBinary,
  getModulesToRebuild,
} = require('./rebuildNativeModules');
const {
  verifyBundledPaviicoreResources,
} = require('../packages/shared-scripts/src/verify-bundled-paviicore-resources');

/**
 * Turn off the Electron escape hatches before the app is signed.
 *
 * `@electron/fuses` has been a devDependency all along but was never called, so
 * every shipped build kept `RunAsNode` enabled -- meaning
 * `ELECTRON_RUN_AS_NODE=1 PaviiAi.exe evil.js` runs arbitrary code under the
 * app's identity, and under its code signature once one exists. The inspector
 * and NODE_OPTIONS fuses are the same class of hole.
 *
 * Safe for this app specifically: helper processes go through
 * `utilityProcess.fork()` (ElectronPlatformServices.ts:46), which is an Electron
 * API and does not depend on the RunAsNode fuse, and nothing reads NODE_OPTIONS
 * at runtime.
 *
 * Two fuses are deliberately left alone, both for reasons established by
 * testing rather than assumed:
 *
 * `EnableNodeCliInspectArguments` stays ENABLED. Disabling it stops Playwright
 * launching the packaged app entirely -- `_electron.launch()` attaches over the
 * Node inspector, so every packaged e2e test times out at 60s. Bisected one
 * fuse at a time against tests/e2e/specs/app-launch.e2e.ts: with this one off
 * the suite fails, with it on and the other four hardened it passes in ~10s.
 * The app itself starts fine either way, so this is a testability trade, not a
 * functional one, and it is worth making: an attacker who can pass `--inspect`
 * to a local binary can already run code as that user, whereas
 * ELECTRON_RUN_AS_NODE turns the signed app itself into a script host. Keeping
 * the suite able to drive the real shipped artifact is its own security
 * property.
 *
 * `EnableEmbeddedAsarIntegrityValidation` stays disabled. It needs the asar
 * header hash embedded by the packager; flipping the fuse without that stops
 * the app launching at all. Enabling it is a separate change that has to be
 * verified by actually starting the packaged build.
 *
 * Must run in afterPack, not afterSign: mutating the binary after signing
 * invalidates the signature.
 */
async function hardenElectronFuses(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

  const productName = packager?.appInfo?.productFilename || 'Pavii.Ai';

  // `executableName` from electron-builder.yml ("PaviiAi"), NOT
  // appInfo.sanitizedName -- that is the kebab-case npm-style name
  // ("pavii-ai") and no such file is produced, so using it made this throw on
  // every Windows build.
  const executableName =
    packager?.platformSpecificBuildOptions?.executableName || packager?.executableName || productName;

  let electronBinary;
  if (electronPlatformName === 'darwin') {
    electronBinary = path.join(appOutDir, `${productName}.app`);
  } else if (electronPlatformName === 'win32') {
    electronBinary = path.join(appOutDir, `${executableName}.exe`);
  } else {
    electronBinary = path.join(appOutDir, executableName);
  }

  if (!fs.existsSync(electronBinary)) {
    // Fall back to whatever single top-level executable was produced, so a
    // future rename of executableName cannot silently disable hardening.
    const candidates = fs
      .readdirSync(appOutDir)
      .filter((f) => (electronPlatformName === 'win32' ? f.toLowerCase().endsWith('.exe') : !path.extname(f)))
      .filter((f) => !/^(elevate|squirrel)/i.test(f));
    if (candidates.length === 1) {
      electronBinary = path.join(appOutDir, candidates[0]);
      console.warn(`   ⚠️  Expected binary name not found; hardening ${candidates[0]} instead`);
    } else {
      throw new Error(
        `Cannot harden fuses: no Electron binary at ${electronBinary}, and ${candidates.length} candidates in ${appOutDir}`
      );
    }
  }

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log(
    `   ✓ Fuses hardened on ${path.basename(electronBinary)} (RunAsNode + NODE_OPTIONS off, cookie encryption + asar-only on)`
  );
}

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

function resolveResourcesDir(electronPlatformName, appOutDir, packager) {
  if (electronPlatformName !== 'darwin') return path.join(appOutDir, 'resources');

  const appName = packager?.appInfo?.productFilename || 'Pavii.Ai';
  return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
}

function verifyBundledResources(resourcesDir, electronPlatformName, targetArch) {
  const result = verifyBundledPaviicoreResources({
    resourcesDir,
    electronPlatformName,
    targetArch,
  });

  if (result.missing.length > 0) {
    console.error(`   Missing bundled resources: ${result.missing.join(', ')}`);
    throw new Error(`Packaged app is missing required bundled resource(s): ${result.missing.join(', ')}`);
  }

  console.log(`   ✓ Bundled resources verified for ${result.runtimeKey} (${result.checked.length} checks)`);
}

/**
 * Refuse to ship an installer whose bundled OpenCode is missing or mismatched.
 *
 * OpenCode is the default agent, and the engine only ever finds it via PATH, so
 * a silently absent binary produces exactly the bug this bundle exists to fix:
 * a fresh install defaulting to an agent that cannot run. A platform with no
 * published binary is allowed through — `prepare-opencode.js` skips those by
 * design and `ensureOpencode.ts` still has the npm fallback.
 */
function verifyBundledOpencode(resourcesDir, electronPlatformName, targetArch) {
  const {
    OPENCODE_VERSION,
    PACKAGE_BY_RUNTIME_KEY,
    binaryNameFor,
  } = require('../packages/shared-scripts/src/prepare-opencode.js');

  const platform = electronPlatformName === 'darwin' ? 'darwin' : electronPlatformName;
  const runtimeKey = `${platform}-${targetArch}`;
  if (!PACKAGE_BY_RUNTIME_KEY[runtimeKey]) {
    console.log(`   ℹ️  OpenCode: no published binary for ${runtimeKey}; bundle intentionally absent`);
    return;
  }

  const dir = path.join(resourcesDir, 'bundled-opencode', runtimeKey);
  const binary = path.join(dir, binaryNameFor(platform));
  const manifestPath = path.join(dir, 'manifest.json');

  if (!fs.existsSync(binary)) {
    throw new Error(`Packaged app is missing the bundled OpenCode binary for ${runtimeKey}: ${binary}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Packaged app is missing bundled-opencode/${runtimeKey}/manifest.json`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== OPENCODE_VERSION) {
    throw new Error(
      `Bundled OpenCode version mismatch for ${runtimeKey}: manifest says ${manifest.version}, expected ${OPENCODE_VERSION}`
    );
  }
  const sizeMb = (fs.statSync(binary).size / (1024 * 1024)).toFixed(1);
  console.log(`   ✓ Bundled OpenCode ${OPENCODE_VERSION} verified for ${runtimeKey} (${sizeMb} MB)`);
}

module.exports = async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);

  const isCrossCompile = buildArch !== targetArch;
  const forceRebuild = process.env.FORCE_NATIVE_REBUILD === 'true';
  const needsSameArchRebuild = electronPlatformName === 'win32'; // 只有 Windows 需要同架构重建以匹配 Electron ABI | Only Windows needs same-arch rebuild to match Electron ABI
  // Linux 使用预编译二进制，避免 GLIBC 版本依赖 | Linux uses prebuilt binaries which are GLIBC-independent

  const resourcesDir = resolveResourcesDir(electronPlatformName, appOutDir, packager);
  console.log(`   Checking resources directory: ${resourcesDir}`);
  if (fs.existsSync(resourcesDir)) {
    const resourcesContents = fs.readdirSync(resourcesDir);
    console.log(`   Contents: ${resourcesContents.join(', ')}`);

    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const unpackedContents = fs.readdirSync(unpackedDir);
      console.log(`   app.asar.unpacked contents: ${unpackedContents.join(', ')}`);

      const nodeModulesDir = path.join(unpackedDir, 'node_modules');
      if (fs.existsSync(nodeModulesDir)) {
        const modulesContents = fs.readdirSync(nodeModulesDir);
        console.log(`   node_modules contents: ${modulesContents.slice(0, 10).join(', ')}...`);
      } else {
        console.warn(`   ⚠️  node_modules not found in app.asar.unpacked`);
      }
    } else {
      console.warn(`   ⚠️  app.asar.unpacked not found`);
    }

    verifyBundledResources(resourcesDir, electronPlatformName, targetArch);
    verifyBundledOpencode(resourcesDir, electronPlatformName, targetArch);
  } else {
    throw new Error(`resources directory not found: ${resourcesDir}`);
  }

  // Before the rebuild short-circuit below, not after it: that `return` fires
  // for every same-architecture non-Windows build, which is exactly the macOS
  // and Linux release path. Hardening at the end of the function would silently
  // skip the platforms most likely to be attacked through it.
  await hardenElectronFuses(context);

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
    console.log(`   ✓ Same architecture, rebuild skipped (set FORCE_NATIVE_REBUILD=true to override)\n`);
    return;
  }

  // Note: Previously there was an optimization to skip macOS cross-compilation,
  // but this caused incorrect architecture binaries (arm64) to be included in x64 builds.
  // Now we always rebuild native modules for cross-compilation to ensure correctness.
  // The rebuild process uses prebuild-install first (fast), falling back to source compilation only when needed.

  if (isCrossCompile) {
    console.log(`   ⚠️  Cross-compilation detected (${buildArch} → ${targetArch}), will rebuild native modules`);
    if (electronPlatformName === 'darwin') {
      console.log(`   💡 Using prebuild-install for faster cross-architecture build`);
    }
  } else if (needsSameArchRebuild || forceRebuild) {
    console.log(`   ℹ️  Rebuilding native modules for platform requirements (force=${forceRebuild})`);
  }

  console.log(`\n🔧 Checking native modules (${electronPlatformName}-${targetArch})...`);
  console.log(`   appOutDir: ${appOutDir}`);

  const electronVersion =
    packager?.info?.electronVersion ??
    packager?.config?.electronVersion ??
    require('../package.json').devDependencies?.electron?.replace(/^\D*/, '');

  const nodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

  // Modules that need to be rebuilt for cross-compilation
  // Use platform-specific module list (Windows skips node-pty due to cross-compilation issues)
  const modulesToRebuild = getModulesToRebuild(electronPlatformName);
  console.log(`   Modules to rebuild: ${modulesToRebuild.join(', ')}`);

  // For cross-compilation, clean up build artifacts from the wrong architecture
  // This prevents node-gyp-build from loading incorrect binaries
  if (isCrossCompile) {
    console.log(`\n🧹 Cleaning up wrong-architecture build artifacts...`);
    for (const moduleName of modulesToRebuild) {
      const moduleRoot = path.join(nodeModulesDir, moduleName);
      if (!fs.existsSync(moduleRoot)) continue;

      // Remove build/ directory (contains wrong-arch compiled binaries)
      const buildDir = path.join(moduleRoot, 'build');
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/build/`);
      }

      // Remove bin/ directory (might contain wrong-arch binaries)
      const binDir = path.join(moduleRoot, 'bin');
      if (fs.existsSync(binDir)) {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/bin/`);
      }
    }

    // Also clean up architecture-specific packages that shouldn't be included
    // Remove packages for the opposite architecture of the target
    const wrongArchSuffix = targetArch === 'arm64' ? 'x64' : 'arm64';
    console.log(`\n🧹 Removing ${wrongArchSuffix}-specific optional dependencies (target: ${targetArch})...`);

    if (fs.existsSync(nodeModulesDir)) {
      const allModules = fs.readdirSync(nodeModulesDir);
      for (const module of allModules) {
        const modulePath = path.join(nodeModulesDir, module);

        // Handle scoped packages (e.g., @lydell, @napi-rs)
        if (module.startsWith('@') && fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          const scopedPackages = fs.readdirSync(modulePath);
          for (const pkg of scopedPackages) {
            if (pkg.includes(`-${wrongArchSuffix}`) || pkg.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
              const pkgPath = path.join(modulePath, pkg);
              if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                fs.rmSync(pkgPath, { recursive: true, force: true });
                console.log(`   ✓ Removed ${module}/${pkg}`);
              }
            }
          }
        }
        // Handle regular packages
        else if (
          module.includes(`-${wrongArchSuffix}`) ||
          module.includes(`-${electronPlatformName}-${wrongArchSuffix}`)
        ) {
          if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            fs.rmSync(modulePath, { recursive: true, force: true });
            console.log(`   ✓ Removed ${module}`);
          }
        }
      }
    }
  }

  const failedModules = [];

  for (const moduleName of modulesToRebuild) {
    const moduleRoot = path.join(nodeModulesDir, moduleName);

    if (!fs.existsSync(moduleRoot)) {
      console.warn(`   ⚠️  ${moduleName} not found, skipping`);
      continue;
    }

    console.log(`   ✓ Found ${moduleName}, rebuilding for ${targetArch}...`);

    // For Windows, prefer prebuild-install first (faster and more reliable in CI)
    // electron-rebuild can hang on "Searching dependency tree" in some CI environments
    // prebuild-install will fall back to electron-rebuild internally if no prebuilt binary exists
    const forceRebuildFromSource = false; // Always try prebuild-install first

    const success = rebuildSingleModule({
      moduleName,
      moduleRoot,
      platform: electronPlatformName,
      arch: targetArch,
      electronVersion,
      projectRoot: path.resolve(__dirname, '..'),
      buildArch: buildArch, // Pass build architecture for cross-compile detection
      forceRebuild: forceRebuildFromSource, // Always try prebuild-install first, fallback to rebuild
    });

    if (success) {
      console.log(`     ✓ Rebuild completed`);
    } else {
      console.error(`     ✗ Rebuild failed`);
      failedModules.push(moduleName);
      continue;
    }

    const verified = verifyModuleBinary(moduleRoot, moduleName);
    if (verified) {
      console.log(`     ✓ Binary verification passed`);
    } else {
      console.error(`     ✗ Binary verification failed`);
      failedModules.push(moduleName);
    }

    console.log(''); // Empty line between modules
  }

  if (failedModules.length > 0) {
    throw new Error(`Failed to rebuild modules for ${electronPlatformName}-${targetArch}: ${failedModules.join(', ')}`);
  }

  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);
};
