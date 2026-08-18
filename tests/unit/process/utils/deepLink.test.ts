/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';

// deepLink.ts imports the IPC bridge at module scope; stub it so the module
// loads without the full common/ dependency graph. parseDeepLinkUrl is pure.
vi.mock('@/common', () => ({
  ipcBridge: {
    deepLink: {
      received: { emit: vi.fn() },
    },
  },
}));

import { parseDeepLinkUrl } from '@/process/utils/deepLink';

describe('parseDeepLinkUrl', () => {
  describe('existing query-param behavior', () => {
    it('parses a hostname action with query params', () => {
      expect(parseDeepLinkUrl('pavii://add-provider?base_url=https%3A%2F%2Fapi.example.com&api_key=sk-1')).toEqual({
        action: 'add-provider',
        params: { base_url: 'https://api.example.com', api_key: 'sk-1' },
      });
    });

    it('parses a hostname/path action', () => {
      const result = parseDeepLinkUrl('pavii://provider/add?v=1');
      expect(result?.action).toBe('provider/add');
      expect(result?.params.v).toBe('1');
    });

    it('decodes and merges a base64 data param', () => {
      const data = Buffer.from(JSON.stringify({ name: 'demo', key: 'k1' }), 'utf-8').toString('base64');
      const result = parseDeepLinkUrl(`pavii://provider/add?v=1&data=${encodeURIComponent(data)}`);
      expect(result).toEqual({
        action: 'provider/add',
        params: { v: '1', name: 'demo', key: 'k1' },
      });
      expect(result?.params.data).toBeUndefined();
    });

    it('returns null for a non-pavii scheme', () => {
      expect(parseDeepLinkUrl('https://example.com/auth?x=1')).toBeNull();
    });

    it('returns null for an unparseable URL', () => {
      expect(parseDeepLinkUrl('not a url')).toBeNull();
    });
  });

  describe('fragment params', () => {
    it('parses fragment-only params', () => {
      expect(parseDeepLinkUrl('pavii://auth#id_token=abc')).toEqual({
        action: 'auth',
        params: { id_token: 'abc' },
      });
    });

    it('parses multiple fragment params', () => {
      expect(parseDeepLinkUrl('pavii://auth#id_token=abc&state=xyz')).toEqual({
        action: 'auth',
        params: { id_token: 'abc', state: 'xyz' },
      });
    });

    it('merges fragment params with query params', () => {
      expect(parseDeepLinkUrl('pavii://auth?state=from-query#id_token=abc')).toEqual({
        action: 'auth',
        params: { state: 'from-query', id_token: 'abc' },
      });
    });

    it('lets fragment params override query params with the same key', () => {
      expect(parseDeepLinkUrl('pavii://auth?id_token=from-query#id_token=from-fragment')).toEqual({
        action: 'auth',
        params: { id_token: 'from-fragment' },
      });
    });

    it('treats a bare "#" as no fragment params', () => {
      expect(parseDeepLinkUrl('pavii://auth#')).toEqual({
        action: 'auth',
        params: {},
      });
    });

    it('URL-decodes fragment param values', () => {
      expect(parseDeepLinkUrl('pavii://auth#id_token=a%2Bb%2Fc')).toEqual({
        action: 'auth',
        params: { id_token: 'a+b/c' },
      });
    });
  });
});
