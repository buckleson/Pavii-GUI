#!/usr/bin/env node

/**
 * Stage the OpenCode CLI into `resources/bundled-opencode/<runtimeKey>/` so the
 * installer ships it.
 *
 * Why this exists as its own bundle rather than an engine managed-resource:
 * the engine deliberately stopped bundling agent CLIs
 * (`cmd_prepare_managed_resources.rs` emits `clis: []`) and resolves agents
 * purely by PATH lookup (`aionui-runtime/src/resolver.rs` → `which::which`).
 * So the cheapest correct way to guarantee OpenCode on a fresh machine is to
 * ship the binary ourselves and put its directory on PATH before the engine
 * spawns — no engine change, no contract change.
 *
 * Product requirement: every install ships OpenCode and defaults to it. The
 * previous mechanism (npm install on first launch) could not deliver that — it
 * needed network, ran after the engine had already probed for agents, and
 * failed silently.
 *
 * Version is pinned here. Bumping OpenCode = change OPENCODE_VERSION, rebuild,
 * ship a release. There is no auto-update of the bundled copy by design.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OPENCODE_VERSION = '1.18.21';
const REGISTRY = 'https://registry.npmjs.org';

/**
 * Electron runtime key -> npm platform package.
 *
 * npm spells Windows `windows`, Node spells it `win32`; darwin and linux match.
 * Only the platforms we actually build installers for are listed — an
 * unsupported arch falls back to the runtime npm install in ensureOpencode.ts.
 */
const PACKAGE_BY_RUNTIME_KEY = {
  'win32-x64': 'opencode-windows-x64',
  'win32-arm64': 'opencode-windows-arm64',
  'darwin-x64': 'opencode-darwin-x64',
  'darwin-arm64': 'opencode-darwin-arm64',
  'linux-x64': 'opencode-linux-x64',
  'linux-arm64': 'opencode-linux-arm64',
};

const BUNDLE_ROOT_NAME = 'bundled-opencode';

function runtimeKeyFor(platform, arch) {
  return `${platform}-${arch}`;
}

function binaryNameFor(platform) {
  return platform === 'win32' ? 'opencode.exe' : 'opencode';
}

function bundleDirFor(projectRoot, runtimeKey) {
  return path.join(projectRoot, 'resources', BUNDLE_ROOT_NAME, runtimeKey);
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Write JSON through Node with an explicit LF so no BOM or CRLF can creep in. */
function writeManifest(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function downloadFile(url, outputPath) {
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 300000 });
    return;
  }
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', outputPath, url], { timeout: 300000 });
  } catch {
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 300000 });
  }
}

/**
 * npm publishes `dist.integrity` as `sha512-<base64>`. Verifying it is the only
 * thing standing between a corrupted or substituted download and a binary we
 * ship to every user, so a mismatch is fatal rather than a warning.
 */
function assertIntegrity(filePath, integrity) {
  const [algorithm, expected] = String(integrity).split('-');
  if (algorithm !== 'sha512' || !expected) {
    throw new Error(`unsupported integrity format from the registry: ${integrity}`);
  }
  const actual = crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
  if (actual !== expected) {
    throw new Error(`integrity mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`);
  }
}

function readRegistryMetadata(packageName, version) {
  const url = `${REGISTRY}/${packageName}/${version}`;
  const tmp = path.join(os.tmpdir(), `opencode-meta-${process.pid}.json`);
  try {
    downloadFile(url, tmp);
    const parsed = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    if (!parsed?.dist?.tarball) throw new Error(`registry metadata for ${packageName}@${version} has no tarball`);
    return { tarball: parsed.dist.tarball, integrity: parsed.dist.integrity };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Extract a gzipped npm tarball.
 *
 * On Windows this must use the in-box bsdtar at System32 rather than whatever
 * `tar` PATH happens to resolve to: if Git Bash is installed its MSYS tar wins,
 * and MSYS reads the `D:` in an absolute path as an rsh host, failing with
 * "Cannot connect to D: resolve failed". bsdtar has shipped in Windows since
 * 10 1803, so the explicit path is safe.
 */
function extractTarball(archivePath, outputDir, platform) {
  if (platform === 'win32') {
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(systemTar)) {
      execFileSync(systemTar, ['-xzf', archivePath, '-C', outputDir]);
      return;
    }
    // MSYS/GNU tar fallback: --force-local stops it treating `D:` as a host.
    execFileSync('tar', ['--force-local', '-xzf', archivePath, '-C', outputDir]);
    return;
  }
  execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
}

/** Locate the extracted binary. The tarball layout is `package/bin/opencode[.exe]`. */
function findExtractedBinary(extractRoot, binaryName) {
  const direct = path.join(extractRoot, 'package', 'bin', binaryName);
  if (fs.existsSync(direct)) return direct;

  const stack = [extractRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === binaryName) return full;
    }
  }
  return null;
}

/**
 * Keep only the runtime key we are building for.
 *
 * electron-builder copies the whole `resources/bundled-opencode` directory into
 * the app, so a stale sibling from an earlier build for another arch would ship
 * inside every installer — ~170 MB of a binary that machine can never run. The
 * runtime only ever looks in its own `<platform>-<arch>` subdirectory, so
 * anything else is pure payload. Pruning costs a re-download when a developer
 * alternates arches locally; CI builds one arch per runner and never notices.
 */
function pruneOtherRuntimeKeys(projectRoot, keepRuntimeKey) {
  const root = path.join(projectRoot, 'resources', BUNDLE_ROOT_NAME);
  if (!fs.existsSync(root)) return [];
  const pruned = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keepRuntimeKey) continue;
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
    pruned.push(entry.name);
  }
  if (pruned.length > 0) {
    console.log(`  OpenCode: pruned bundles not built for this target: ${pruned.join(', ')}`);
  }
  return pruned;
}

/**
 * Ensure `resources/bundled-opencode/<runtimeKey>/` holds the pinned OpenCode
 * binary. Idempotent: a manifest already pinning this version short-circuits,
 * so repeat builds do not re-download ~60 MB.
 */
function prepareOpencode(options = {}) {
  const projectRoot = options.projectRoot ?? path.resolve(__dirname, '..', '..', '..');
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const runtimeKey = runtimeKeyFor(platform, arch);

  const packageName = PACKAGE_BY_RUNTIME_KEY[runtimeKey];
  if (!packageName) {
    // Not fatal: ensureOpencode.ts still has the npm fallback for odd arches.
    console.warn(`  OpenCode: no published binary for ${runtimeKey}; skipping bundle (runtime npm install will apply)`);
    pruneOtherRuntimeKeys(projectRoot, runtimeKey);
    return { skipped: true, runtimeKey };
  }

  const targetDir = bundleDirFor(projectRoot, runtimeKey);
  const binaryName = binaryNameFor(platform);
  const binaryPath = path.join(targetDir, binaryName);
  const manifestPath = path.join(targetDir, 'manifest.json');

  if (fs.existsSync(binaryPath) && fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (existing.version === OPENCODE_VERSION && existing.runtimeKey === runtimeKey) {
        console.log(`  OpenCode ${OPENCODE_VERSION} already staged for ${runtimeKey}; skipping download`);
        pruneOtherRuntimeKeys(projectRoot, runtimeKey);
        return { skipped: true, runtimeKey, version: OPENCODE_VERSION, binaryPath };
      }
    } catch {
      // Unreadable manifest: fall through and re-stage.
    }
  }

  const { tarball, integrity } = readRegistryMetadata(packageName, OPENCODE_VERSION);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pavii-opencode-'));
  try {
    const archivePath = path.join(tempRoot, 'opencode.tgz');
    console.log(`  Downloading OpenCode ${OPENCODE_VERSION} for ${runtimeKey} from ${tarball}`);
    downloadFile(tarball, archivePath);
    if (integrity) assertIntegrity(archivePath, integrity);

    const extractRoot = path.join(tempRoot, 'extract');
    ensureDirectory(extractRoot);
    extractTarball(archivePath, extractRoot, platform);

    const extracted = findExtractedBinary(extractRoot, binaryName);
    if (!extracted) throw new Error(`${packageName} tarball did not contain ${binaryName}`);

    fs.rmSync(targetDir, { recursive: true, force: true });
    ensureDirectory(targetDir);
    fs.copyFileSync(extracted, binaryPath);
    if (platform !== 'win32') fs.chmodSync(binaryPath, 0o755);

    writeManifest(manifestPath, {
      name: 'opencode',
      version: OPENCODE_VERSION,
      runtimeKey,
      package: packageName,
      files: [binaryName],
    });

    pruneOtherRuntimeKeys(projectRoot, runtimeKey);

    const sizeMb = (fs.statSync(binaryPath).size / (1024 * 1024)).toFixed(1);
    console.log(`  OpenCode ${OPENCODE_VERSION} staged for ${runtimeKey} (${sizeMb} MB)`);
    return { skipped: false, runtimeKey, version: OPENCODE_VERSION, binaryPath };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  BUNDLE_ROOT_NAME,
  OPENCODE_VERSION,
  PACKAGE_BY_RUNTIME_KEY,
  binaryNameFor,
  bundleDirFor,
  prepareOpencode,
  pruneOtherRuntimeKeys,
  runtimeKeyFor,
};

if (require.main === module) {
  try {
    prepareOpencode({
      platform: process.env.PAVII_OPENCODE_PLATFORM || undefined,
      arch: process.env.PAVII_OPENCODE_ARCH || undefined,
    });
  } catch (error) {
    console.error(`prepare-opencode: ${error.message}`);
    process.exitCode = 1;
  }
}
