/**
 * Resolve the engine binary path.
 *
 * Search order:
 *  1. Bundled with app (production)
 *  2. System PATH
 *
 * Two names are accepted. Engines built from the vendored source are named
 * `paviicore`; a bundle downloaded from the upstream `iOfficeAI/AionCore`
 * release (which happens for a platform nobody built locally) still contains
 * `aioncore`. Both are the same program, so the legacy name is a fallback
 * rather than an error -- do not remove it without also renaming on extract.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const BINARY_NAME = 'paviicore';
/** Name used by engines downloaded from the upstream release. */
const LEGACY_BINARY_NAME = 'aioncore';
/** Resources subdirectory the engine ships in; must match electron-builder.yml. */
const BUNDLED_DIR_NAME = 'bundled-paviicore';
const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

type BackendBinaryResolveDiagnostics = {
  resourcesPath?: string;
  runtimeKey: string;
  binaryName: string;
  checkedBundledPath?: string;
  bundledDirExists?: boolean;
  runtimeDirExists?: boolean;
  resourcesDirEntries?: string[];
  runtimeDirEntries?: string[];
  pathLookupCommand: string;
  pathLookupResult?: string;
  pathLookupError?: string;
};

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function withExecutableExtension(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function getBinaryName(): string {
  return withExecutableExtension(BINARY_NAME);
}

/** Candidate filenames, current name first. */
function getBinaryNames(): string[] {
  return [withExecutableExtension(BINARY_NAME), withExecutableExtension(LEGACY_BINARY_NAME)];
}

function pathLookupCommand(name: string): string {
  return process.platform === 'win32' ? `where ${name}` : `which ${name}`;
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function listDirEntries(dirPath: string): string[] | undefined {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function trimLookupText(text: string): string {
  return text.trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

/**
 * Resolve the engine binary path.
 * Returns the absolute path to the binary, or throws if not found.
 */
export function resolveBinaryPath(): string {
  const runtimeKey = getRuntimeKey();
  const binaryName = getBinaryName();
  const diagnostics: BackendBinaryResolveDiagnostics = {
    runtimeKey,
    binaryName,
    pathLookupCommand: pathLookupCommand(BINARY_NAME),
  };

  for (const candidateName of getBinaryNames()) {
    const bundled = bundledPath(runtimeKey, candidateName, diagnostics);
    if (bundled) return bundled;
  }

  // Dev fallback: unpackaged runs launch from the repo root, where
  // `node scripts/preparePaviicore.js` places the engine (same layout webui uses).
  for (const candidateName of getBinaryNames()) {
    const repoBundled = join(process.cwd(), 'resources', BUNDLED_DIR_NAME, runtimeKey, candidateName);
    if (existsSync(repoBundled)) return repoBundled;
  }

  const fromPath = resolveFromSystemPATH(diagnostics);
  if (fromPath) return fromPath;

  throw new BackendBinaryResolveError(
    `Cannot find "${BINARY_NAME}" binary. Checked bundled location and system PATH.`,
    diagnostics
  );
}

/**
 * Check bundled binary in resources directory.
 * Layout: bundled-paviicore/{platform}-{arch}/paviicore[.exe]
 */
function bundledPath(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  diagnostics.resourcesPath = resourcesPath;

  const bundledDir = join(resourcesPath, BUNDLED_DIR_NAME);
  const runtimeDir = join(bundledDir, runtimeKey);
  const candidate = join(runtimeDir, binaryName);
  // First candidate only: this is called once per accepted name, and a failure
  // report should point at the canonical path rather than the legacy fallback.
  diagnostics.checkedBundledPath ??= candidate;
  diagnostics.bundledDirExists = existsSync(bundledDir);
  diagnostics.runtimeDirExists = existsSync(runtimeDir);
  diagnostics.resourcesDirEntries = listDirEntries(resourcesPath);
  diagnostics.runtimeDirEntries = listDirEntries(runtimeDir);

  if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Try to find the binary on the system PATH, current name first.
 *
 * Each name gets its own lookup rather than one `where a b` / `which a b` call:
 * both tools exit non-zero when *any* argument is missing, so a combined call
 * would throw away a match found for the other name.
 */
function resolveFromSystemPATH(diagnostics: BackendBinaryResolveDiagnostics): string | null {
  const errors: string[] = [];
  // Base names, no extension: `where` resolves the executable suffix itself
  // through PATHEXT, and `which` never wants one.
  for (const candidateName of [BINARY_NAME, LEGACY_BINARY_NAME]) {
    const command = pathLookupCommand(candidateName);
    diagnostics.pathLookupCommand = command;
    try {
      const result = execSync(command, { encoding: 'utf-8', timeout: 5000 }).trim();
      diagnostics.pathLookupResult = trimLookupText(result);
      const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
      if (firstMatch && existsSync(firstMatch.trim())) return firstMatch.trim();
    } catch (error) {
      errors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length > 0) diagnostics.pathLookupError = trimLookupText(errors.join('\n'));
  return null;
}

export type { BackendBinaryResolveDiagnostics };
