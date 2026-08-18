/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTunnelUrl, resolveCloudflaredBinary, getTunnelState, stopTunnel } from '@/process/services/tunnelService';

// Mock the same module tunnelService imports as '../utils/utils' so that
// getDataPath never touches Electron and points at a per-test temp dir.
const getDataPathMock = vi.fn<() => string>(() => '');
vi.mock('@/process/utils/utils', () => ({
  getDataPath: () => getDataPathMock(),
}));

const BINARY = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

describe('tunnelService', () => {
  describe('parseTunnelUrl', () => {
    it('extracts the trycloudflare URL from a multi-line log chunk', () => {
      const chunk = [
        '2026-08-18T10:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...',
        '2026-08-18T10:00:01Z INF Your quick Tunnel has been created! Visit it at:',
        '2026-08-18T10:00:01Z INF https://witty-narwhal-demo.trycloudflare.com',
        '2026-08-18T10:00:01Z INF Cannot determine default configuration path.',
      ].join('\n');
      expect(parseTunnelUrl(chunk)).toBe('https://witty-narwhal-demo.trycloudflare.com');
    });

    it('returns null when no tunnel URL is present', () => {
      expect(parseTunnelUrl('2026-08-18T10:00:00Z INF Starting tunnel connection registered')).toBeNull();
    });

    it('returns null for an empty chunk', () => {
      expect(parseTunnelUrl('')).toBeNull();
    });

    it('picks the URL when embedded in box-drawing banner text', () => {
      const chunk = [
        '+--------------------------------------------------------------------------------------------+',
        '|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): |',
        '|  https://box-banner-tunnel-42.trycloudflare.com                                           |',
        '+--------------------------------------------------------------------------------------------+',
      ].join('\n');
      expect(parseTunnelUrl(chunk)).toBe('https://box-banner-tunnel-42.trycloudflare.com');
    });

    it('ignores non-trycloudflare https URLs', () => {
      const chunk = 'INF See https://developers.cloudflare.com/cloudflare-one/ for docs\nINF https://example.com/path';
      expect(parseTunnelUrl(chunk)).toBeNull();
    });

    it('still finds the tunnel URL when other https URLs precede it', () => {
      const chunk = 'INF docs at https://developers.cloudflare.com\nINF https://real-name.trycloudflare.com';
      expect(parseTunnelUrl(chunk)).toBe('https://real-name.trycloudflare.com');
    });
  });

  describe('resolveCloudflaredBinary', () => {
    let tempDir: string;
    let dataDir: string;
    let originalCwd: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'pavii-tunnel-test-'));
      dataDir = mkdtempSync(join(tmpdir(), 'pavii-tunnel-data-'));
      getDataPathMock.mockReturnValue(dataDir);
      originalCwd = process.cwd();
      // The real repo cwd has .cache/tools/cloudflared.exe; chdir to an empty
      // temp dir so the "no candidates" case is genuinely empty.
      process.chdir(tempDir);
      originalEnv = process.env.PAVII_CLOUDFLARED_BIN;
      delete process.env.PAVII_CLOUDFLARED_BIN;
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (originalEnv === undefined) {
        delete process.env.PAVII_CLOUDFLARED_BIN;
      } else {
        process.env.PAVII_CLOUDFLARED_BIN = originalEnv;
      }
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns the PAVII_CLOUDFLARED_BIN override when it points at an existing file', () => {
      const overridePath = join(tempDir, 'my-cloudflared.exe');
      writeFileSync(overridePath, 'stub');
      process.env.PAVII_CLOUDFLARED_BIN = overridePath;
      expect(resolveCloudflaredBinary()).toBe(overridePath);
    });

    it('falls through past a missing PAVII_CLOUDFLARED_BIN path', () => {
      process.env.PAVII_CLOUDFLARED_BIN = join(tempDir, 'does-not-exist.exe');
      const managed = join(dataDir, 'managed-tools');
      mkdirSync(managed, { recursive: true });
      const managedBinary = join(managed, BINARY);
      writeFileSync(managedBinary, 'stub');
      expect(resolveCloudflaredBinary()).toBe(managedBinary);
    });

    it('prefers the cwd .cache/tools candidate over the managed-tools one', () => {
      const cacheTools = join(tempDir, '.cache', 'tools');
      mkdirSync(cacheTools, { recursive: true });
      const cacheBinary = join(cacheTools, BINARY);
      writeFileSync(cacheBinary, 'stub');
      const managed = join(dataDir, 'managed-tools');
      mkdirSync(managed, { recursive: true });
      writeFileSync(join(managed, BINARY), 'stub');
      expect(resolveCloudflaredBinary()).toBe(cacheBinary);
    });

    it('returns null when no candidate exists anywhere', () => {
      expect(resolveCloudflaredBinary()).toBeNull();
    });
  });

  describe('getTunnelState', () => {
    it('returns a copy — mutating the returned object does not affect later reads', () => {
      const first = getTunnelState();
      first.running = true;
      first.url = 'https://mutated.trycloudflare.com';
      const second = getTunnelState();
      expect(second.running).toBe(false);
      expect(second.url).toBeUndefined();
      expect(second).not.toBe(first);
    });
  });

  describe('stopTunnel', () => {
    it('resolves without throwing when nothing is running and state stays not-running', async () => {
      await expect(stopTunnel()).resolves.toBeUndefined();
      const state = getTunnelState();
      expect(state).toEqual({ running: false, starting: false, url: undefined });
    });

    it('is idempotent — calling twice is safe', async () => {
      await stopTunnel();
      await expect(stopTunnel()).resolves.toBeUndefined();
      expect(getTunnelState().running).toBe(false);
    });
  });
});
