/**
 * Resolve the AionCore release tag to download for packaging.
 *
 * Order:
 *   1. AIONUI_BACKEND_VERSION env (ad-hoc override, e.g. CI dispatch input)
 *   2. "aioncoreVersion" field in repo-root package.json (the pin)
 *   3. 'latest' (GitHub API releases/latest; non-reproducible fallback)
 *
 * Keep this file tiny and dependency-free — it's required from both
 * scripts/preparePaviicore.js and scripts/pack-web-cli.js before
 * any project-level install has necessarily completed.
 */

const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('../packages/shared-scripts/src/read-json-file.js');

function resolvePaviicoreVersion(projectRoot) {
  const envOverride = process.env.AIONUI_BACKEND_VERSION;
  if (envOverride && envOverride.trim()) {
    return envOverride.trim();
  }

  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = readJsonFile(pkgPath);
    if (pkg && typeof pkg.aioncoreVersion === 'string' && pkg.aioncoreVersion.trim()) {
      return pkg.aioncoreVersion.trim();
    }
  } catch {
    // fall through
  }

  return 'latest';
}

module.exports = { resolvePaviicoreVersion };
