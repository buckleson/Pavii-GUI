/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the recommended tools status check: which launcher file
 * marks each tool installed on Windows and POSIX, and the reported version.
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock } = vi.hoisted(() => ({ existsSyncMock: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: existsSyncMock, default: { ...actual, existsSync: existsSyncMock } };
});

vi.mock('@pavii/web-host', () => ({
  getManagedToolsDir: (dataDir: string) => path.join(dataDir, 'managed-tools'),
  getManagedToolsPathEntries: (dataDir: string) => [
    path.join(dataDir, 'managed-tools'),
    path.join(dataDir, 'managed-tools', 'bin'),
  ],
}));

const DATA_DIR = path.resolve('/data/pavii');
vi.mock('@process/utils/utils', () => ({ getDataPath: () => DATA_DIR }));

import { getRecommendedToolStatus } from '@process/agentCli/recommendedTools/status';

const TOOLS_DIR = path.join(DATA_DIR, 'managed-tools');
const UV_BIN = path.join(TOOLS_DIR, 'uv-bin');
const originalPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

let existing = new Set<string>();
const installedIds = () =>
  getRecommendedToolStatus()
    .filter((status) => status.installed)
    .map((status) => status.id);

beforeEach(() => {
  vi.clearAllMocks();
  existing = new Set<string>();
  existsSyncMock.mockImplementation((file: string) => existing.has(String(file)));
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('getRecommendedToolStatus on Windows', () => {
  beforeEach(() => setPlatform('win32'));

  it('reports every tool not installed when no launcher exists', () => {
    expect(getRecommendedToolStatus()).toEqual([
      { id: 'trail', installed: false },
      { id: 'headroom', installed: false },
      { id: 'graphify', installed: false },
      { id: 'reach', installed: false },
    ]);
  });

  it('detects trail.cmd in any npm bin folder', () => {
    existing.add(path.join(TOOLS_DIR, 'bin', 'trail.cmd'));
    expect(installedIds()).toEqual(['trail']);
  });

  it('does not accept a POSIX trail shim on Windows', () => {
    existing.add(path.join(TOOLS_DIR, 'trail'));
    expect(installedIds()).toEqual([]);
  });

  it('detects headroom.exe and graphify-mcp.exe in the uv bin folder', () => {
    existing.add(path.join(UV_BIN, 'headroom.exe'));
    existing.add(path.join(UV_BIN, 'graphify-mcp.exe'));
    expect(installedIds()).toEqual(['headroom', 'graphify']);
  });

  it('detects agent-reach.exe in the uv bin folder', () => {
    existing.add(path.join(UV_BIN, 'agent-reach.exe'));
    expect(installedIds()).toEqual(['reach']);
  });

  it('does not count graphify as installed from graphify.exe alone', () => {
    existing.add(path.join(UV_BIN, 'graphify.exe'));
    expect(installedIds()).toEqual([]);
  });
});

describe('getRecommendedToolStatus on POSIX', () => {
  beforeEach(() => setPlatform('linux'));

  it('detects extension-less launchers', () => {
    existing.add(path.join(TOOLS_DIR, 'trail'));
    existing.add(path.join(UV_BIN, 'headroom'));
    existing.add(path.join(UV_BIN, 'graphify-mcp'));
    existing.add(path.join(UV_BIN, 'agent-reach'));
    expect(installedIds()).toEqual(['trail', 'headroom', 'graphify', 'reach']);
  });

  it('does not accept a Windows .exe launcher', () => {
    existing.add(path.join(UV_BIN, 'headroom.exe'));
    expect(installedIds()).toEqual([]);
  });
});

describe('getRecommendedToolStatus version', () => {
  beforeEach(() => setPlatform('linux'));

  it('reports the pinned version for an installed tool', () => {
    existing.add(path.join(UV_BIN, 'headroom'));
    expect(getRecommendedToolStatus()[1]).toEqual({ id: 'headroom', installed: true, version: '0.41.0' });
  });

  it('omits the version for a tool that is not installed', () => {
    expect(getRecommendedToolStatus()[0]).not.toHaveProperty('version');
  });
});
