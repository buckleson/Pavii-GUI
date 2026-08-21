import { describe, expect, it } from 'vitest';
import {
  FREE_MODEL_CATALOG,
  FREE_MODEL_PROVIDERS,
  canAutoConfigure,
  looksLikeApiKey,
  platformForProvider,
  prefillForProvider,
} from '@/renderer/components/settings/SettingsModal/contents/models/freeModelTypes';

describe('free model catalogue', () => {
  it('ships every provider with the fields the UI and the connect flow need', () => {
    expect(FREE_MODEL_PROVIDERS.length).toBeGreaterThan(0);
    for (const provider of FREE_MODEL_PROVIDERS) {
      expect(provider.name.trim(), provider.id).not.toBe('');
      expect(provider.baseUrl.trim(), provider.name).not.toBe('');
      expect(provider.models.length, `${provider.name} must list at least one model`).toBeGreaterThan(0);
      for (const model of provider.models) {
        expect(model.name.trim(), `${provider.name} has an unnamed model`).not.toBe('');
      }
    }
  });

  it('only ever sends the user to https for a key', () => {
    // These URLs are opened in the user's browser; http would be a downgrade on
    // a page whose entire purpose is issuing a credential.
    for (const provider of FREE_MODEL_PROVIDERS) {
      expect(provider.apiKeyUrl.startsWith('https://'), `${provider.name}: ${provider.apiKeyUrl}`).toBe(true);
    }
  });

  it('has unique ids, since they key the React list and the clipboard hand-off', () => {
    const ids = FREE_MODEL_PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records where the data came from, so a refresh knows what to re-read', () => {
    expect(FREE_MODEL_CATALOG.source).toContain('manifest.build');
    expect(FREE_MODEL_CATALOG.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('platform mapping', () => {
  it('maps Gemini to its own platform, not the OpenAI shape', () => {
    // Gemini's request shape is not OpenAI's. Mapping it to `new-api` produces a
    // provider that looks configured and fails on first use.
    const gemini = FREE_MODEL_PROVIDERS.find((provider) => provider.compat === 'gemini');
    expect(gemini, 'the catalogue should contain a Gemini entry').toBeDefined();
    expect(platformForProvider(gemini!)).toBe('gemini');
  });

  it('refuses to one-click a provider whose base URL has a placeholder', () => {
    // Cloudflare's documented URL embeds `{account_id}`. Connecting it as printed
    // would save a provider that can never reach anything.
    const manual = FREE_MODEL_PROVIDERS.filter((provider) => provider.compat === 'manual');
    expect(manual.length).toBeGreaterThan(0);
    for (const provider of manual) {
      expect(canAutoConfigure(provider), provider.name).toBe(false);
      expect(provider.baseUrl).toContain('{');
    }
  });

  it('classifies every provider, so none silently falls through', () => {
    const allowed = new Set(['openai', 'gemini', 'other', 'manual']);
    for (const provider of FREE_MODEL_PROVIDERS) {
      expect(allowed.has(provider.compat), `${provider.name} has compat "${provider.compat}"`).toBe(true);
    }
  });

  it('claims OpenAI compatibility only for endpoints that look like one', () => {
    // A guard against a future data refresh quietly marking a vendor-native URL
    // as OpenAI-shaped, which is the mistake that produces a broken provider.
    for (const provider of FREE_MODEL_PROVIDERS.filter((item) => item.compat === 'openai')) {
      const url = provider.baseUrl;
      expect(/\/v1$|\/inference$/.test(url), `${provider.name}: ${url}`).toBe(true);
    }
  });

  it('never pre-fills an api key, because we cannot know it', () => {
    for (const provider of FREE_MODEL_PROVIDERS.filter(canAutoConfigure)) {
      const prefill = prefillForProvider(provider);
      expect(prefill.api_key).toBeUndefined();
      expect(prefill.base_url).toBe(provider.baseUrl);
      expect(prefill.name).toBe(provider.name);
    }
  });
});

describe('looksLikeApiKey', () => {
  it('accepts the shapes real providers issue', () => {
    for (const key of [
      'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
      'gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      'hf_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
    ]) {
      expect(looksLikeApiKey(key), key).toBe(true);
    }
  });

  it('rejects what people actually have on the clipboard otherwise', () => {
    for (const value of [
      '',
      '   ',
      'short',
      'https://console.groq.com/keys',
      'Here is your API key, keep it secret',
      'the quick brown fox jumps over the lazy dog',
      'x'.repeat(600),
    ]) {
      expect(looksLikeApiKey(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace from a sloppy copy', () => {
    expect(looksLikeApiKey('  sk-proj-abcdefghijklmnopqrstuvwxyz0123  ')).toBe(true);
  });
});
