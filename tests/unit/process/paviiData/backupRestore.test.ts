/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backup restore: dependency order, skip-existing, agent id remapping,
 * secrets usage and per-section summary numbers.
 */

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpRequest, fetchMock, fsMock } = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  fetchMock: vi.fn(),
  fsMock: {
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}abc`),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  },
}));

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpRequest,
}));
vi.mock('electron', () => ({ app: { getPath: () => '/docs-root', getVersion: () => '1.0.0' } }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const nodePath = await import('node:path');
  const fake = { ...actual, tmpdir: () => nodePath.resolve('/tmp-root') };
  return { ...fake, default: fake };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const fake = { ...actual, promises: { ...actual.promises, ...fsMock } };
  return { ...fake, default: fake };
});

import type { PaviiBackupSection } from '@/common/types/agent/paviiData';
import { restoreBackup } from '@process/paviiData/backupRestore';

type Data = Record<PaviiBackupSection, unknown>;
type Engine = {
  providers: Record<string, unknown>[];
  agents: Record<string, unknown>[];
  mcp: Record<string, unknown>[];
  assistants: Record<string, unknown>[];
  skills: Record<string, unknown>[];
};

let engineState: Engine;
let routes: Record<string, (body?: unknown) => unknown>;
/** Every write in call order, from both `httpRequest` and the sensitive `fetch` path. */
let writes: Array<{ call: string; body: unknown }>;

const sensitiveResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => ({ success: true, data }),
  text: async () => '',
});

const fullData = (): Data => ({
  providers: [
    { id: 'prov-new', name: 'New', platform: 'openai' },
    { id: 'prov-existing', name: 'Existing', platform: 'openai' },
  ],
  agents: {
    custom: [{ id: 'old-custom', name: 'Mine', command: 'mine', env: [{ name: 'K', value: '' }], advanced: {} }],
    rows: [
      {
        id: 'old-custom',
        enabled: false,
        linked_provider_id: 'prov-new',
        overrides: { command_override: 'mine --x', env_override: [] },
      },
      { id: 'agent-gone', enabled: false, linked_provider_id: null },
    ],
  },
  mcpServers: [
    { name: 'mcp-new', enabled: true, transport: { type: 'stdio', env: { K: '' } }, original_json: '{}' },
    { name: 'mcp-existing', enabled: true, transport: {}, original_json: '{}' },
  ],
  assistants: {
    user: [
      { id: 'asst-new', name: 'New', rule: 'Be brief.' },
      { id: 'asst-existing', name: 'Old' },
    ],
    state: [{ id: 'asst-new', enabled: false, sort_order: 3 }],
  },
  skills: [{ name: 'skill-new', files: [{ path: 'SKILL.md', base64: Buffer.from('# s').toString('base64') }] }],
  settings: { system: { language: 'en-US' }, client: { theme: 'dark' } },
  sessions: [{ conversationId: 'c1' }, { conversationId: 'c2' }],
});

const SECRETS = {
  'provider:prov-new': { api_key: 'sk-restored' },
  'customAgent:old-custom': [{ name: 'K', value: 'agent-secret' }],
  'agentOverride:old-custom': [{ name: 'O', value: 'override-secret' }],
  'mcp:mcp-new': {
    transport: { type: 'stdio', env: { K: 'mcp-secret' } },
    original_json: '{"env":{"K":"mcp-secret"}}',
  },
};

const summaryOf = async (data: Data, secrets?: Record<string, unknown>) =>
  Object.fromEntries((await restoreBackup(data, secrets)).map(({ section, ...rest }) => [section, rest]));
const writeCalls = () => writes.map((w) => w.call);
const bodyOf = (call: string) => writes.find((w) => w.call === call)?.body;

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  engineState = {
    providers: [{ id: 'prov-existing' }],
    agents: [{ id: 'builtin-1', agent_source: 'builtin' }],
    mcp: [{ name: 'mcp-existing' }],
    assistants: [{ id: 'asst-existing' }],
    skills: [],
  };
  routes = {
    'GET /api/providers': () => engineState.providers,
    'GET /api/agents/management': () => engineState.agents,
    'GET /api/mcp/servers': () => engineState.mcp,
    'GET /api/assistants': () => engineState.assistants,
    'GET /api/skills': () => engineState.skills,
    'POST /api/assistants/import': () => {
      engineState.assistants.push({ id: 'asst-new' });
      return { imported: 1, skipped: 0, failed: 0 };
    },
    'POST /api/skills/assistant-rule/write': () => undefined,
    'PATCH /api/assistants/asst-new/state': () => undefined,
    'POST /api/skills/import': () => ({ imported: ['skill-new'], failed: [] }),
    'PATCH /api/agents/new-agent/enabled': () => undefined,
    'PUT /api/agents/new-agent/provider-link': () => undefined,
    'PUT /api/settings/client': () => undefined,
    'PATCH /api/settings': () => undefined,
  };
  httpRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    const call = `${method} ${url}`;
    if (method !== 'GET') writes.push({ call, body });
    const route = routes[call];
    if (!route) throw new Error(`unexpected ${call}`);
    return route(body);
  });
  fetchMock.mockImplementation(async (url: string, init: { method: string; body: string }) => {
    const call = `${init.method} ${new URL(url).pathname}`;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    writes.push({ call, body });
    if (call === 'POST /api/providers') {
      engineState.providers.push({ id: body.id });
      return sensitiveResponse(body);
    }
    if (call === 'POST /api/agents/custom') {
      engineState.agents.push({ id: 'new-agent', agent_source: 'custom' });
      return sensitiveResponse({ id: 'new-agent' });
    }
    return sensitiveResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('restoreBackup order', () => {
  it('restores providers, agents, links, MCP, assistants, skills, then settings', async () => {
    await restoreBackup(fullData(), SECRETS);

    expect(writeCalls()).toEqual([
      'POST /api/providers',
      'POST /api/agents/custom',
      'PUT /api/agents/new-agent/overrides',
      'PATCH /api/agents/new-agent/enabled',
      'PUT /api/agents/new-agent/provider-link',
      'POST /api/mcp/servers/import',
      'POST /api/assistants/import',
      'POST /api/skills/assistant-rule/write',
      'PATCH /api/assistants/asst-new/state',
      'POST /api/skills/import',
      'PUT /api/settings/client',
      'PATCH /api/settings',
    ]);
  });

  it('reports a summary for every section', async () => {
    const summary = await summaryOf(fullData(), SECRETS);

    expect(summary).toEqual({
      providers: { restored: 1, skipped: 1, failed: 0 },
      agents: { restored: 2, skipped: 1, failed: 0 },
      mcpServers: { restored: 1, skipped: 1, failed: 0 },
      assistants: { restored: 1, skipped: 1, failed: 0 },
      skills: { restored: 1, skipped: 0, failed: 0 },
      settings: { restored: 2, skipped: 0, failed: 0 },
      sessions: { restored: 0, skipped: 2, failed: 0 },
    });
  });
});

describe('restoreBackup providers', () => {
  it('uses the API key from the secrets', async () => {
    await restoreBackup(fullData(), SECRETS);

    expect(bodyOf('POST /api/providers')).toMatchObject({ id: 'prov-new', api_key: 'sk-restored' });
  });

  it('counts a provider without a key as failed and never posts it', async () => {
    const summary = await summaryOf(fullData(), undefined);

    expect(summary.providers).toEqual({ restored: 0, skipped: 1, failed: 1 });
    expect(writeCalls()).not.toContain('POST /api/providers');
  });

  it('recreates a Bedrock provider from its access keys without an API key', async () => {
    const data = { ...fullData(), providers: [{ id: 'bed', platform: 'bedrock', bedrock_config: { region: 'r' } }] };

    await restoreBackup(data, { 'provider:bed': { access_key_id: 'AK', secret_access_key: 'SK' } });

    expect(bodyOf('POST /api/providers')).toMatchObject({
      bedrock_config: { region: 'r', access_key_id: 'AK', secret_access_key: 'SK' },
    });
  });

  it('counts an engine rejection as failed', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      text: async () => '{"error":"boom"}',
    }));

    const summary = await summaryOf(
      { ...fullData(), providers: [{ id: 'p', platform: 'openai' }] },
      {
        'provider:p': { api_key: 'k' },
      }
    );

    expect(summary.providers).toEqual({ restored: 0, skipped: 0, failed: 1 });
  });
});

describe('restoreBackup agents', () => {
  it('creates the custom agent with its secret env values', async () => {
    await restoreBackup(fullData(), SECRETS);

    expect(bodyOf('POST /api/agents/custom')).toMatchObject({ name: 'Mine', env: SECRETS['customAgent:old-custom'] });
  });

  it('applies overrides to the remapped id with the secret env override', async () => {
    await restoreBackup(fullData(), SECRETS);

    expect(bodyOf('PUT /api/agents/new-agent/overrides')).toEqual({
      command_override: 'mine --x',
      env_override: SECRETS['agentOverride:old-custom'],
    });
  });

  it('maps to an existing twin agent instead of creating a duplicate', async () => {
    engineState.agents.push({ id: 'new-agent', agent_source: 'custom', name: 'Mine', command: 'mine' });

    const summary = await summaryOf(fullData(), SECRETS);

    expect(writeCalls()).not.toContain('POST /api/agents/custom');
    expect(writeCalls()).toContain('PATCH /api/agents/new-agent/enabled');
    expect(summary.agents).toEqual({ restored: 1, skipped: 2, failed: 0 });
  });

  it('skips the provider link when that provider was not restored', async () => {
    await restoreBackup(fullData(), undefined);

    expect(writeCalls()).not.toContain('PUT /api/agents/new-agent/provider-link');
  });

  it('counts an incomplete custom agent as failed', async () => {
    const data = { ...fullData(), agents: { custom: [{ id: 'x', name: 'No command' }], rows: [] as unknown[] } };

    const summary = await summaryOf(data, undefined);

    expect(summary.agents).toEqual({ restored: 0, skipped: 0, failed: 1 });
  });
});

describe('restoreBackup MCP, assistants, skills and settings', () => {
  it('imports MCP servers with the secret transport when available', async () => {
    await restoreBackup(fullData(), SECRETS);

    expect(bodyOf('POST /api/mcp/servers/import')).toEqual({
      servers: [
        {
          name: 'mcp-new',
          enabled: true,
          transport: SECRETS['mcp:mcp-new'].transport,
          original_json: SECRETS['mcp:mcp-new'].original_json,
          builtin: false,
        },
      ],
    });
  });

  it('sends assistants without their rule and writes the rule separately', async () => {
    await restoreBackup(fullData(), SECRETS);

    expect(bodyOf('POST /api/assistants/import')).toEqual({ assistants: [{ id: 'asst-new', name: 'New' }] });
    expect(bodyOf('POST /api/skills/assistant-rule/write')).toEqual({ assistant_id: 'asst-new', content: 'Be brief.' });
  });

  it('counts every missing assistant as failed when the import call fails', async () => {
    routes['POST /api/assistants/import'] = () => {
      throw new Error('nope');
    };

    const summary = await summaryOf(fullData(), SECRETS);

    expect(summary.assistants).toEqual({ restored: 0, skipped: 1, failed: 1 });
  });

  it('writes skill files into a temp dir, imports it, and cleans up', async () => {
    await restoreBackup(fullData(), SECRETS);

    const tmpRoot = path.join(path.resolve('/tmp-root'), 'pavii-skill-') + 'abc';
    expect(fsMock.writeFile).toHaveBeenCalledWith(path.join(tmpRoot, 'skill-new', 'SKILL.md'), Buffer.from('# s'));
    expect(bodyOf('POST /api/skills/import')).toEqual({ skill_path: path.join(tmpRoot, 'skill-new') });
    expect(fsMock.rm).toHaveBeenCalledWith(tmpRoot, { recursive: true, force: true });
  });

  it('refuses skill file paths that escape the skill folder', async () => {
    const data = {
      ...fullData(),
      skills: [{ name: 'evil', files: [{ path: '../../outside.txt', base64: 'eA==' }] }],
    };

    await restoreBackup(data, undefined);

    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('skips an existing skill and counts an engine-reported skill failure', async () => {
    engineState.skills = [{ name: 'skill-new' }];
    const data = { ...fullData(), skills: [...(fullData().skills as unknown[]), { name: 'broken', files: [] }] };
    routes['POST /api/skills/import'] = () => ({ imported: [], failed: [{ name: 'broken' }] });

    const summary = await summaryOf(data, undefined);

    expect(summary.skills).toEqual({ restored: 0, skipped: 1, failed: 1 });
  });

  it('counts a rejected settings write as failed', async () => {
    routes['PATCH /api/settings'] = () => {
      throw new Error('bad');
    };

    const summary = await summaryOf(fullData(), SECRETS);

    expect(summary.settings).toEqual({ restored: 1, skipped: 0, failed: 1 });
  });
});

describe('restoreBackup section failures', () => {
  it('counts a section that cannot be listed as one failure and continues', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    routes['GET /api/mcp/servers'] = () => {
      throw new Error('mcp list down');
    };

    const summary = await summaryOf(fullData(), SECRETS);

    expect(summary.mcpServers).toEqual({ restored: 0, skipped: 0, failed: 1 });
    expect(summary.assistants.restored).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});
