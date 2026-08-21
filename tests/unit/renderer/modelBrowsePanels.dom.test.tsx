import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openExternal = vi.fn().mockResolvedValue(undefined);

vi.mock('@/common', () => ({
  ipcBridge: { shell: { openExternal: { invoke: (url: string) => openExternal(url) } } },
}));

// Return the key so assertions read against a stable identifier, but honour
// interpolation so count/name substitution is exercised rather than skipped.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts.provider === 'string') return `${key}:${opts.provider}`;
      if (opts && typeof opts.count === 'number') return `${key}:${opts.count}`;
      return key;
    },
  }),
}));

import FreeModelsPanel from '@/renderer/components/settings/SettingsModal/contents/models/FreeModelsPanel';
import AllProvidersPanel from '@/renderer/components/settings/SettingsModal/contents/models/AllProvidersPanel';
import { FREE_MODEL_PROVIDERS } from '@/renderer/components/settings/SettingsModal/contents/models/freeModelTypes';

describe('FreeModelsPanel', () => {
  beforeEach(() => openExternal.mockClear());

  it('lists every free provider', () => {
    render(<FreeModelsPanel onConnect={vi.fn()} />);
    for (const provider of FREE_MODEL_PROVIDERS) {
      expect(screen.getByText(provider.name), provider.name).toBeTruthy();
    }
  });

  it('sends the user to the provider https key page', () => {
    render(<FreeModelsPanel onConnect={vi.fn()} />);
    const groq = FREE_MODEL_PROVIDERS.find((provider) => provider.id === 'groq')!;
    const card = document.querySelector('[data-testid="free-model-groq"]')!;
    const getKey = [...card.querySelectorAll('button')].find((b) => /getApiKey/.test(b.textContent || ''))!;
    fireEvent.click(getKey);
    expect(openExternal).toHaveBeenCalledWith(groq.apiKeyUrl);
  });

  it('hands Connect a prefill carrying the endpoint but never a key', () => {
    const onConnect = vi.fn();
    render(<FreeModelsPanel onConnect={onConnect} />);
    const groq = FREE_MODEL_PROVIDERS.find((provider) => provider.id === 'groq')!;
    const card = document.querySelector('[data-testid="free-model-groq"]')!;
    const connect = [...card.querySelectorAll('button')].find((b) => /freeModels\.connect/.test(b.textContent || ''))!;
    fireEvent.click(connect);
    expect(onConnect).toHaveBeenCalledWith({
      name: groq.name,
      base_url: groq.baseUrl,
      platform: 'new-api',
    });
    expect(onConnect.mock.calls[0][0].api_key).toBeUndefined();
  });

  it('disables one-click connect for a provider that cannot be auto-configured', () => {
    // Cloudflare's URL has a placeholder; offering Connect would save a provider
    // that can never reach anything.
    render(<FreeModelsPanel onConnect={vi.fn()} />);
    const card = document.querySelector('[data-testid="free-model-cloudflare-workers-ai"]')!;
    const manual = [...card.querySelectorAll('button')].find((b) => /manualSetup/.test(b.textContent || ''));
    expect(manual, 'expected a manual-setup button').toBeTruthy();
    expect((manual as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows no clipboard prompt until a key has actually been detected', () => {
    render(<FreeModelsPanel onConnect={vi.fn()} />);
    expect(screen.queryByTestId('free-models-clipboard-prompt')).toBeNull();
  });
});

describe('AllProvidersPanel', () => {
  it('renders the preset catalogue', () => {
    render(<AllProvidersPanel onConnect={vi.fn()} />);
    expect(document.querySelectorAll('[data-testid^="all-provider-"]').length).toBeGreaterThan(5);
  });

  it('filters as the user types, and says so when nothing matches', () => {
    render(<AllProvidersPanel onConnect={vi.fn()} />);
    // Arco wraps the control, so reach for the real <input> rather than the testid host.
    const input = document.querySelector('input') as HTMLInputElement;
    expect(input, 'search input should render').toBeTruthy();
    fireEvent.change(input, { target: { value: 'openrouter' } });
    expect(document.querySelectorAll('[data-testid^="all-provider-"]').length).toBe(1);

    fireEvent.change(input, { target: { value: 'zzzznope' } });
    expect(document.querySelectorAll('[data-testid^="all-provider-"]').length).toBe(0);
    expect(screen.getByText('settings.allProviders.noMatches')).toBeTruthy();
  });

  it('passes the preset platform and base url through to the form', () => {
    const onConnect = vi.fn();
    render(<AllProvidersPanel onConnect={onConnect} />);
    const card = document.querySelector('[data-testid^="all-provider-"]')!;
    fireEvent.click(card.querySelector('button')!);
    expect(onConnect).toHaveBeenCalledTimes(1);
    const arg = onConnect.mock.calls[0][0];
    expect(typeof arg.name).toBe('string');
    expect(arg.platform).toBeTruthy();
  });
});
