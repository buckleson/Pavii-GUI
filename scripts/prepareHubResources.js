/**
 * prepareHubResources.js
 *
 * Downloads the AionHub index.json and all extension zip packages
 * into resources/hub/ so they are bundled with the app as local fallback.
 *
 * Called during the build pipeline before electron-builder runs.
 *
 * Environment variables:
 *   AIONUI_HUB_TAG    - Git tag to fetch from (default: 'dist-latest')
 *   AIONUI_HUB_SKIP   - Set to '1' to skip hub resource preparation
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { readJsonFile } = require('../packages/shared-scripts/src/read-json-file.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HUB_DIR = path.join(PROJECT_ROOT, 'resources', 'hub');

const DEFAULT_TAG = 'dist-latest';
const BASE_URLS = [
  `https://raw.githubusercontent.com/iOfficeAI/AionHub/${process.env.AIONUI_HUB_TAG || DEFAULT_TAG}/`,
  `https://cdn.jsdelivr.net/gh/iOfficeAI/AionHub@${process.env.AIONUI_HUB_TAG || DEFAULT_TAG}/`,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Download a URL to a local file path. Tries each base URL in order.
 * Returns the base URL that succeeded.
 */
async function downloadFile(relativePath, destPath) {
  for (const base of BASE_URLS) {
    const url = new URL(relativePath, base).toString();
    try {
      await downloadUrl(url, destPath);
      return url;
    } catch (error) {
      console.warn(`  [hub] Failed from ${url}: ${error.message}`);
    }
  }
  throw new Error(`Failed to download ${relativePath} from all mirrors`);
}

function downloadUrl(url, destPath) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const get = url.startsWith('https') ? https.get : require('http').get;
      get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      }).on('error', reject);
    };

    follow(url);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Trust-on-first-use pin for the hub bundle.
 *
 * Everything under resources/hub/ ships inside the installer as
 * `extraResources`, fetched at build time from a repository we do not control,
 * behind a mutable tag. Whatever sits there when a release builds is what users
 * install.
 *
 * The catalog's own `dist.integrity` field cannot be used for this: it is typed
 * as a SHA-512 SRI hash, carries `sha256-<hex>` values, matches none of the
 * seven zips it describes, and nothing in the app reads it. So we pin against
 * hashes we compute ourselves and commit.
 *
 * First run writes resources/hub/hub-lock.json. Every later build compares
 * against it and fails on drift, which turns a silent upstream content change
 * into a build error someone has to look at. Refresh deliberately with
 * AIONUI_HUB_RELOCK=1 and review the diff.
 */
const HUB_LOCK = path.join(PROJECT_ROOT, 'resources', 'hub-lock.json');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readHubLock() {
  if (process.env.AIONUI_HUB_RELOCK === '1' || !fs.existsSync(HUB_LOCK)) return null;
  try {
    return readJsonFile(HUB_LOCK);
  } catch {
    return null;
  }
}

function assertMatchesLock(lock, entries, indexSha256) {
  if (!lock) return;

  const problems = [];
  if (lock.indexSha256 && lock.indexSha256 !== indexSha256) {
    problems.push(`index.json changed
    locked ${lock.indexSha256}
    actual ${indexSha256}`);
  }

  const locked = lock.extensions || {};
  for (const entry of entries) {
    const want = locked[entry.name];
    if (!want) {
      problems.push(`${entry.name} is not in the lock file (new extension appeared upstream)`);
    } else if (want !== entry.sha256) {
      problems.push(`${entry.name} changed
    locked ${want}
    actual ${entry.sha256}`);
    }
  }
  for (const name of Object.keys(locked)) {
    if (!entries.some((e) => e.name === name)) {
      problems.push(`${name} is in the lock file but was not published (extension removed upstream)`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        'Hub bundle drifted from resources/hub-lock.json:',
        ...problems.map((p) => `  - ${p}`),
        '',
        'This code ships inside the installer. Review the change, then re-pin with',
        '  AIONUI_HUB_RELOCK=1 node scripts/prepareHubResources.js',
      ].join('\n')
    );
  }
}

async function prepareHubResources() {
  if (process.env.AIONUI_HUB_SKIP === '1') {
    console.log('[hub] Skipping hub resource preparation (AIONUI_HUB_SKIP=1)');
    return { skipped: true };
  }

  const tag = process.env.AIONUI_HUB_TAG || DEFAULT_TAG;
  console.log(`[hub] Preparing hub resources from tag: ${tag}`);

  // Clean and create target directory
  if (fs.existsSync(HUB_DIR)) {
    fs.rmSync(HUB_DIR, { recursive: true, force: true });
  }
  ensureDir(HUB_DIR);

  // Step 1: Download index.json
  const indexPath = path.join(HUB_DIR, 'index.json');
  console.log('[hub] Downloading index.json...');
  const indexUrl = await downloadFile('index.json', indexPath);
  console.log(`[hub] index.json downloaded from ${indexUrl}`);

  // Step 2: Parse index and download all extension zips
  const index = readJsonFile(indexPath);
  const extensions = index.extensions || {};
  const names = Object.keys(extensions);

  console.log(`[hub] Found ${names.length} extensions to bundle`);

  const results = [];
  for (const name of names) {
    const ext = extensions[name];
    const tarball = ext.dist?.tarball;
    if (!tarball) {
      console.warn(`[hub] Skipping ${name}: no dist.tarball`);
      continue;
    }

    const zipPath = path.join(HUB_DIR, path.basename(tarball));
    const url = await downloadFile(tarball, zipPath);
    const sha256 = sha256File(zipPath);
    const size = fs.statSync(zipPath).size;
    console.log(`[hub] ${name} -> ${path.basename(tarball)} (${(size / 1024).toFixed(1)} KB)`);
    results.push({ name, file: path.basename(tarball), size, url, sha256 });
  }

  // Step 3: Write manifest for debugging/verification
  // The index hash makes a moved tag auditable after the fact: two builds of
  // the same tag that produced different catalogs will differ here.
  const indexSha256 = crypto.createHash('sha256').update(fs.readFileSync(indexPath)).digest('hex');
  const manifest = {
    tag,
    generatedAt: new Date().toISOString(),
    indexUrl,
    indexSha256,
    extensions: results,
  };
  fs.writeFileSync(path.join(HUB_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const lock = readHubLock();
  assertMatchesLock(lock, results, indexSha256);
  if (!lock) {
    const pinned = {
      tag,
      indexSha256,
      extensions: Object.fromEntries(results.map((r) => [r.name, r.sha256])),
    };
    fs.writeFileSync(HUB_LOCK, `${JSON.stringify(pinned, null, 2)}\n`);
    console.log(`[hub] Wrote resources/hub-lock.json pinning ${results.length} extensions -- commit this file`);
  } else {
    console.log('[hub] Bundle matches resources/hub-lock.json');
  }

  console.log(`[hub] Done: ${results.length}/${names.length} extensions bundled in resources/hub/`);
  return { skipped: false, count: results.length, total: names.length };
}

// Support both direct execution and require() from build-with-builder.js
if (require.main === module) {
  prepareHubResources().catch((err) => {
    console.error('[hub] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { prepareHubResources };
