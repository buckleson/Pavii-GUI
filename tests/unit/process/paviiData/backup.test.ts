/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * `.pavii` backup export/read/import: secrets stay out of `data`, are only
 * stored encrypted with a password, the file is written atomically under
 * Documents/Pavii, and invalid files are rejected with typed errors.
 */

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpRequest, memFs, restoreBackup, readStoredSession } = vi.hoisted(() => {
  const store = new Map<string, Buffer>();
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  return {
    httpRequest: vi.fn(),
    restoreBackup: vi.fn(),
    readStoredSession: vi.fn(),
    memFs: {
      store,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (p: string, content: string | Buffer) => {
        store.set(p, Buffer.from(content));
      }),
      rename: vi.fn(async (from: string, to: string) => {
        const content = store.get(from);
        if (!content) throw enoent(from);
        store.delete(from);
        store.set(to, content);
      }),
      rm: vi.fn(async (p: string) => {
        store.delete(p);
      }),
      readFile: vi.fn(async (p: string, encoding?: string) => {
        const content = store.get(p);
        if (!content) throw enoent(p);
        return encoding ? content.toString('utf8') : content;
      }),
      stat: vi.fn(async (p: string) => {
        const content = store.get(p);
        if (!content) throw enoent(p);
        return { size: content.length };
      }),
      readdir: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/docs-root'), getVersion: vi.fn(() => '9.9.9') },
}));
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpRequest,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const nodePath = await import('node:path');
  memFs.readdir.mockImplementation(async (dir: string) => {
    const entries = new Map<string, boolean>();
    for (const key of memFs.store.keys()) {
      if (!key.startsWith(dir + nodePath.sep)) continue;
      const [first, ...rest] = key.slice(dir.length + 1).split(nodePath.sep);
      entries.set(first, rest.length > 0 || entries.get(first) === true);
    }
    if (entries.size === 0) throw new Error(`ENOENT: ${dir}`);
    return [...entries].map(([name, isDir]) => ({ name, isFile: () => !isDir, isDirectory: () => isDir }));
  });
  const promises = {
    ...actual.promises,
    mkdir: memFs.mkdir,
    writeFile: memFs.writeFile,
    rename: memFs.rename,
    rm: memFs.rm,
    readFile: memFs.readFile,
    stat: memFs.stat,
    readdir: memFs.readdir,
  };
  const fake = { ...actual, promises };
  return { ...fake, default: fake };
});
vi.mock('@process/paviiData/backupRestore', () => ({ restoreBackup }));
vi.mock('@process/services/paviiAuth', () => ({ readStoredSession }));
vi.mock('@process/utils/utils', () => ({ getConfigPath: () => '/config-root' }));

import { app } from 'electron';
import {
  blankSecretMaps,
  exportBackup,
  getDefaultBackupPath,
  importBackup,
  readBackupFile,
  readBackupMeta,
  secretKey,
  sectionCounts,
} from '@process/paviiData/backup';
import { decryptSecrets, encryptSecrets } from '@process/paviiData/crypto';

type Profile = {
  providers: Record<string, unknown>[];
  agents: Record<string, unknown>[];
  overrides: Record<string, unknown>;
  mcpServers: Record<string, unknown>[];
  assistants: Record<string, unknown>[];
  systemSettings: Record<string, unknown>;
  clientSettings: Record<string, unknown>;
};

const SKILL_DIR = path.resolve('/skills-root/demo-skill');
const DEFAULT_PATH = path.join('/docs-root', 'Pavii', 'backup.pavii');
let profile: Profile;
let routes: Record<string, (body?: unknown) => unknown>;

const loadProfile = async (): Promise<Profile> => {
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
  const raw = actualFs.readFileSync(path.resolve(__dirname, '../../../fixtures/paviiData/engine-profile.json'), 'utf8');
  return JSON.parse(raw) as Profile;
};

/** Export and parse the file that landed at `target`. */
const exportAndRead = async (params: { password?: string; path?: string } = {}) => {
  const result = await exportBackup(params);
  const written = memFs.store.get(params.path ?? DEFAULT_PATH);
  return { result, file: written ? JSON.parse(written.toString('utf8')) : undefined };
};

const writeBackup = (file: unknown, at = '/in/backup.pavii') => {
  memFs.store.set(at, Buffer.from(typeof file === 'string' ? file : JSON.stringify(file)));
  return at;
};
const validFile = (extra: Record<string, unknown> = {}) => ({
  format: 'pavii-backup',
  version: 1,
  appVersion: '1.0.0',
  createdAt: '2026-05-01T00:00:00.000Z',
  data: {
    providers: [{ id: 'p' }],
    agents: {},
    mcpServers: [] as unknown[],
    assistants: {},
    skills: [] as unknown[],
    settings: {},
    sessions: [] as unknown[],
  },
  ...extra,
});

beforeEach(async () => {
  vi.clearAllMocks();
  memFs.store.clear();
  profile = await loadProfile();
  readStoredSession.mockResolvedValue({ uid: 'uid-123' });
  restoreBackup.mockResolvedValue([{ section: 'providers', restored: 1, skipped: 0, failed: 0 }]);
  memFs.store.set(path.join(SKILL_DIR, 'SKILL.md'), Buffer.from('# Demo skill'));
  memFs.store.set(path.join(SKILL_DIR, 'refs', 'notes.md'), Buffer.from('notes'));
  memFs.store.set(path.join(SKILL_DIR, '.git', 'HEAD'), Buffer.from('ref'));
  memFs.store.set(path.join(SKILL_DIR, 'huge.bin'), Buffer.alloc(1024 * 1024 + 1));
  routes = {
    'GET /api/providers': () => profile.providers,
    'GET /api/agents/management': () => profile.agents,
    'GET /api/agents/agent-builtin-1/overrides': () => profile.overrides,
    'GET /api/mcp/servers': () => profile.mcpServers,
    'GET /api/assistants': () => profile.assistants,
    'POST /api/skills/assistant-rule/read': () => 'Always be concise.',
    'GET /api/skills': () => [
      { name: 'demo-skill', source: 'custom', location: path.join(SKILL_DIR, 'SKILL.md') },
      { name: 'builtin-skill', source: 'builtin', location: '/elsewhere' },
    ],
    'GET /api/settings': () => profile.systemSettings,
    'GET /api/settings/client': () => profile.clientSettings,
    'GET /api/conversations/sessions-index': () => [{ conversationId: 'c1' }],
  };
  httpRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    return route(body);
  });
});

describe('getDefaultBackupPath', () => {
  it('lives in Documents/Pavii/backup.pavii', () => {
    expect(getDefaultBackupPath()).toBe(DEFAULT_PATH);
    expect(app.getPath).toHaveBeenCalledWith('documents');
  });
});

describe('blankSecretMaps', () => {
  it('blanks env and headers values at any depth but keeps their keys', () => {
    const value = { a: [{ env: { K: 'v' } }], headers: { Authorization: 'Bearer x' }, other: { keep: 'me' } };

    expect(blankSecretMaps(value)).toEqual({
      a: [{ env: { K: '' } }],
      headers: { Authorization: '' },
      other: { keep: 'me' },
    });
  });

  it('leaves non-object env values and primitives alone', () => {
    expect(blankSecretMaps({ env: 'string' })).toEqual({ env: 'string' });
    expect(blankSecretMaps(null)).toBeNull();
  });
});

describe('exportBackup without a password', () => {
  it('writes the default file without a secrets block', async () => {
    const { result, file } = await exportAndRead();

    expect(result).toEqual({ success: true, path: DEFAULT_PATH, includesSecrets: false });
    expect(file.secrets).toBeUndefined();
    expect(file).toMatchObject({ format: 'pavii-backup', version: 1, appVersion: '9.9.9', accountUid: 'uid-123' });
  });

  it('never writes any fixture secret value into the file', async () => {
    const { file } = await exportAndRead();
    const text = JSON.stringify(file);

    expect(text).not.toMatch(
      /sk-fixture-openai|AKIAFIXTURE|fixture-secret-access|fixture-agent-token|fixture-override-value|fixture-mcp-key|Bearer fixture/
    );
  });

  it('drops provider keys and health but keeps the rest of the provider', async () => {
    const { file } = await exportAndRead();

    expect(file.data.providers[0]).toEqual({
      id: 'prov-openai',
      name: 'Test OpenAI',
      platform: 'openai',
      base_url: 'https://api.example.test',
    });
    expect(file.data.providers[1].bedrock_config).toEqual({ region: 'us-east-1' });
  });

  it('keeps custom agents and changed agent rows with blanked env values', async () => {
    const { file } = await exportAndRead();

    expect(file.data.agents.custom[0]).toMatchObject({ id: 'agent-custom-1', env: [{ name: 'MY_TOKEN', value: '' }] });
    expect(file.data.agents.rows.map((r: { id: string }) => r.id)).toEqual(['agent-builtin-1']);
    expect(file.data.agents.rows[0].overrides).toEqual({
      command_override: 'custom-cli',
      env_override: [{ name: 'OVERRIDE_KEY', value: '' }],
    });
  });

  it('keeps only user MCP servers with blanked env and original_json secrets', async () => {
    const { file } = await exportAndRead();

    expect(file.data.mcpServers).toHaveLength(1);
    expect(file.data.mcpServers[0].transport.env).toEqual({ MCP_KEY: '' });
    expect(JSON.parse(file.data.mcpServers[0].original_json)).toEqual({
      command: 'npx',
      env: { MCP_KEY: '' },
      headers: { Authorization: '' },
    });
  });

  it('excludes client settings whose keys look like credentials', async () => {
    const { file } = await exportAndRead();

    expect(file.data.settings).toEqual({ system: { language: 'en-US' }, client: { theme: 'dark', fontSize: 14 } });
  });

  it('excludes token and credential client settings in any casing but keeps normal keys', async () => {
    profile.clientSettings = {
      githubToken: 'ghp_x',
      bot_token: 'bot-x',
      gh_token: 'gh-x',
      myCredential: 'cred-x',
      'theme.activeId': 'midnight',
    };

    const { file } = await exportAndRead();

    expect(file.data.settings.client).toEqual({ 'theme.activeId': 'midnight' });
  });

  it('backs up user assistants with their rule and every assistant state', async () => {
    const { file } = await exportAndRead();

    expect(file.data.assistants.user).toEqual([
      { id: 'asst-user-1', name: 'Writer', agent_id: 'agent-builtin-1', rule: 'Always be concise.' },
    ]);
    expect(file.data.assistants.state).toHaveLength(2);
  });

  it('backs up custom skill files, skipping .git and files over 1 MB', async () => {
    const { file } = await exportAndRead();

    expect(file.data.skills).toHaveLength(1);
    expect(file.data.skills[0].files.map((f: { path: string }) => f.path).sort()).toEqual([
      'SKILL.md',
      'refs/notes.md',
    ]);
  });

  it('omits accountUid when nobody is signed in', async () => {
    readStoredSession.mockRejectedValue(new Error('no session'));

    const { file } = await exportAndRead();

    expect(file).not.toHaveProperty('accountUid');
  });
});

describe('exportBackup with a password', () => {
  it('stores secrets encrypted and they decrypt to the original values', async () => {
    const { result, file } = await exportAndRead({ password: 'pw-123' });
    const secrets = await decryptSecrets(file.secrets, 'pw-123');

    expect(result).toMatchObject({ success: true, includesSecrets: true });
    expect(secrets[secretKey.provider('prov-openai')]).toMatchObject({ api_key: 'sk-fixture-openai' });
    expect(secrets[secretKey.provider('prov-bedrock')]).toMatchObject({ secret_access_key: 'fixture-secret-access' });
  });

  it('keeps agent and MCP secrets in the encrypted block', async () => {
    const { file } = await exportAndRead({ password: 'pw-123' });
    const secrets = await decryptSecrets(file.secrets, 'pw-123');

    expect(secrets[secretKey.customAgent('agent-custom-1')]).toEqual([
      { name: 'MY_TOKEN', value: 'fixture-agent-token' },
    ]);
    expect(secrets[secretKey.agentOverride('agent-builtin-1')]).toEqual([
      { name: 'OVERRIDE_KEY', value: 'fixture-override-value' },
    ]);
    expect(secrets[secretKey.mcp('user-mcp')]).toMatchObject({ transport: { env: { MCP_KEY: 'fixture-mcp-key' } } });
  });

  it('treats an empty password as no password', async () => {
    const { result } = await exportAndRead({ password: '' });

    expect(result).toMatchObject({ success: true, includesSecrets: false });
  });
});

describe('exportBackup writing', () => {
  it('writes a temp file next to the target and renames it into place', async () => {
    await exportBackup();

    const tmp = memFs.writeFile.mock.calls[0][0] as string;
    expect(tmp.startsWith(`${DEFAULT_PATH}.`) && tmp.endsWith('.tmp')).toBe(true);
    expect(memFs.rename).toHaveBeenCalledWith(tmp, DEFAULT_PATH);
    expect(memFs.mkdir).toHaveBeenCalledWith(path.dirname(DEFAULT_PATH), { recursive: true });
  });

  it('writes to a chosen path when one is given', async () => {
    const { result } = await exportAndRead({ path: '/chosen/out.pavii' });

    expect(result).toMatchObject({ success: true, path: '/chosen/out.pavii' });
  });

  it('removes the temp file and reports write-failed when the rename fails', async () => {
    memFs.rename.mockRejectedValueOnce(new Error('EPERM'));

    const result = await exportBackup();

    expect(result).toEqual({ success: false, error: 'write-failed', message: 'EPERM' });
    expect(memFs.rm).toHaveBeenCalledWith(memFs.writeFile.mock.calls[0][0], { force: true });
  });

  it('reports collect-failed and writes nothing when the engine fails', async () => {
    routes['GET /api/providers'] = () => {
      throw new Error('engine down');
    };

    const result = await exportBackup();

    expect(result).toEqual({ success: false, error: 'collect-failed', message: 'engine down' });
    expect(memFs.writeFile).not.toHaveBeenCalled();
  });
});

describe('readBackupFile', () => {
  it('accepts a valid version 1 backup', async () => {
    const result = await readBackupFile(writeBackup(validFile()));

    expect(result.ok).toBe(true);
  });

  it('rejects invalid JSON as invalid-file', async () => {
    await expect(readBackupFile(writeBackup('{not json'))).resolves.toEqual({ ok: false, error: 'invalid-file' });
  });

  it('rejects another format or missing data as invalid-file', async () => {
    await expect(readBackupFile(writeBackup(validFile({ format: 'zip' })))).resolves.toEqual({
      ok: false,
      error: 'invalid-file',
    });
    await expect(readBackupFile(writeBackup(validFile({ data: null })))).resolves.toEqual({
      ok: false,
      error: 'invalid-file',
    });
  });

  it('rejects version 2 as unsupported-version', async () => {
    await expect(readBackupFile(writeBackup(validFile({ version: 2 })))).resolves.toEqual({
      ok: false,
      error: 'unsupported-version',
    });
  });

  it('rejects a non-object secrets block as invalid-file', async () => {
    await expect(readBackupFile(writeBackup(validFile({ secrets: 'x' })))).resolves.toEqual({
      ok: false,
      error: 'invalid-file',
    });
  });

  it('reports read-failed for a missing file', async () => {
    await expect(readBackupFile('/missing.pavii')).resolves.toMatchObject({ ok: false, error: 'read-failed' });
  });
});

describe('readBackupMeta / sectionCounts', () => {
  it('summarizes createdAt, account, secrets and counts', async () => {
    const meta = await readBackupMeta(writeBackup(validFile({ accountUid: 'u1', secrets: { kdf: 'scrypt' } })));

    expect(meta).toMatchObject({ createdAt: '2026-05-01T00:00:00.000Z', accountUid: 'u1', hasSecrets: true });
    expect(meta?.counts.providers).toBe(1);
  });

  it('returns null for an invalid file', async () => {
    await expect(readBackupMeta(writeBackup('nope'))).resolves.toBeNull();
  });

  it('counts unique agent ids across custom agents and rows', () => {
    const counts = sectionCounts({
      providers: [],
      agents: { custom: [{ id: 'a' }], rows: [{ id: 'a' }, { id: 'b' }] },
      mcpServers: null,
      assistants: { user: [{ id: 'x' }] },
      skills: [],
      settings: { system: {}, client: {} },
      sessions: [{}, {}],
    });

    expect(counts).toEqual({
      providers: 0,
      agents: 2,
      mcpServers: 0,
      assistants: 1,
      skills: 0,
      settings: 2,
      sessions: 2,
    });
  });
});

describe('importBackup', () => {
  it('restores with decrypted secrets when the password is right', async () => {
    const secrets = await encryptSecrets({ 'provider:p': { api_key: 'k' } }, 'right');
    const at = writeBackup(validFile({ secrets }));

    const result = await importBackup({ path: at, password: 'right' });

    expect(result).toMatchObject({ success: true, secretsRestored: true });
    expect(restoreBackup.mock.calls[0][1]).toEqual({ 'provider:p': { api_key: 'k' } });
  });

  it('returns wrong-password and restores nothing for a wrong password', async () => {
    const secrets = await encryptSecrets({ a: 1 }, 'right');
    const at = writeBackup(validFile({ secrets }));

    const result = await importBackup({ path: at, password: 'wrong' });

    expect(result).toEqual({ success: false, error: 'wrong-password' });
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it('restores non-secret data without a password and reports secretsRestored false', async () => {
    const secrets = await encryptSecrets({ a: 1 }, 'right');
    const at = writeBackup(validFile({ secrets }));

    const result = await importBackup({ path: at });

    expect(result).toMatchObject({ success: true, secretsRestored: false });
    expect(restoreBackup.mock.calls[0][1]).toBeUndefined();
  });

  it('passes an invalid file error through without restoring', async () => {
    const result = await importBackup({ path: writeBackup(validFile({ version: 3 })) });

    expect(result).toMatchObject({ success: false, error: 'unsupported-version' });
    expect(restoreBackup).not.toHaveBeenCalled();
  });
});
