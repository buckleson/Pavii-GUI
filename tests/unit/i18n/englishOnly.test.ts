/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, normalizeLanguageCode } from '@/common/config/i18n';

const DESKTOP_LOCALES = path.resolve(__dirname, '../../../packages/desktop/src/renderer/services/i18n/locales');
const MOBILE_LOCALES = path.resolve(__dirname, '../../../mobile/src/i18n/locales');

/**
 * The app ships English only. Assistants still reply in whatever language the
 * user writes in - that is model behaviour, not app chrome.
 *
 * normalizeLanguageCode() falling back to DEFAULT_LANGUAGE for anything
 * unsupported is what makes this hold across every entry point (OS locale, a
 * stored preference from an older build, the WebUI hint), so it is the single
 * behaviour worth pinning.
 */
describe('English-only app chrome', () => {
  it('supports exactly one language', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en-US']);
    expect(DEFAULT_LANGUAGE).toBe('en-US');
  });

  it('collapses any other language to English', () => {
    for (const language of ['zh-CN', 'ja-JP', 'de-DE', 'ru-RU', 'fa-IR', 'pt-BR', 'zh', 'fr']) {
      expect(normalizeLanguageCode(language), language).toBe('en-US');
    }
  });

  it('collapses a stored preference from an older multilingual build', () => {
    // Upgraders carry e.g. 'zh-CN' in config; they must land on English rather
    // than a half-translated UI.
    expect(normalizeLanguageCode('zh-CN')).toBe('en-US');
  });

  it('survives junk input without throwing', () => {
    for (const junk of ['', '   ', 'not-a-language', 'en_US', 'EN-us']) {
      expect(() => normalizeLanguageCode(junk)).not.toThrow();
      expect(typeof normalizeLanguageCode(junk)).toBe('string');
    }
  });

  it('ships only the English catalogue on desktop', () => {
    const dirs = fs.readdirSync(DESKTOP_LOCALES).filter((entry) => fs.statSync(path.join(DESKTOP_LOCALES, entry)).isDirectory());
    expect(dirs).toEqual(['en-US']);
  });

  it('ships only the English catalogue on mobile', () => {
    const files = fs.readdirSync(MOBILE_LOCALES).filter((entry) => entry.endsWith('.json'));
    expect(files).toEqual(['en-US.json']);
  });
});
