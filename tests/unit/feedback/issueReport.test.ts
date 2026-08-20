/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildIssueBody,
  buildIssueTitle,
  buildPrefilledIssueUrl,
  type IssueEnvironment,
} from '@/common/utils/issueReport';

const environment: IssueEnvironment = {
  appVersion: '2.1.52',
  arch: 'x64',
  electronVersion: '33.0.0',
  locale: 'en-US',
  osRelease: '10.0.26200',
  platform: 'win32',
};

describe('buildIssueTitle', () => {
  it('prefixes the module and keeps a short description intact', () => {
    expect(buildIssueTitle('Skills', 'Token Optimizer will not enable')).toBe(
      '[Skills] Token Optimizer will not enable'
    );
  });

  it('truncates a long description so the title stays readable', () => {
    const title = buildIssueTitle('Chat', 'x'.repeat(200));
    expect(title.length).toBeLessThan(80);
    expect(title.endsWith('...')).toBe(true);
  });

  it('collapses newlines and runs of whitespace', () => {
    expect(buildIssueTitle('Chat', 'line one\n\n   line two')).toBe('[Chat] line one line two');
  });

  it('falls back to a placeholder when the description is empty', () => {
    expect(buildIssueTitle('Chat', '   ')).toBe('[Chat] Issue report');
  });
});

describe('buildIssueBody', () => {
  it('includes the description and the environment table', () => {
    const body = buildIssueBody({ description: 'It crashed on launch', environment, moduleLabel: 'Startup' });
    expect(body).toContain('### What happened');
    expect(body).toContain('It crashed on launch');
    expect(body).toContain('| App version | 2.1.52 |');
    expect(body).toContain('| OS | win32 10.0.26200 |');
    expect(body).toContain('| Arch | x64 |');
  });

  it('omits environment rows that are unknown', () => {
    const body = buildIssueBody({
      description: 'hi',
      environment: { appVersion: '1.0.0', arch: 'arm64', platform: 'darwin' },
      moduleLabel: 'Chat',
    });
    expect(body).not.toContain('| Electron |');
    expect(body).not.toContain('| Locale |');
    expect(body).toContain('| OS | darwin |');
  });

  it('lists attachment filenames with instructions, since the app cannot upload them', () => {
    const body = buildIssueBody({
      attachmentNames: ['logs.log.gz', 'screenshot-1.png'],
      description: 'hi',
      environment,
      moduleLabel: 'Chat',
    });
    expect(body).toContain('### Diagnostics');
    expect(body).toContain('Drag them into this issue');
    expect(body).toContain('`logs.log.gz`');
    expect(body).toContain('`screenshot-1.png`');
  });

  it('leaves out the diagnostics section when there are no attachments', () => {
    const body = buildIssueBody({ attachmentNames: [], description: 'hi', environment, moduleLabel: 'Chat' });
    expect(body).not.toContain('### Diagnostics');
  });
});

describe('buildPrefilledIssueUrl', () => {
  it('targets the releases repository issue form', () => {
    const url = buildPrefilledIssueUrl('title', 'body');
    expect(url.startsWith('https://github.com/buckleson/Pavii-Gui-Releases/issues/new?')).toBe(true);
  });

  it('round-trips the title and body through query parameters', () => {
    const url = new URL(buildPrefilledIssueUrl('[Chat] it broke', 'line one\nline two'));
    expect(url.searchParams.get('title')).toBe('[Chat] it broke');
    expect(url.searchParams.get('body')).toBe('line one\nline two');
  });

  it('truncates an oversized body rather than emitting a URL GitHub will reject', () => {
    const url = buildPrefilledIssueUrl('title', 'x'.repeat(50_000));
    expect(url.length).toBeLessThanOrEqual(6000);
    // searchParams decodes '+' back to spaces; decodeURIComponent does not.
    expect(new URL(url).searchParams.get('body')).toContain('truncated');
  });

  it('keeps the start of the description when truncating', () => {
    const body = `THE ACTUAL PROBLEM\n${'padding '.repeat(5000)}`;
    const url = buildPrefilledIssueUrl('title', body);
    expect(new URL(url).searchParams.get('body')).toContain('THE ACTUAL PROBLEM');
  });
});
