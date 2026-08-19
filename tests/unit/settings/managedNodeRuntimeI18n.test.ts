/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

function localeRoot(): URL {
  return new URL('../../../packages/desktop/src/renderer/services/i18n/locales/', import.meta.url);
}

function settingsLanguages(): string[] {
  return readdirSync(localeRoot(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function loadSettingsLocale(language: string): Record<string, string> {
  const url = new URL(`${language}/settings.json`, localeRoot());
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, string>;
}

function loadCommonLocale(language: string): Record<string, unknown> {
  const url = new URL(
    `../../../packages/desktop/src/renderer/services/i18n/locales/${language}/common.json`,
    import.meta.url
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

function loadConversationLocale(language: string): Record<string, unknown> {
  const url = new URL(
    `../../../packages/desktop/src/renderer/services/i18n/locales/${language}/conversation.json`,
    import.meta.url
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

describe('managed node runtime settings copy', () => {
  it('defines assistant agent status tooltip copy in every settings locale', () => {
    for (const language of settingsLanguages()) {
      const settings = loadSettingsLocale(language);

      expect(settings.assistantAgentUnavailable, language).toBeTruthy();
      expect(settings.assistantAgentUnchecked, language).toBeTruthy();
      expect(settings.assistantAgentMissing, language).toBeTruthy();
    }
  });

  it('does not tell MCP users to install Node.js when npx/node preparation fails', () => {
    const en = loadSettingsLocale('en-US');

    expect(en.mcpErrorNodeCommandNotFound).not.toContain('Install Node.js');
    expect(en.mcpErrorNodeCommandNotFound).toContain('managed Node runtime');
  });

  it('keeps the warmup hint generic until the backend can prove node-specific preparation', () => {
    const en = loadConversationLocale('en-US');

    expect((en.runtimePreparing as Record<string, string>).sendboxHint).toContain('runtime environment');
    expect((en.runtimePreparing as Record<string, string>).sendboxHint).not.toContain('managed Node');
  });

  it('defines local data repair startup copy in every common locale', () => {
    for (const language of settingsLanguages()) {
      const common = loadCommonLocale(language);
      const backendStartup = common.backendStartup as Record<string, unknown>;
      const localDataRepair = backendStartup.localDataRepair as Record<string, string>;

      expect(localDataRepair.title).toBeTruthy();
      expect(localDataRepair.description).toBeTruthy();
      expect(localDataRepair.sendDiagnostics).toBeTruthy();
      expect(localDataRepair.diagnosticsSent).toBeTruthy();
      expect(localDataRepair.diagnosticsReportSuccess).toBeTruthy();
      expect(localDataRepair.diagnosticsReportFailed).toBeTruthy();
    }
  });

  it('defines startup directory failure copy in every common locale', () => {
    for (const language of settingsLanguages()) {
      const common = loadCommonLocale(language);
      const backendStartup = common.backendStartup as Record<string, unknown>;
      const startupDirectory = backendStartup.startupDirectory as Record<string, string>;

      expect(startupDirectory.title).toBeTruthy();
      expect(startupDirectory.description).toBeTruthy();
      expect(startupDirectory.sendDiagnostics).toBeTruthy();
      expect(startupDirectory.diagnosticsSent).toBeTruthy();
      expect(startupDirectory.diagnosticsReportSuccess).toBeTruthy();
      expect(startupDirectory.diagnosticsReportFailed).toBeTruthy();
    }
  });
});
