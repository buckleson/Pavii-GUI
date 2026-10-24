/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Tools state of the Pavii agent tools (installed, installing,
 * last error, on/off) and the on/off switch. "On" is the tool's builtin MCP
 * row being enabled: enabled rows join every new chat, disabled rows join
 * none. Turning a tool off keeps its installed files.
 */

import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer } from '@/common/config/storage';
import {
  RECOMMENDED_TOOLS,
  type RecommendedToolId,
  type RecommendedToolStatus,
} from '@/common/types/agent/recommendedTools';
import { getInstallingToolIds, getInstallRecords } from './install';
import { getRecommendedToolStatus } from './status';

const listServers = async (): Promise<IMcpServer[]> => {
  try {
    return (await mcpService.listServers.invoke()) ?? [];
  } catch (error) {
    console.warn('[RecommendedTools] listing MCP rows failed:', error);
    return [];
  }
};

const findRow = (servers: IMcpServer[], name: string): IMcpServer | undefined =>
  servers.find((server) => server.builtin === true && server.name === name);

/** Status of each tool with the running install, the last failed attempt and the MCP row switch. */
export async function getRecommendedToolStates(): Promise<RecommendedToolStatus[]> {
  const [records, servers] = await Promise.all([getInstallRecords(), listServers()]);
  const installing = new Set(getInstallingToolIds());
  return getRecommendedToolStatus().map((status) => {
    const tool = RECOMMENDED_TOOLS.find((candidate) => candidate.id === status.id);
    const record = records[status.id];
    const lastError = !status.installed && record && !record.success ? (record.error ?? 'command-failed') : undefined;
    const row = tool ? findRow(servers, tool.mcpServerName) : undefined;
    return {
      ...status,
      installing: installing.has(status.id),
      enabled: status.installed && row?.enabled === true,
      ...(lastError ? { lastError } : {}),
    };
  });
}

/**
 * Turn a tool on or off for all chats by toggling its builtin MCP row. A tool
 * that is not installed cannot be turned on; a missing row is a no-op.
 */
export async function setRecommendedToolEnabled(id: RecommendedToolId, enabled: boolean): Promise<void> {
  const tool = RECOMMENDED_TOOLS.find((candidate) => candidate.id === id);
  if (!tool) return;
  if (enabled && !getRecommendedToolStatus().find((status) => status.id === id)?.installed) return;
  const row = findRow(await listServers(), tool.mcpServerName);
  if (!row || row.enabled === enabled) return;
  await mcpService.toggleServer.invoke({ id: row.id });
}
