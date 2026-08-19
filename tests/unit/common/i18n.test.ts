/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { normalizeLanguageCode, DEFAULT_LANGUAGE } from '@/common/config/i18n';

describe('i18n', () => {
  describe('normalizeLanguageCode', () => {
    it('passes through the one supported tag', () => {
      expect(normalizeLanguageCode('en-US')).toBe('en-US');
    });

    it('normalizes underscores to hyphens before matching', () => {
      expect(normalizeLanguageCode('en_US')).toBe('en-US');
    });

    it('collapses every other language to English', () => {
      // The app ships English-only chrome. Assistants still reply in whatever
      // language the user writes in; that is model behaviour, not this.
      for (const language of ['zh-CN', 'zh', 'ja-JP', 'ja', 'de-DE', 'de-AT', 'pt_BR', 'fa-IR', 'ru', 'fr']) {
        expect(normalizeLanguageCode(language), language).toBe('en-US');
      }
    });

    it('falls back to the default language for unsupported codes', () => {
      expect(normalizeLanguageCode('it')).toBe(DEFAULT_LANGUAGE);
      expect(normalizeLanguageCode('')).toBe(DEFAULT_LANGUAGE);
    });
  });
});
