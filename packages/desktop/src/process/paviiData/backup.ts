/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The portable `*.pavii` backup: collects the user's providers, agents, MCP
 * servers, assistants, skills, settings and session index from the engine,
 * and writes/reads the file. Secrets go into a separate map that is only
 * stored when encrypted with a password (see `crypto.ts`); restoring lives in
 * `backupRestore.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type {
  ExportBackupResult,
  ImportBackupResult,
  PaviiBackupFile,
  PaviiBackupSection,
} from '@/common/types/agent/paviiData';
import { decryptSecrets, encryptSecrets, WrongPasswordError } from './crypto';
import { asArray, describeError, engine, isRecord } from './engineApi';

export const BACKUP_FORMAT = 'pavii-backup';
export const BACKUP_VERSION = 1;
const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 5 * 1024 * 1024;
const SKIPPED_SKILL_DIRS = new Set(['.git', 'node_modules']);
/**
 * Client-setting keys that may hold credentials are never backed up. Any name
 * containing "token" is excluded (githubToken, bot_token, ...): losing a
 * harmless setting on restore beats writing a credential in plain text.
 */
const SENSITIVE_KEY_PATTERN = /api[_-]?key|authorization|token|secret|password|credential/i;

type EnvEntry = { name: string; value: string; description?: string };

export type BackupCustomAgent = {
  id: string;
  name: string;
  command: string;
  icon?: string;
  args?: string[];
  env: EnvEntry[];
  advanced: Record<string, unknown>;
};
export type BackupAgentRow = {
  id: string;
  enabled: boolean;
  linked_provider_id: string | null;
  overrides?: { command_override?: string; env_override: EnvEntry[] };
};
export type BackupAgents = { custom: BackupCustomAgent[]; rows: BackupAgentRow[] };
export type BackupMcpServer = {
  name: string;
  description?: string;
  enabled: boolean;
  transport: Record<string, unknown>;
  original_json: string;
};
export type BackupAssistants = {
  /** User-created assistants in `CreateAssistantRequest` shape, plus their rule text. */
  user: Array<Record<string, unknown> & { id: string; rule?: string }>;
  state: Array<{ id: string; enabled: boolean; sort_order: number }>;
};
export type BackupSkill = { name: string; files: Array<{ path: string; base64: string }> };
export type BackupSettings = { system: Record<string, unknown>; client: Record<string, unknown> };

export type BackupData = {
  providers: Array<Record<string, unknown> & { id: string }>;
  agents: BackupAgents;
  mcpServers: BackupMcpServer[];
  assistants: BackupAssistants;
  skills: BackupSkill[];
  settings: BackupSettings;
  sessions: unknown[];
};

/** Keys of the secrets map. */
export const secretKey = {
  provider: (id: string) => `provider:${id}`,
  agentOverride: (id: string) => `agentOverride:${id}`,
  customAgent: (id: string) => `customAgent:${id}`,
  mcp: (name: string) => `mcp:${name}`,
};

export const getDefaultBackupPath = (): string => path.join(app.getPath('documents'), 'Pavii', 'backup.pavii');

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const blankEnv = (env: EnvEntry[]): EnvEntry[] => env.map((entry) => ({ ...entry, value: '' }));
const toEnv = (value: unknown): EnvEntry[] =>
  asArray(value)
    .filter(isRecord)
    .filter((entry) => typeof entry.name === 'string')
    .map((entry) => ({
      name: entry.name as string,
      value: str(entry.value) ?? '',
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
    }));

/** Replace every value of `env` / `headers` maps (at any depth) with ''. */
export function blankSecretMaps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(blankSecretMaps);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if ((key === 'env' || key === 'headers') && isRecord(entry)) {
        return [key, Object.fromEntries(Object.keys(entry).map((name) => [name, '']))];
      }
      return [key, blankSecretMaps(entry)];
    })
  );
}

const blankOriginalJson = (raw: string): string => {
  try {
    return JSON.stringify(blankSecretMaps(JSON.parse(raw)));
  } catch {
    return '';
  }
};

async function collectProviders(secrets: Record<string, unknown>): Promise<BackupData['providers']> {
  const providers = asArray(await engine.get<unknown>('/api/providers')).filter(isRecord);
  return providers
    .filter((provider) => typeof provider.id === 'string')
    .map((provider) => {
      const id = provider.id as string;
      const { api_key: apiKey, model_health: _health, ...rest } = provider;
      const bedrock = isRecord(rest.bedrock_config) ? rest.bedrock_config : undefined;
      secrets[secretKey.provider(id)] = {
        api_key: str(apiKey) ?? '',
        access_key_id: str(bedrock?.access_key_id),
        secret_access_key: str(bedrock?.secret_access_key),
      };
      if (!bedrock) return { ...rest, id };
      const { access_key_id: _keyId, secret_access_key: _secret, ...bedrockConfig } = bedrock;
      return { ...rest, id, bedrock_config: bedrockConfig };
    });
}

async function collectAgents(secrets: Record<string, unknown>): Promise<BackupAgents> {
  const rows = asArray(await engine.get<unknown>('/api/agents/management')).filter(isRecord);
  const custom: BackupCustomAgent[] = [];
  const kept: BackupAgentRow[] = [];
  for (const row of rows) {
    if (typeof row.id !== 'string') continue;
    const id = row.id;
    if (row.agent_source === 'custom' && typeof row.command === 'string') {
      const env = toEnv(row.env);
      secrets[secretKey.customAgent(id)] = env;
      custom.push({
        id,
        name: str(row.name) ?? id,
        command: row.command,
        icon: str(row.icon),
        args: asArray(row.args).filter((arg): arg is string => typeof arg === 'string'),
        env: blankEnv(env),
        advanced: {
          yolo_id: str(row.yolo_id),
          native_skills_dirs: Array.isArray(row.native_skills_dirs) ? row.native_skills_dirs : undefined,
          behavior_policy: isRecord(row.behavior_policy) ? row.behavior_policy : undefined,
          description: str(row.description),
        },
      });
    }
    const hasOverrides = row.has_command_override === true || (Number(row.env_override_key_count) || 0) > 0;
    const linked = str(row.linked_provider_id) ?? null;
    const enabled = row.enabled !== false;
    if (!hasOverrides && !linked && enabled) continue;
    const entry: BackupAgentRow = { id, enabled, linked_provider_id: linked };
    if (hasOverrides) {
      const overrides = await engine.get<unknown>(`/api/agents/${encodeURIComponent(id)}/overrides`);
      if (isRecord(overrides)) {
        const envOverride = toEnv(overrides.env_override);
        secrets[secretKey.agentOverride(id)] = envOverride;
        entry.overrides = { command_override: str(overrides.command_override), env_override: blankEnv(envOverride) };
      }
    }
    kept.push(entry);
  }
  return { custom, rows: kept };
}

async function collectMcpServers(secrets: Record<string, unknown>): Promise<BackupMcpServer[]> {
  const servers = asArray(await engine.get<unknown>('/api/mcp/servers')).filter(isRecord);
  return servers
    .filter((server) => server.builtin === false && typeof server.name === 'string' && isRecord(server.transport))
    .map((server) => {
      const name = server.name as string;
      const transport = server.transport as Record<string, unknown>;
      const originalJson = str(server.original_json) ?? '';
      secrets[secretKey.mcp(name)] = { transport, original_json: originalJson };
      return {
        name,
        description: str(server.description),
        enabled: server.enabled !== false,
        transport: blankSecretMaps(transport) as Record<string, unknown>,
        original_json: blankOriginalJson(originalJson),
      };
    });
}

const ASSISTANT_REQUEST_KEYS = [
  'id',
  'name',
  'description',
  'avatar',
  'agent_id',
  'enabled_skills',
  'custom_skill_names',
  'disabled_builtin_skills',
  'prompts',
  'models',
  'name_i18n',
  'description_i18n',
  'prompts_i18n',
] as const;

async function collectAssistants(): Promise<BackupAssistants> {
  const assistants = asArray(await engine.get<unknown>('/api/assistants')).filter(isRecord);
  const user: BackupAssistants['user'] = [];
  const state: BackupAssistants['state'] = [];
  for (const assistant of assistants) {
    if (typeof assistant.id !== 'string') continue;
    state.push({
      id: assistant.id,
      enabled: assistant.enabled !== false,
      sort_order: Number(assistant.sort_order) || 0,
    });
    if (assistant.source !== 'user') continue;
    const request: Record<string, unknown> = { id: assistant.id };
    for (const key of ASSISTANT_REQUEST_KEYS) {
      if (assistant[key] !== undefined && assistant[key] !== null) request[key] = assistant[key];
    }
    const rule = await engine
      .post<unknown>('/api/skills/assistant-rule/read', { assistant_id: assistant.id })
      .catch((): undefined => undefined);
    if (typeof rule === 'string' && rule) request.rule = rule;
    user.push(request as BackupAssistants['user'][number]);
  }
  return { user, state };
}

/** Files of one skill folder, base64, skipping files over 1 MB and stopping at the shared 5 MB budget. */
async function readSkillFiles(root: string, budget: { left: number }): Promise<BackupSkill['files']> {
  const files: BackupSkill['files'] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_SKILL_DIRS.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const { size } = await fs.promises.stat(full);
        if (size > MAX_SKILL_FILE_BYTES || size > budget.left) continue;
        const content = await fs.promises.readFile(full);
        budget.left -= size;
        files.push({ path: path.relative(root, full).split(path.sep).join('/'), base64: content.toString('base64') });
      } catch {
        // unreadable file: leave it out
      }
    }
  };
  await walk(root);
  return files;
}

async function collectSkills(): Promise<BackupSkill[]> {
  const skills = asArray(await engine.get<unknown>('/api/skills')).filter(isRecord);
  const budget = { left: MAX_SKILL_TOTAL_BYTES };
  const result: BackupSkill[] = [];
  for (const skill of skills) {
    if (skill.source !== 'custom' || typeof skill.name !== 'string' || typeof skill.location !== 'string') continue;
    const location = skill.location;
    const root = path.basename(location).toLowerCase() === 'skill.md' ? path.dirname(location) : location;
    const files = await readSkillFiles(root, budget);
    if (files.length > 0) result.push({ name: skill.name, files });
  }
  return result;
}

async function collectSettings(): Promise<BackupSettings> {
  const [system, client] = await Promise.all([
    engine.get<unknown>('/api/settings'),
    engine.get<unknown>('/api/settings/client'),
  ]);
  const clientEntries = isRecord(client)
    ? Object.entries(client).filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
    : [];
  return { system: isRecord(system) ? system : {}, client: Object.fromEntries(clientEntries) };
}

/** Everything a backup holds; `secrets` receives the values left out of `data`. */
export async function collectBackup(): Promise<{ data: BackupData; secrets: Record<string, unknown> }> {
  const secrets: Record<string, unknown> = {};
  const [providers, agents, mcpServers, assistants, skills, settings, sessions] = await Promise.all([
    collectProviders(secrets),
    collectAgents(secrets),
    collectMcpServers(secrets),
    collectAssistants(),
    collectSkills(),
    collectSettings(),
    engine.get<unknown>('/api/conversations/sessions-index').then(asArray),
  ]);
  return { data: { providers, agents, mcpServers, assistants, skills, settings, sessions }, secrets };
}

/** Item counts per section, for the restore dialog. */
export function sectionCounts(data: Record<PaviiBackupSection, unknown>): Partial<Record<PaviiBackupSection, number>> {
  const agents = isRecord(data.agents) ? data.agents : {};
  const agentIds = new Set(
    [...asArray(agents.custom), ...asArray(agents.rows)].filter(isRecord).map((agent) => String(agent.id))
  );
  const assistants = isRecord(data.assistants) ? data.assistants : {};
  const settings = isRecord(data.settings) ? data.settings : {};
  return {
    providers: asArray(data.providers).length,
    agents: agentIds.size,
    mcpServers: asArray(data.mcpServers).length,
    assistants: asArray(assistants.user).length,
    skills: asArray(data.skills).length,
    settings: (isRecord(settings.system) ? 1 : 0) + (isRecord(settings.client) ? 1 : 0),
    sessions: asArray(data.sessions).length,
  };
}

/** Pavii account uid of the signed-in user, if any. */
export async function readAccountUid(): Promise<string | undefined> {
  const [{ readStoredSession }, { getConfigPath }] = await Promise.all([
    import('../services/paviiAuth'),
    import('../utils/utils'),
  ]);
  return (await readStoredSession(getConfigPath()))?.uid;
}

/** Write `content` to `target` through a temp file + rename, creating the folder. */
async function writeAtomic(target: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tmp, content, 'utf8');
    await fs.promises.rename(tmp, target);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch((): void => undefined);
    throw error;
  }
}

/** Collect and write a backup; secrets are included only when `password` is non-empty. */
export async function exportBackup(params: { path?: string; password?: string } = {}): Promise<ExportBackupResult> {
  const target = params.path || getDefaultBackupPath();
  const password = params.password || undefined;
  let file: PaviiBackupFile;
  try {
    const { data, secrets } = await collectBackup();
    const accountUid = await readAccountUid().catch((): undefined => undefined);
    file = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      appVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
      ...(accountUid ? { accountUid } : {}),
      data,
      ...(password ? { secrets: await encryptSecrets(secrets, password) } : {}),
    };
  } catch (error) {
    return { success: false, error: 'collect-failed', message: describeError(error) };
  }
  try {
    await writeAtomic(target, `${JSON.stringify(file, null, 2)}\n`);
  } catch (error) {
    return { success: false, error: 'write-failed', message: describeError(error) };
  }
  return { success: true, path: target, includesSecrets: Boolean(file.secrets) };
}

type ReadBackupResult =
  | { ok: true; file: PaviiBackupFile }
  | { ok: false; error: 'invalid-file' | 'unsupported-version' | 'read-failed'; message?: string };

/** Read and validate a backup file. */
export async function readBackupFile(filePath: string): Promise<ReadBackupResult> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    return { ok: false, error: 'read-failed', message: describeError(error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid-file' };
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !isRecord(parsed.data)) {
    return { ok: false, error: 'invalid-file' };
  }
  if (parsed.version !== BACKUP_VERSION) return { ok: false, error: 'unsupported-version' };
  if (parsed.secrets !== undefined && !isRecord(parsed.secrets)) return { ok: false, error: 'invalid-file' };
  return { ok: true, file: parsed as unknown as PaviiBackupFile };
}

/** Summary of a backup file without restoring it; null when it is missing or invalid. */
export async function readBackupMeta(filePath: string): Promise<{
  createdAt: string;
  accountUid?: string;
  hasSecrets: boolean;
  counts: Partial<Record<PaviiBackupSection, number>>;
} | null> {
  const result = await readBackupFile(filePath);
  if (result.ok === false) return null;
  const { file } = result;
  return {
    createdAt: file.createdAt,
    accountUid: file.accountUid,
    hasSecrets: Boolean(file.secrets),
    counts: sectionCounts(file.data),
  };
}

/**
 * Restore a backup. Secrets are restored only with the right password;
 * without one everything else is restored and `secretsRestored` is false.
 */
export async function importBackup(params: { path: string; password?: string }): Promise<ImportBackupResult> {
  const read = await readBackupFile(params.path);
  if (read.ok === false) return { success: false, error: read.error, message: read.message };
  const { file } = read;
  let secrets: Record<string, unknown> | undefined;
  if (file.secrets && params.password) {
    try {
      secrets = await decryptSecrets(file.secrets, params.password);
    } catch (error) {
      if (error instanceof WrongPasswordError) return { success: false, error: 'wrong-password' };
      return { success: false, error: 'invalid-file', message: describeError(error) };
    }
  }
  const { restoreBackup } = await import('./backupRestore');
  const summary = await restoreBackup(file.data, secrets);
  return { success: true, summary, secretsRestored: Boolean(secrets) };
}
