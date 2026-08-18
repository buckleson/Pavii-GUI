/**
 * Report GitHub release download counts to PostHog.
 *
 * Reads the public download_count GitHub already tracks per release asset and
 * forwards it as analytics events. This adds NO telemetry to the app itself —
 * it only mirrors counters GitHub exposes publicly.
 *
 * Usage: node scripts/track-downloads.mjs [--dry-run]
 *   env: GITHUB_REPOSITORY, GH_TOKEN (optional, for rate limits),
 *        POSTHOG_KEY, POSTHOG_HOST (default EU cloud), STATE_FILE
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const repo = process.env.GITHUB_REPOSITORY || 'buckleson/Pavii-GUI';
const posthogHost = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';
const posthogKey = process.env.POSTHOG_KEY || '';
const stateFile = process.env.STATE_FILE || '.download-counts.json';
const dryRun = process.argv.includes('--dry-run');

/** Derive platform/arch/package type from an electron-builder artifact name. */
export function classifyAsset(name) {
  const lower = name.toLowerCase();
  const platform = /(-win-|windows|\.exe$)/.test(lower)
    ? 'windows'
    : /(-mac-|macos|\.dmg$)/.test(lower)
      ? 'macos'
      : /(-linux-|\.deb$|\.appimage$|\.rpm$)/.test(lower)
        ? 'linux'
        : 'unknown';
  const arch = /arm64|aarch64/.test(lower) ? 'arm64' : /x64|x86_64|amd64/.test(lower) ? 'x64' : 'unknown';
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  const packageType = ['exe', 'dmg', 'deb', 'appimage', 'zip', 'rpm', 'msi'].includes(ext) ? ext : 'other';
  return { platform, arch, packageType };
}

async function fetchReleases() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'pavii-download-tracker' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function capture(events) {
  if (dryRun || !posthogKey) {
    console.log(`[dry-run] would send ${events.length} event(s)`);
    console.log(JSON.stringify(events.slice(0, 3), null, 2));
    return;
  }
  const res = await fetch(`${posthogHost}/batch/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: posthogKey, batch: events }),
  });
  if (!res.ok) throw new Error(`PostHog ${res.status}: ${await res.text()}`);
  console.log(`sent ${events.length} event(s) to PostHog`);
}

async function main() {
  const releases = await fetchReleases();
  const previous = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf-8')) : {};
  const current = {};
  const events = [];
  const timestamp = new Date().toISOString();
  let total = 0;

  for (const release of releases) {
    if (release.draft) continue;
    for (const asset of release.assets ?? []) {
      const key = `${release.tag_name}/${asset.name}`;
      const count = asset.download_count ?? 0;
      current[key] = count;
      total += count;
      const delta = key in previous ? count - previous[key] : null;
      const { platform, arch, packageType } = classifyAsset(asset.name);
      events.push({
        event: 'github_asset_downloads',
        // Stable id per asset: this is a repo metric, not a person.
        distinct_id: `github:${repo}:${key}`,
        timestamp,
        properties: {
          $process_person_profile: false,
          repository: repo,
          release_tag: release.tag_name,
          asset_name: asset.name,
          platform,
          architecture: arch,
          package_type: packageType,
          download_count: count,
          download_delta: delta,
          prerelease: Boolean(release.prerelease),
          source: 'github_releases',
        },
      });
    }
  }

  events.push({
    event: 'github_downloads_total',
    distinct_id: `github:${repo}`,
    timestamp,
    properties: {
      $process_person_profile: false,
      repository: repo,
      download_count: total,
      asset_count: Object.keys(current).length,
      release_count: releases.filter((r) => !r.draft).length,
      source: 'github_releases',
    },
  });

  console.log(`repo ${repo}: ${Object.keys(current).length} assets, ${total} total downloads`);
  await capture(events);
  if (!dryRun) writeFileSync(stateFile, JSON.stringify(current, null, 2));
}

// Run when invoked directly (always true for this CLI entry point).
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
