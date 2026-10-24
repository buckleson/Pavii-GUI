import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GEN_ENV_KEYS } from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type IProvider } from '@/common/config/storage';
import { RECOMMENDED_TOOLS_ENV } from '@/common/types/agent/recommendedTools';
import { resolveImageGenerationMigrationConfig, runBackendMigrations } from '@/process/utils/runBackendMigrations';

const {
  batchImportServersMock,
  configFileGetMock,
  configFileSetMock,
  httpRequestMock,
  listServersMock,
  testMcpConnectionMock,
  updateServerMock,
  toggleServerMock,
  getRecommendedToolStatusMock,
  getDataPathMock,
  onRecommendedToolsInstalledMock,
  migrateAssistantsToBackendMock,
} = vi.hoisted(() => ({
  batchImportServersMock: vi.fn(),
  configFileGetMock: vi.fn(),
  configFileSetMock: vi.fn(),
  httpRequestMock: vi.fn(),
  listServersMock: vi.fn(),
  testMcpConnectionMock: vi.fn(),
  updateServerMock: vi.fn(),
  toggleServerMock: vi.fn(),
  getRecommendedToolStatusMock: vi.fn(),
  getDataPathMock: vi.fn(),
  onRecommendedToolsInstalledMock: vi.fn(),
  migrateAssistantsToBackendMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    listServers: { invoke: listServersMock },
    batchImportServers: { invoke: batchImportServersMock },
    updateServer: { invoke: updateServerMock },
    testMcpConnection: { invoke: testMcpConnectionMock },
    toggleServer: { invoke: toggleServerMock },
  },
}));

vi.mock('@/common/config/configMigration', () => ({
  migrateConfigStorage: vi.fn().mockResolvedValue(undefined),
  migrateLegacyMcpConfigToDb: vi.fn().mockResolvedValue(undefined),
  migrateProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/process/utils/initStorage', () => ({
  getBuiltinMcpScriptPath: (name: string) => `/mock/${name}.js`,
}));

vi.mock('@/process/utils/migrateAssistants', () => ({
  migrateAssistantsToBackend: migrateAssistantsToBackendMock,
}));

vi.mock('@/process/utils/utils', () => ({
  getDataPath: getDataPathMock,
}));

vi.mock('@process/agentCli/recommendedTools/status', () => ({
  getRecommendedToolStatus: getRecommendedToolStatusMock,
}));

vi.mock('@process/agentCli/recommendedTools/install', () => ({
  onRecommendedToolsInstalled: onRecommendedToolsInstalledMock,
}));

const provider: IProvider = {
  id: 'provider-1',
  platform: 'gemini',
  name: 'Gemini',
  base_url: 'https://generativelanguage.googleapis.com',
  api_key: 'provider-key',
  models: ['gemini-image'],
  enabled: true,
};

const imageEnv = {
  [IMAGE_GEN_ENV_KEYS.providerId]: 'provider-1',
  [IMAGE_GEN_ENV_KEYS.platform]: 'gemini',
  [IMAGE_GEN_ENV_KEYS.baseUrl]: 'https://generativelanguage.googleapis.com',
  [IMAGE_GEN_ENV_KEYS.apiKey]: 'provider-key',
  [IMAGE_GEN_ENV_KEYS.model]: 'gemini-image',
};

const imageServer = (): IMcpServer => ({
  id: 'image-server-id',
  name: BUILTIN_IMAGE_GEN_NAME,
  description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
  enabled: true,
  builtin: true,
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/mock/builtin-mcp-image-gen.js'],
    env: imageEnv,
  },
  created_at: 1,
  updated_at: 1,
  original_json: JSON.stringify(
    {
      mcpServers: {
        [BUILTIN_IMAGE_GEN_NAME]: {
          command: 'node',
          args: ['/mock/builtin-mcp-image-gen.js'],
          env: imageEnv,
        },
      },
    },
    null,
    2
  ),
});

const configFile = {
  get: configFileGetMock,
  set: configFileSetMock,
};

beforeEach(() => {
  vi.clearAllMocks();
  configFileGetMock.mockResolvedValue(undefined);
  configFileSetMock.mockResolvedValue(undefined);
  batchImportServersMock.mockResolvedValue([]);
  toggleServerMock.mockResolvedValue(undefined);
  migrateAssistantsToBackendMock.mockResolvedValue(true);
  getDataPathMock.mockReturnValue('/mock-data');
  getRecommendedToolStatusMock.mockReturnValue([
    { id: 'trail', installed: false },
    { id: 'headroom', installed: false },
    { id: 'graphify', installed: false },
  ]);
  onRecommendedToolsInstalledMock.mockReturnValue(() => {});
  updateServerMock.mockImplementation(async ({ id, data }) => ({
    ...imageServer(),
    id,
    ...data,
  }));
  testMcpConnectionMock.mockResolvedValue({ success: false, error: 'Command not found: npx' });
  httpRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/settings/client') {
      return {
        'tools.imageGenerationModel': {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
        },
      };
    }
    if (method === 'GET' && path === '/api/providers') {
      return [provider];
    }
    return undefined;
  });
});

describe('resolveImageGenerationMigrationConfig', () => {
  it('uses backend client preference when local config file no longer has the image model', () => {
    const backendConfig = {
      id: 'gemini',
      name: 'Gemini',
      platform: 'gemini',
      base_url: 'https://example.test',
      api_key: 'backend-key',
      use_model: 'gemini-image',
    };

    expect(resolveImageGenerationMigrationConfig({ 'tools.imageGenerationModel': backendConfig }, undefined)).toEqual(
      backendConfig
    );
  });
});

describe('runBackendMigrations', () => {
  it('does not write image generation business config back to local config storage', async () => {
    listServersMock.mockResolvedValue([imageServer()]);
    configFileGetMock.mockImplementation(async (key: string) => {
      if (key === 'tools.imageGenerationModel') {
        return {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
          switch: true,
        };
      }
      return undefined;
    });
    httpRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return {};
      }
      if (method === 'GET' && path === '/api/providers') {
        return [provider];
      }
      return undefined;
    });

    await runBackendMigrations(configFile as never);

    expect(configFileSetMock).not.toHaveBeenCalledWith('tools.imageGenerationModel', expect.anything());
  });

  it('does not sync the built-in image MCP server when bootstrap makes no effective change', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalled();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'no',
      'no'
    );
  });

  it('does not sync agents when only the stored image MCP JSON representation differs', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        original_json: '{"legacy":true}',
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'yes',
      'yes'
    );
  });
});

/** Let pending promise chains settle (all mocks resolve as microtasks). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('runBackendMigrations recommended tool MCP rows', () => {
  type ToolId = 'trail' | 'headroom' | 'graphify' | 'reach';
  type ToolRow = { name: string; toolId: ToolId; description: string };
  const TOOL_ROWS: ToolRow[] = [
    {
      name: 'pavii-code-map',
      toolId: 'trail',
      description:
        'Pavii Code Map: Pavii agent tool, based on Trail-Code (MIT). Turn it on or off in Settings > Tools.',
    },
    {
      name: 'pavii-compress',
      toolId: 'headroom',
      description:
        'Pavii Compress: Pavii agent tool, based on Headroom (Apache-2.0). Turn it on or off in Settings > Tools.',
    },
    {
      name: 'pavii-graph',
      toolId: 'graphify',
      description:
        'Pavii Graph: Pavii agent tool, based on graphify (Apache-2.0). Turn it on or off in Settings > Tools.',
    },
    {
      name: 'pavii-search',
      toolId: 'reach',
      description: 'Pavii Reach: Pavii agent tool, based on Agent Reach (MIT). Turn it on or off in Settings > Tools.',
    },
  ];
  const [CODE_MAP, COMPRESS, GRAPH, SEARCH] = TOOL_ROWS;
  const SCRIPT = '/mock/builtin-mcp-code-graph.js';
  const EXA_URL = 'https://mcp.exa.ai/mcp';

  /** Desired MCP config as stored in original_json. */
  const desiredConfig = (row: ToolRow): Record<string, unknown> =>
    row.toolId === 'reach'
      ? { type: 'http', url: EXA_URL }
      : { command: 'node', args: [SCRIPT, row.toolId, '/mock-data'], env: { ...RECOMMENDED_TOOLS_ENV } };

  const desiredTransport = (row: ToolRow): IMcpServer['transport'] =>
    (row.toolId === 'reach'
      ? { type: 'http', url: EXA_URL }
      : { type: 'stdio', ...desiredConfig(row) }) as IMcpServer['transport'];

  const desiredJson = (row: ToolRow) => JSON.stringify({ mcpServers: { [row.name]: desiredConfig(row) } }, null, 2);

  const toolRow = (row: ToolRow, overrides: Partial<IMcpServer> = {}): IMcpServer => ({
    id: `${row.toolId}-id`,
    name: row.name,
    description: row.description,
    enabled: false,
    builtin: true,
    transport: desiredTransport(row),
    created_at: 1,
    updated_at: 1,
    original_json: desiredJson(row),
    ...overrides,
  });

  const allRows = (enabled: Partial<Record<ToolId, boolean>> = {}) =>
    TOOL_ROWS.map((row) => toolRow(row, { enabled: enabled[row.toolId] ?? false }));

  const installed = (...ids: ToolId[]) =>
    getRecommendedToolStatusMock.mockReturnValue(
      TOOL_ROWS.map((row) => ({ id: row.toolId, installed: ids.includes(row.toolId) }))
    );

  const importedServers = (): Array<Partial<IMcpServer>> =>
    batchImportServersMock.mock.calls.flatMap(
      ([payload]) => (payload as { servers: Array<Partial<IMcpServer>> }).servers
    );

  const toolNames = new Set(TOOL_ROWS.map((row) => row.name));

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('imports missing rows (stdio wrapper or http endpoint) enabled only when installed', async () => {
    installed('trail', 'reach');
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    const rows = importedServers().filter((server) => toolNames.has(server.name ?? ''));
    expect(rows).toEqual(
      TOOL_ROWS.map((row) => ({
        name: row.name,
        description: row.description,
        enabled: row.toolId === 'trail' || row.toolId === 'reach',
        builtin: true,
        transport: desiredTransport(row),
        original_json: desiredJson(row),
      }))
    );
  });

  it('imports Pavii Reach as an http row pointing to the Exa MCP endpoint', async () => {
    installed();
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    const search = importedServers().find((server) => server.name === 'pavii-search');
    expect(search?.transport).toEqual({ type: 'http', url: 'https://mcp.exa.ai/mcp' });
  });

  it('leaves aligned rows alone on launch', async () => {
    installed('trail', 'reach');
    listServersMock.mockResolvedValue([imageServer(), ...allRows({ trail: true, reach: true })]);

    await runBackendMigrations(configFile as never);

    expect(importedServers().filter((server) => toolNames.has(server.name ?? ''))).toEqual([]);
    expect(updateServerMock).not.toHaveBeenCalled();
    expect(toggleServerMock).not.toHaveBeenCalled();
  });

  it('realigns a row whose transport drifted (old script path / data dir)', async () => {
    listServersMock.mockResolvedValue([
      imageServer(),
      toolRow(CODE_MAP, {
        transport: { type: 'stdio', command: 'node', args: ['/old/builtin-mcp-code-graph.js', 'trail', '/old-data'] },
      }),
      toolRow(COMPRESS),
      toolRow(GRAPH),
      toolRow(SEARCH),
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(updateServerMock).toHaveBeenCalledWith({
      id: 'trail-id',
      data: { transport: desiredTransport(CODE_MAP), original_json: desiredJson(CODE_MAP) },
    });
  });

  it('realigns an http row whose URL drifted', async () => {
    listServersMock.mockResolvedValue([
      imageServer(),
      toolRow(CODE_MAP),
      toolRow(COMPRESS),
      toolRow(GRAPH),
      toolRow(SEARCH, { transport: { type: 'http', url: 'https://old.example/mcp' } }),
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(updateServerMock).toHaveBeenCalledWith({
      id: 'reach-id',
      data: { transport: desiredTransport(SEARCH), original_json: desiredJson(SEARCH) },
    });
  });

  it('realigns an http row that gained headers', async () => {
    listServersMock.mockResolvedValue([
      imageServer(),
      toolRow(CODE_MAP),
      toolRow(COMPRESS),
      toolRow(GRAPH),
      toolRow(SEARCH, { transport: { type: 'http', url: EXA_URL, headers: { 'X-Key': 'a' } } }),
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(updateServerMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'reach-id' }));
  });

  it('realigns an old stdio row of a tool that now uses an http endpoint', async () => {
    listServersMock.mockResolvedValue([
      imageServer(),
      toolRow(CODE_MAP),
      toolRow(COMPRESS),
      toolRow(GRAPH),
      toolRow(SEARCH, { transport: { type: 'stdio', command: 'node', args: [SCRIPT, 'reach', '/mock-data'] } }),
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledWith({
      id: 'reach-id',
      data: { transport: desiredTransport(SEARCH), original_json: desiredJson(SEARCH) },
    });
  });

  it('realigns a row whose stored JSON drifted while the transport matches', async () => {
    listServersMock.mockResolvedValue([
      imageServer(),
      toolRow(CODE_MAP),
      toolRow(COMPRESS, { original_json: '{}' }),
      toolRow(GRAPH),
      toolRow(SEARCH),
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(updateServerMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'headroom-id' }));
  });

  it('keeps an installed row the user turned off disabled on launch', async () => {
    installed('trail', 'headroom', 'graphify', 'reach');
    listServersMock.mockResolvedValue([imageServer(), ...allRows({ headroom: true })]);

    await runBackendMigrations(configFile as never);

    expect(toggleServerMock).not.toHaveBeenCalled();
  });

  it('turns a row off on launch when its tool is no longer installed', async () => {
    installed('headroom');
    listServersMock.mockResolvedValue([imageServer(), ...allRows({ trail: true, headroom: true })]);

    await runBackendMigrations(configFile as never);

    expect(toggleServerMock).toHaveBeenCalledOnce();
    expect(toggleServerMock).toHaveBeenCalledWith({ id: 'trail-id' });
  });

  it.each([
    {
      label: 'tool status',
      breakIt: () =>
        getRecommendedToolStatusMock.mockImplementation(() => {
          throw new Error('EACCES');
        }),
    },
    {
      label: 'data dir',
      breakIt: () =>
        getDataPathMock.mockImplementation(() => {
          throw new Error('no userData');
        }),
    },
  ])(
    'skips the rows with a warning when the $label cannot be read and still runs the bootstrap',
    async ({ breakIt }) => {
      breakIt();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      listServersMock.mockResolvedValue([imageServer(), toolRow(CODE_MAP, { enabled: true })]);

      await runBackendMigrations(configFile as never);

      const names = importedServers().map((server) => server.name);
      expect(names).toContain('chrome-devtools');
      expect(names.filter((name) => toolNames.has(name ?? ''))).toEqual([]);
      expect(updateServerMock).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'trail-id' }));
      expect(toggleServerMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[Migration] recommended tool MCP rows skipped: could not read tool state',
        expect.any(Error)
      );
      expect(migrateAssistantsToBackendMock).toHaveBeenCalledOnce();
    }
  );

  describe('after an install', () => {
    type InstallListener = (installedIds: ToolId[]) => void;

    const loadFresh = async () => {
      vi.resetModules();
      return import('@/process/utils/runBackendMigrations');
    };

    const installListener = (): InstallListener => {
      const listener = onRecommendedToolsInstalledMock.mock.calls.at(-1)?.[0] as InstallListener | undefined;
      if (!listener) throw new Error('install listener was not registered');
      return listener;
    };

    /** Run one launch, then clear the import/update/toggle mocks and return the install listener. */
    const launch = async (): Promise<InstallListener> => {
      const fresh = await loadFresh();
      listServersMock.mockResolvedValue([imageServer()]);
      await fresh.runBackendMigrations(configFile as never);
      batchImportServersMock.mockClear();
      updateServerMock.mockClear();
      toggleServerMock.mockClear();
      return installListener();
    };

    it('subscribes to installs only once across launches', async () => {
      const fresh = await loadFresh();
      listServersMock.mockResolvedValue([imageServer()]);

      await fresh.runBackendMigrations(configFile as never);
      await fresh.runBackendMigrations(configFile as never);

      expect(onRecommendedToolsInstalledMock).toHaveBeenCalledOnce();
    });

    it('imports missing rows and turns the just-installed tools on', async () => {
      const listener = await launch();
      installed('trail', 'graphify');
      listServersMock.mockResolvedValue([toolRow(CODE_MAP, { enabled: false })]);

      listener(['trail', 'graphify']);
      await flush();

      expect(importedServers().map((server) => [server.name, server.enabled])).toEqual([
        ['pavii-compress', false],
        ['pavii-graph', true],
        ['pavii-search', false],
      ]);
      expect(toggleServerMock).toHaveBeenCalledOnce();
      expect(toggleServerMock).toHaveBeenCalledWith({ id: 'trail-id' });
    });

    it('keeps an already-installed tool the user turned off disabled when another tool installs', async () => {
      const listener = await launch();
      installed('trail', 'reach');
      listServersMock.mockResolvedValue(allRows({ trail: false, reach: false }));

      listener(['reach']);
      await flush();

      expect(toggleServerMock).toHaveBeenCalledOnce();
      expect(toggleServerMock).toHaveBeenCalledWith({ id: 'reach-id' });
    });

    it('does not import or toggle when every row already matches', async () => {
      const listener = await launch();
      installed('trail');
      listServersMock.mockResolvedValue(allRows({ trail: true }));

      listener(['trail']);
      await flush();

      expect(batchImportServersMock).not.toHaveBeenCalled();
      expect(toggleServerMock).not.toHaveBeenCalled();
      expect(updateServerMock).not.toHaveBeenCalled();
    });

    it('turns a not-installed row off during the refresh', async () => {
      const listener = await launch();
      installed('trail', 'headroom', 'reach');
      listServersMock.mockResolvedValue(allRows({ trail: true, headroom: true, graphify: true, reach: true }));

      listener(['headroom']);
      await flush();

      expect(toggleServerMock).toHaveBeenCalledOnce();
      expect(toggleServerMock).toHaveBeenCalledWith({ id: 'graphify-id' });
    });

    it('logs a warning instead of throwing when the refresh fails', async () => {
      const fresh = await loadFresh();
      listServersMock.mockResolvedValue([imageServer()]);
      await fresh.runBackendMigrations(configFile as never);
      const listener = installListener();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      listServersMock.mockRejectedValue(new Error('backend down'));

      expect(() => listener(['trail'])).not.toThrow();
      await flush();

      expect(warnSpy).toHaveBeenCalledWith('[Migration] recommended tool MCP refresh failed', expect.any(Error));
    });
  });
});
