import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer, IMcpServerTransport, ISessionMcpServer } from '@/common/config/storage';
import { RECOMMENDED_TOOL_MCP_NAMES, RECOMMENDED_TOOLS } from '@/common/types/agent/recommendedTools';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';

type BackendMcpTransport = Exclude<IMcpServerTransport, { type: 'streamable_http' }>;

type BackendMcpPayload = {
  name: string;
  description?: string;
  transport: BackendMcpTransport;
  original_json: string;
  builtin?: boolean;
};

const isBuiltinServer = (server: IMcpServer) => server.builtin === true;

const normalizeServerName = (name: string) => name.trim().toLowerCase();

const getCatalogServerKey = (server: Pick<IMcpServer, 'id' | 'name' | 'builtin'>) => {
  const normalizedName = normalizeServerName(server.name);
  if (server.builtin === true) {
    return `builtin:${normalizedName || server.id}`;
  }
  return `user:${normalizedName || server.id}`;
};

const dedupeServers = (servers: IMcpServer[]) => {
  const seen = new Set<string>();
  const deduped: IMcpServer[] = [];

  for (const server of servers) {
    const key = getCatalogServerKey(server);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(server);
  }

  return deduped;
};

const normalizeTransportForBackend = (transport: IMcpServerTransport): BackendMcpTransport => {
  if (transport.type === 'streamable_http') {
    return {
      type: 'http',
      url: transport.url,
      headers: transport.headers,
    };
  }
  return transport;
};

export const toBackendMcpPayload = (
  server: Pick<IMcpServer, 'name' | 'description' | 'transport' | 'original_json' | 'builtin'>
): BackendMcpPayload => ({
  name: server.name,
  description: server.description,
  transport: normalizeTransportForBackend(server.transport),
  original_json: server.original_json || '{}',
  builtin: Boolean(server.builtin),
});

/** Builtin code-map rows whose wrapper takes the conversation workspace as its last argument. */
const WORKSPACE_ARG_MCP_NAMES = new Set(
  RECOMMENDED_TOOLS.filter((tool) => tool.codeBaseOnly).map((tool) => tool.mcpServerName)
);

/**
 * Session snapshot of an MCP row. The engine passes a session MCP server no
 * workspace, so for the builtin code-map rows (`pavii-code-map`, `pavii-graph`)
 * a custom workspace is appended to the stdio args.
 */
export const toSessionMcpServer = (
  server: Pick<IMcpServer, 'id' | 'name' | 'transport'> & { builtin?: boolean },
  customWorkspace?: string
): ISessionMcpServer => {
  const { transport } = server;
  const appendWorkspace =
    customWorkspace &&
    server.builtin === true &&
    WORKSPACE_ARG_MCP_NAMES.has(server.name) &&
    transport.type === 'stdio';
  return {
    id: server.id,
    name: server.name,
    transport: appendWorkspace ? { ...transport, args: [...(transport.args ?? []), customWorkspace] } : transport,
  };
};

const PAVII_TOOL_MCP_NAMES = new Set(RECOMMENDED_TOOL_MCP_NAMES);

/**
 * Add every enabled builtin Pavii agent tool row (Code Map, Compress, Graph,
 * Search) to a new chat's session MCP servers, whatever the user or assistant
 * selected. A row already in `selected` (same id or name) is not added twice.
 * Turning a tool off in Settings → Tools disables its row, so it joins no chat.
 */
export const withPaviiToolSessionServers = (
  selected: ISessionMcpServer[],
  available: IMcpServer[],
  customWorkspace?: string
): ISessionMcpServer[] => {
  const ids = new Set(selected.map((server) => server.id));
  const names = new Set(selected.map((server) => server.name));
  const added = available
    .filter(
      (server) =>
        server.builtin === true &&
        server.enabled &&
        PAVII_TOOL_MCP_NAMES.has(server.name) &&
        !ids.has(server.id) &&
        !names.has(server.name)
    )
    .filter((server, index, list) => list.findIndex((other) => other.name === server.name) === index)
    .map((server) => toSessionMcpServer(server, customWorkspace));
  return added.length > 0 ? [...selected, ...added] : selected;
};

export const ensureBackendMcpCatalog = async (): Promise<{
  userServers: IMcpServer[];
  builtinServers: IMcpServer[];
  allServers: IMcpServer[];
}> => {
  const localServers = ((await getClientBusinessSetting('mcp.config').catch((): IMcpServer[] => [])) ||
    []) as IMcpServer[];
  const builtinServers = dedupeServers(localServers.filter(isBuiltinServer));
  const userServers = dedupeServers(await mcpService.listServers.invoke());

  const allServers = dedupeServers([...userServers, ...builtinServers]);

  return {
    userServers,
    builtinServers,
    allServers,
  };
};
