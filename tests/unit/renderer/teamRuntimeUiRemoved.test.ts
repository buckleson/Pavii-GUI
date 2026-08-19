import { describe, expect, it } from 'vitest';
import teamLocale from '@/renderer/services/i18n/locales/en-US/team.json';

describe('team runtime UI removal', () => {
  it('does not keep team runtime notice translations in the renderer locale', () => {
    expect('runtime' in teamLocale).toBe(false);
  });
});
