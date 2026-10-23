/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Restores the sections of a `.pavii` backup through the engine routes, in
 * dependency order: providers → custom agents (old id → new id) → agent
 * overrides / enabled / provider links → MCP servers → assistants → skills →
 * settings. Items that already exist are skipped, never overwritten.
 * Session entries are informational only and are just counted.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PaviiBackupSection, PaviiBackupSectionSummary } from '@/common/types/agent/paviiData';
import { secretKey } from './backup';
import { asArray, engine, isRecord, sensitiveRequest } from './engineApi';

type Secrets = Record<string, unknown> | undefined;
type Counter = { restored: number; skipped: number; failed: number };

const newCounter = (): Counter => ({ restored: 0, skipped: 0, failed: 0 });
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const records = (value: unknown): Record<string, unknown>[] => asArray(value).filter(isRecord);
const idsOf = (rows: Record<string, unknown>[], key = 'id'): Set<string> =>
  new Set(rows.map((row) => row[key]).filter((value): value is string => typeof value === 'string'));

async function restoreProviders(section: unknown, secrets: Secrets): Promise<Counter> {
  const counter = newCounter();
  const existing = idsOf(records(await engine.get<unknown>('/api/providers')));
  for (const provider of records(section)) {
    const id = str(provider.id);
    if (!id || existing.has(id)) {
      counter.skipped += 1;
      continue;
    }
    const secret = isRecord(secrets?.[secretKey.provider(id)])
      ? (secrets[secretKey.provider(id)] as Record<string, unknown>)
      : {};
    const apiKey = str(secret.api_key) ?? '';
    // The engine requires an API key for every platform except Bedrock, so a
    // provider backed up without its key cannot be recreated.
    if (provider.platform !== 'bedrock' && !apiKey.trim()) {
      counter.failed += 1;
      continue;
    }
    const body: Record<string, unknown> = { ...provider, api_key: apiKey };
    if (isRecord(provider.bedrock_config)) {
      body.bedrock_config = {
        ...provider.bedrock_config,
        access_key_id: str(secret.access_key_id),
        secret_access_key: str(secret.secret_access_key),
      };
    }
    try {
      await sensitiveRequest<unknown>('POST', '/api/providers', body);
      counter.restored += 1;
    } catch {
      counter.failed += 1;
    }
  }
  return counter;
}

const envFromSecrets = (secrets: Secrets, key: string, fallback: unknown): unknown =>
  Array.isArray(secrets?.[key]) ? secrets[key] : fallback;

async function restoreAgents(section: unknown, secrets: Secrets): Promise<Counter> {
  const counter = newCounter();
  const agents = isRecord(section) ? section : {};
  const current = records(await engine.get<unknown>('/api/agents/management'));
  const idMap = new Map<string, string>();

  for (const agent of records(agents.custom)) {
    const oldId = str(agent.id);
    const name = str(agent.name);
    const command = str(agent.command);
    if (!oldId || !name || !command) {
      counter.failed += 1;
      continue;
    }
    const twin = current.find((row) => row.agent_source === 'custom' && row.name === name && row.command === command);
    if (twin && typeof twin.id === 'string') {
      idMap.set(oldId, twin.id);
      counter.skipped += 1;
      continue;
    }
    try {
      const created = await sensitiveRequest<unknown>('POST', '/api/agents/custom', {
        name,
        command,
        icon: agent.icon,
        args: agent.args,
        env: envFromSecrets(secrets, secretKey.customAgent(oldId), agent.env),
        advanced: agent.advanced,
      });
      if (isRecord(created) && typeof created.id === 'string') idMap.set(oldId, created.id);
      counter.restored += 1;
    } catch {
      counter.failed += 1;
    }
  }

  const known = idsOf(records(await engine.get<unknown>('/api/agents/management')));
  const providers = idsOf(records(await engine.get<unknown>('/api/providers')));
  for (const row of records(agents.rows)) {
    const oldId = str(row.id);
    const id = oldId ? (idMap.get(oldId) ?? oldId) : undefined;
    if (!oldId || !id || !known.has(id)) {
      counter.skipped += 1;
      continue;
    }
    const base = `/api/agents/${encodeURIComponent(id)}`;
    try {
      const overrides = isRecord(row.overrides) ? row.overrides : undefined;
      const envOverride = secrets ? envFromSecrets(secrets, secretKey.agentOverride(oldId), undefined) : undefined;
      const commandOverride = str(overrides?.command_override);
      if (overrides && (commandOverride || envOverride)) {
        await sensitiveRequest<unknown>('PUT', `${base}/overrides`, {
          command_override: commandOverride,
          ...(envOverride ? { env_override: envOverride } : {}),
        });
      }
      if (row.enabled === false) await engine.patch<unknown>(`${base}/enabled`, { enabled: false });
      const linked = str(row.linked_provider_id);
      if (linked && providers.has(linked)) await engine.put<unknown>(`${base}/provider-link`, { provider_id: linked });
      counter.restored += 1;
    } catch {
      counter.failed += 1;
    }
  }
  return counter;
}

async function restoreMcpServers(section: unknown, secrets: Secrets): Promise<Counter> {
  const counter = newCounter();
  const existing = idsOf(records(await engine.get<unknown>('/api/mcp/servers')), 'name');
  const servers: Record<string, unknown>[] = [];
  for (const server of records(section)) {
    const name = str(server.name);
    if (!name || existing.has(name)) {
      counter.skipped += 1;
      continue;
    }
    const secret = secrets?.[secretKey.mcp(name)];
    const full = isRecord(secret) ? secret : undefined;
    servers.push({
      name,
      description: server.description,
      enabled: server.enabled,
      transport: isRecord(full?.transport) ? full.transport : server.transport,
      original_json: str(full?.original_json) ?? server.original_json,
      builtin: false,
    });
  }
  if (servers.length === 0) return counter;
  try {
    await sensitiveRequest<unknown>('POST', '/api/mcp/servers/import', { servers });
    counter.restored += servers.length;
  } catch {
    counter.failed += servers.length;
  }
  return counter;
}

async function restoreAssistants(section: unknown): Promise<Counter> {
  const counter = newCounter();
  const assistants = isRecord(section) ? section : {};
  const existing = idsOf(records(await engine.get<unknown>('/api/assistants')));
  const missing = records(assistants.user).filter((assistant) => {
    const isNew = typeof assistant.id === 'string' && !existing.has(assistant.id);
    if (!isNew) counter.skipped += 1;
    return isNew;
  });
  if (missing.length > 0) {
    try {
      const requests = missing.map(({ rule: _rule, ...request }) => request);
      const result = await engine.post<unknown>('/api/assistants/import', { assistants: requests });
      if (isRecord(result)) {
        counter.restored += Number(result.imported) || 0;
        counter.skipped += Number(result.skipped) || 0;
        counter.failed += Number(result.failed) || 0;
      }
    } catch {
      counter.failed += missing.length;
    }
  }
  const nowKnown = idsOf(records(await engine.get<unknown>('/api/assistants')));
  for (const assistant of missing) {
    const id = assistant.id as string;
    if (typeof assistant.rule !== 'string' || !nowKnown.has(id)) continue;
    await engine
      .post<unknown>('/api/skills/assistant-rule/write', { assistant_id: id, content: assistant.rule })
      .catch(() => {
        counter.failed += 1;
      });
  }
  for (const state of records(assistants.state)) {
    const id = str(state.id);
    if (!id || !nowKnown.has(id)) continue;
    await engine
      .patch<unknown>(`/api/assistants/${encodeURIComponent(id)}/state`, {
        enabled: state.enabled,
        sort_order: state.sort_order,
      })
      .catch(() => {
        counter.failed += 1;
      });
  }
  return counter;
}

/** Write a skill's files under `dir`, refusing paths that escape it. */
async function writeSkillFiles(dir: string, files: Record<string, unknown>[]): Promise<void> {
  for (const file of files) {
    const relative = str(file.path);
    const base64 = str(file.base64);
    if (!relative || base64 === undefined) continue;
    const target = path.resolve(dir, relative);
    if (!target.startsWith(dir + path.sep)) continue;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, Buffer.from(base64, 'base64'));
  }
}

async function restoreSkills(section: unknown): Promise<Counter> {
  const counter = newCounter();
  const existing = idsOf(records(await engine.get<unknown>('/api/skills')), 'name');
  for (const skill of records(section)) {
    const name = str(skill.name);
    if (!name || existing.has(name)) {
      counter.skipped += 1;
      continue;
    }
    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pavii-skill-'));
    const dir = path.join(tmpRoot, name.replace(/[^\w.-]/g, '_'));
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await writeSkillFiles(dir, records(skill.files));
      const result = await engine.post<unknown>('/api/skills/import', { skill_path: dir });
      const failed = isRecord(result) ? asArray(result.failed).length : 0;
      if (failed > 0) counter.failed += 1;
      else counter.restored += 1;
    } catch {
      counter.failed += 1;
    } finally {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch((): void => undefined);
    }
  }
  return counter;
}

async function restoreSettings(section: unknown): Promise<Counter> {
  const counter = newCounter();
  const settings = isRecord(section) ? section : {};
  if (isRecord(settings.client) && Object.keys(settings.client).length > 0) {
    await engine
      .put<unknown>('/api/settings/client', settings.client)
      .then(() => {
        counter.restored += 1;
      })
      .catch(() => {
        counter.failed += 1;
      });
  }
  if (isRecord(settings.system) && Object.keys(settings.system).length > 0) {
    await engine
      .patch<unknown>('/api/settings', settings.system)
      .then(() => {
        counter.restored += 1;
      })
      .catch(() => {
        counter.failed += 1;
      });
  }
  return counter;
}

/** Restore every section; a section that cannot even be listed counts as one failure. */
export async function restoreBackup(
  data: Record<PaviiBackupSection, unknown>,
  secrets: Secrets
): Promise<PaviiBackupSectionSummary[]> {
  const steps: Array<[PaviiBackupSection, () => Promise<Counter>]> = [
    ['providers', () => restoreProviders(data.providers, secrets)],
    ['agents', () => restoreAgents(data.agents, secrets)],
    ['mcpServers', () => restoreMcpServers(data.mcpServers, secrets)],
    ['assistants', () => restoreAssistants(data.assistants)],
    ['skills', () => restoreSkills(data.skills)],
    ['settings', () => restoreSettings(data.settings)],
    ['sessions', () => Promise.resolve({ restored: 0, skipped: asArray(data.sessions).length, failed: 0 })],
  ];
  const summary: PaviiBackupSectionSummary[] = [];
  for (const [section, run] of steps) {
    try {
      summary.push({ section, ...(await run()) });
    } catch (error) {
      console.warn(`[PaviiData] restoring ${section} failed:`, error instanceof Error ? error.message : error);
      summary.push({ section, restored: 0, skipped: 0, failed: 1 });
    }
  }
  return summary;
}
