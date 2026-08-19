import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBinaryPath } from '@/process/backend/binaryResolver';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

const isWindows = process.platform === 'win32';
const CURRENT_BINARY = isWindows ? 'paviicore.exe' : 'paviicore';
const LEGACY_BINARY = isWindows ? 'aioncore.exe' : 'aioncore';
const runtimeKey = `${process.platform}-${process.arch}`;

function setResourcesPath(resourcesPath: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: resourcesPath,
  });
}

function dirEntry(name: string, isDirectory = false): ReturnType<typeof readdirSync>[number] {
  return {
    name,
    isDirectory: () => isDirectory,
  } as unknown as ReturnType<typeof readdirSync>[number];
}

/** Make only the listed paths exist; everything else is absent. */
function onlyTheseExist(paths: string[]): void {
  vi.mocked(existsSync).mockImplementation((path) => paths.includes(String(path)));
}

describe('resolveBinaryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readdirSync).mockReturnValue([] as ReturnType<typeof readdirSync>);
  });

  afterEach(() => {
    setResourcesPath(originalResourcesPath);
  });

  it('resolves the bundled engine under the current name', () => {
    const resourcesPath = '/app/resources';
    const expected = join(resourcesPath, 'bundled-paviicore', runtimeKey, CURRENT_BINARY);

    setResourcesPath(resourcesPath);
    onlyTheseExist([expected]);

    expect(resolveBinaryPath()).toBe(expected);
    expect(execSync).not.toHaveBeenCalled();
  });

  // A bundle downloaded from the upstream iOfficeAI/AionCore release still
  // contains `aioncore`. Dropping this fallback would reject a valid bundle.
  it('falls back to the legacy bundled name when only that is present', () => {
    const resourcesPath = '/app/resources';
    const legacy = join(resourcesPath, 'bundled-paviicore', runtimeKey, LEGACY_BINARY);

    setResourcesPath(resourcesPath);
    onlyTheseExist([legacy]);

    expect(resolveBinaryPath()).toBe(legacy);
  });

  it('prefers the current name when a bundle holds both', () => {
    const resourcesPath = '/app/resources';
    const current = join(resourcesPath, 'bundled-paviicore', runtimeKey, CURRENT_BINARY);
    const legacy = join(resourcesPath, 'bundled-paviicore', runtimeKey, LEGACY_BINARY);

    setResourcesPath(resourcesPath);
    onlyTheseExist([current, legacy]);

    expect(resolveBinaryPath()).toBe(current);
  });

  it('falls back to the repo-local bundle in unpackaged runs', () => {
    const repoBundled = join(process.cwd(), 'resources', 'bundled-paviicore', runtimeKey, CURRENT_BINARY);

    setResourcesPath(undefined);
    onlyTheseExist([repoBundled]);

    expect(resolveBinaryPath()).toBe(repoBundled);
  });

  it('resolves from PATH when nothing is bundled', () => {
    const onPath = isWindows ? 'C:\\tools\\paviicore.exe' : '/usr/local/bin/paviicore';

    setResourcesPath(undefined);
    onlyTheseExist([onPath]);
    vi.mocked(execSync).mockReturnValue(`${onPath}\n` as unknown as Buffer);

    expect(resolveBinaryPath()).toBe(onPath);
    expect(execSync).toHaveBeenCalledWith(
      isWindows ? 'where paviicore' : 'which paviicore',
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  // `where`/`which` exit non-zero for a missing name, so the lookup for the
  // current name throwing must not stop the legacy lookup from running.
  it('resolves the legacy name from PATH after the current name misses', () => {
    const onPath = isWindows ? 'C:\\tools\\aioncore.exe' : '/usr/local/bin/aioncore';

    setResourcesPath(undefined);
    onlyTheseExist([onPath]);
    vi.mocked(execSync).mockImplementation((command) => {
      if (String(command).includes('paviicore')) throw new Error('not found on PATH');
      return `${onPath}\n` as unknown as Buffer;
    });

    expect(resolveBinaryPath()).toBe(onPath);
    expect(execSync).toHaveBeenCalledTimes(2);
  });

  it('attaches bundled path diagnostics when neither name can be resolved', () => {
    const resourcesPath = '/app/resources';
    const bundledDir = join(resourcesPath, 'bundled-paviicore');
    const runtimeDir = join(bundledDir, runtimeKey);
    const checkedBundledPath = join(runtimeDir, CURRENT_BINARY);

    setResourcesPath(resourcesPath);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockImplementation((path) => {
      if (path === resourcesPath) return [dirEntry('bundled-paviicore', true)];
      if (path === runtimeDir) return [dirEntry('manifest.json')];
      return [] as ReturnType<typeof readdirSync>;
    });
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found on PATH');
    });

    expect(() => resolveBinaryPath()).toThrow('Cannot find "paviicore" binary');

    try {
      resolveBinaryPath();
    } catch (error) {
      expect(error).toMatchObject({
        name: 'BackendBinaryResolveError',
        diagnostics: expect.objectContaining({
          resourcesPath,
          runtimeKey,
          binaryName: CURRENT_BINARY,
          // The canonical path, not the legacy candidate checked after it.
          checkedBundledPath,
          bundledDirExists: false,
          runtimeDirExists: false,
          resourcesDirEntries: ['bundled-paviicore/'],
          runtimeDirEntries: ['manifest.json'],
          pathLookupError: expect.stringContaining('not found on PATH'),
        }),
      });
    }
  });
});
