#!/usr/bin/env node
/**
 * Build the Pavii Engine (paviicore) from the vendored source and deploy it
 * into resources/bundled-paviicore/<platform>-<arch>/.
 *
 * This replaces the hand-typed build steps that produced two shipped
 * regressions:
 *
 *  - the shipped assistant manifest was rewritten by a PowerShell text cmdlet,
 *    which added a UTF-8 BOM and cp1252 mojibake; `cargo build` does not read
 *    the manifest, so nothing failed until users saw an empty catalog. Step 1
 *    below runs the test that does read it.
 *  - the bundle manifest was written through a shell redirect, which added a
 *    BOM; the build guard's JSON.parse threw, the throw was swallowed, and the
 *    upstream engine was downloaded over the rebranded one. Step 4 writes it
 *    through Node and proves it parses back.
 *
 * Usage:
 *   node scripts/build-paviicore.js              # host platform/arch
 *   node scripts/build-paviicore.js --arch=arm64
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readJsonFile, writeJsonFile } = require('../packages/shared-scripts/src/read-json-file.js');

const projectRoot = path.resolve(__dirname, '..');
const engineDir = path.join(projectRoot, 'the-remaa', 'AionCore');

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function engineVersion() {
  const cargoToml = fs.readFileSync(path.join(engineDir, 'Cargo.toml'), 'utf-8');
  const match = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml);
  if (!match) throw new Error('Could not read version from the-remaa/AionCore/Cargo.toml');
  return match[1];
}

function main(argv) {
  const archArg = argv.find((a) => a.startsWith('--arch='));
  const arch = archArg ? archArg.slice('--arch='.length) : process.arch;
  const platform = process.platform;
  const runtimeKey = `${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'paviicore.exe' : 'paviicore';

  if (!fs.existsSync(engineDir)) {
    throw new Error(`Engine source not found at ${engineDir}`);
  }

  // 1. Asset gate. The embedded builtin-assistant manifest degrades to an
  //    empty catalog at runtime rather than failing, so this test is the only
  //    place a corrupt manifest can be caught.
  run('cargo', ['test', '-p', 'aionui-assistant', 'builtin'], engineDir);

  // 2. Build.
  run('cargo', ['build', '--release', '--bin', 'paviicore'], engineDir);

  const builtBinary = path.join(engineDir, 'target', 'release', binaryName);
  if (!fs.existsSync(builtBinary)) {
    throw new Error(`Engine binary missing after build: ${builtBinary}`);
  }

  // 3. Deploy. managed-resources is materialized separately by running the
  //    engine; preserve whatever is already there.
  const targetDir = path.join(projectRoot, 'resources', 'bundled-paviicore', runtimeKey);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(builtBinary, path.join(targetDir, binaryName));
  console.log(`\nDeployed ${binaryName} (${fs.statSync(builtBinary).size} bytes) to ${runtimeKey}`);

  // Trees that predate the rename still carry resources/bundled-aioncore/.
  // Nothing reads it, but leaving both makes it unclear which engine is live.
  //
  // managed-resources is carried over rather than deleted: it holds the
  // materialized Node runtime and agent CLIs (hundreds of MB, fetched over the
  // network), its manifest addresses everything by relative path, so it
  // relocates cleanly -- and dropping it would silently cost a re-download.
  const staleDir = path.join(projectRoot, 'resources', 'bundled-aioncore');
  if (fs.existsSync(staleDir)) {
    const staleManaged = path.join(staleDir, runtimeKey, 'managed-resources');
    const targetManaged = path.join(targetDir, 'managed-resources');
    if (fs.existsSync(staleManaged) && !fs.existsSync(targetManaged)) {
      fs.renameSync(staleManaged, targetManaged);
      console.log(`Moved ${runtimeKey}/managed-resources over from the pre-rename bundle`);
    }
    fs.rmSync(staleDir, { recursive: true, force: true });
    console.log('Removed the stale resources/bundled-aioncore/ from before the rename');
  }

  // 4. Manifest, written through Node so it can never carry a BOM.
  const manifestPath = path.join(targetDir, 'manifest.json');
  writeJsonFile(manifestPath, {
    platform,
    arch,
    version: `v${engineVersion()}-pavii`,
    generatedAt: new Date().toISOString(),
    sourceType: 'local-source-build',
    source: { path: 'the-remaa/AionCore (node scripts/build-paviicore.js)' },
    files: [binaryName, 'managed-resources/'],
  });

  // 5. Prove the manifest reads back. The pin guard in prepare-paviicore.js
  //    depends on this parsing; when it did not, the build silently replaced
  //    this engine with the upstream download.
  const bytes = fs.readFileSync(manifestPath);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${manifestPath} was written with a UTF-8 BOM`);
  }
  const parsed = readJsonFile(manifestPath);
  if (parsed.sourceType !== 'local-source-build') {
    throw new Error(`${manifestPath} does not pin the local build`);
  }
  run('node', ['scripts/check-encoding.js', path.relative(projectRoot, manifestPath)], projectRoot);

  if (!fs.existsSync(path.join(targetDir, 'managed-resources'))) {
    console.warn(
      `\nWARNING: ${runtimeKey}/managed-resources is missing. Run the app once to materialize it before packaging.`
    );
  }

  console.log(`\nEngine ready: ${parsed.version} for ${runtimeKey}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`\nbuild-paviicore: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
