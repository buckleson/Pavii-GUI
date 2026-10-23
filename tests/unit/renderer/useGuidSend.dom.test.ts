/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const createConversationInvokeMock = vi.fn();
const swrMutateMock = vi.fn();
const checkIfStaleMock = vi.fn();
const { configGetMock } = vi.hoisted(() => ({ configGetMock: vi.fn() }));

vi.mock('@/common/config/configService', () => ({
  configService: { get: (...args: unknown[]) => configGetMock(...args) },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: {
        invoke: (...args: unknown[]) => createConversationInvokeMock(...args),
      },
    },
    agentCli: {
      checkIfStale: {
        invoke: (...args: unknown[]) => checkIfStaleMock(...args),
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  mutate: (...args: unknown[]) => swrMutateMock(...args),
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const createDeps = (): GuidSendDeps => ({
  input: 'hello',
  setInput: vi.fn(),
  files: [],
  setFiles: vi.fn(),
  dir: '',
  setDir: vi.fn(),
  setLoading: vi.fn(),
  loading: false,
  selectedAssistantId: 'assistant-1',
  selectedAssistantBackend: 'claude',
  selectedMode: 'bypassPermissions',
  selectedAcpModel: 'claude-opus',
  currentAcpCachedModelInfo: null,
  current_model: undefined,
  guidDisabledBuiltinSkills: undefined,
  guidEnabledSkills: undefined,
  assistantDefaultSkillIds: undefined,
  assistantDefaultDisabledBuiltinSkillIds: undefined,
  availableMcpServers: [{ id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer],
  selectedMcpServerIds: ['mcp-user'],
  assistantDefaultMcpIds: undefined,
  isGoogleAuth: false,
  setMentionOpen: vi.fn(),
  setMentionQuery: vi.fn(),
  setMentionSelectorOpen: vi.fn(),
  setMentionActiveIndex: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()) as never,
  t: vi.fn((key: string, options?: { defaultValue?: string }) => options?.defaultValue || key) as never,
  localeKey: 'zh-CN',
});

const argsOf = (servers: Array<{ id: string; transport: { args?: string[] } }>, id: string) =>
  servers.find((server) => server.id === id)?.transport.args;

describe('useGuidSend', () => {
  beforeEach(() => {
    createConversationInvokeMock.mockReset();
    createConversationInvokeMock.mockResolvedValue({ id: 'conv-1' });
    swrMutateMock.mockReset();
    swrMutateMock.mockResolvedValue(undefined);
    checkIfStaleMock.mockReset();
    checkIfStaleMock.mockResolvedValue(undefined);
    configGetMock.mockReset();
    configGetMock.mockReturnValue(undefined);
  });

  describe('STE100 reply style', () => {
    const sendAndGetDisabledBuiltins = async (deps: GuidSendDeps) => {
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend();
      });
      return createConversationInvokeMock.mock.calls[0][0].assistant?.conversation_overrides
        ?.disabled_builtin_skill_ids as string[] | undefined;
    };

    const prefIs = (value: unknown) =>
      configGetMock.mockImplementation((key: string) => (key === 'replyStyle.ste100' ? value : undefined));

    it('excludes the ste100-replies builtin skill when the setting is off', async () => {
      prefIs(false);
      const deps = createDeps();
      deps.guidDisabledBuiltinSkills = ['todo-tracker'];
      expect(await sendAndGetDisabledBuiltins(deps)).toEqual(['todo-tracker', 'ste100-replies']);
    });

    it('excludes ste100-replies when the setting is off and nothing else is excluded', async () => {
      prefIs(false);
      expect(await sendAndGetDisabledBuiltins(createDeps())).toEqual(['ste100-replies']);
    });

    it('does not add ste100-replies twice when it is already excluded', async () => {
      prefIs(false);
      const deps = createDeps();
      deps.assistantDefaultDisabledBuiltinSkillIds = ['ste100-replies'];
      expect(await sendAndGetDisabledBuiltins(deps)).toEqual(['ste100-replies']);
    });

    it('leaves the exclusions unchanged when the setting is on', async () => {
      prefIs(true);
      const deps = createDeps();
      deps.guidDisabledBuiltinSkills = ['todo-tracker'];
      expect(await sendAndGetDisabledBuiltins(deps)).toEqual(['todo-tracker']);
    });

    it('treats an absent setting as on', async () => {
      prefIs(undefined);
      expect(await sendAndGetDisabledBuiltins(createDeps())).toBeUndefined();
    });
  });

  describe('code-map MCP workspace argument', () => {
    const WORKSPACE = 'D:\\Repos\\my app';
    const builtinRow = (name: string) =>
      ({
        id: `${name}-id`,
        name,
        enabled: true,
        builtin: true,
        transport: { type: 'stdio', command: 'node', args: ['/script.js', name, '/data'] },
      }) as IMcpServer;
    const userRow = {
      id: 'mcp-user',
      name: 'User MCP',
      enabled: true,
      builtin: false,
      transport: { type: 'stdio', command: 'user', args: ['--flag'] },
    } as IMcpServer;

    const codeMapDeps = (dir: string) => {
      const deps = createDeps();
      deps.dir = dir;
      deps.availableMcpServers = [userRow, builtinRow('pavii-trail'), builtinRow('pavii-headroom')];
      deps.selectedMcpServerIds = ['mcp-user', 'pavii-trail-id', 'pavii-headroom-id'];
      return deps;
    };

    const sendAndGetSessionServers = async (deps: GuidSendDeps) => {
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend();
      });
      return createConversationInvokeMock.mock.calls[0][0].extra.selected_session_mcp_servers as Array<{
        id: string;
        transport: { args?: string[] };
      }>;
    };

    it('appends a custom workspace to the Trail row only (ACP)', async () => {
      const servers = await sendAndGetSessionServers(codeMapDeps(WORKSPACE));

      expect(argsOf(servers, 'pavii-trail-id')).toEqual(['/script.js', 'pavii-trail', '/data', WORKSPACE]);
      expect(argsOf(servers, 'pavii-headroom-id')).toEqual(['/script.js', 'pavii-headroom', '/data']);
    });

    it('leaves args unchanged when no custom workspace was chosen', async () => {
      const servers = await sendAndGetSessionServers(codeMapDeps(''));

      expect(argsOf(servers, 'pavii-trail-id')).toEqual(['/script.js', 'pavii-trail', '/data']);
    });

    it('appends the workspace for aionrs, where user rows are sent too, and leaves user rows unchanged', async () => {
      const deps = codeMapDeps(WORKSPACE);
      deps.selectedAssistantBackend = 'aionrs';
      deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-2.5-pro' } as never;

      const servers = await sendAndGetSessionServers(deps);

      expect(argsOf(servers, 'pavii-trail-id')).toEqual(['/script.js', 'pavii-trail', '/data', WORKSPACE]);
      expect(argsOf(servers, 'mcp-user')).toEqual(['--flag']);
    });

    it('appends the workspace to assistant-default MCP rows when nothing was selected locally', async () => {
      const deps = codeMapDeps(WORKSPACE);
      deps.selectedAssistantBackend = 'aionrs';
      deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-2.5-pro' } as never;
      deps.selectedMcpServerIds = undefined;
      deps.assistantDefaultMcpIds = ['pavii-trail-id'];

      const servers = await sendAndGetSessionServers(deps);

      expect(servers).toHaveLength(1);
      expect(argsOf(servers, 'pavii-trail-id')).toEqual(['/script.js', 'pavii-trail', '/data', WORKSPACE]);
    });
  });

  it('asks for a background update check of the CLI once an ACP conversation is created', async () => {
    const { result } = renderHook(() => useGuidSend(createDeps()));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(checkIfStaleMock).toHaveBeenCalledWith({ backend: 'claude' });
  });

  it('still navigates to the conversation when the background update check rejects', async () => {
    checkIfStaleMock.mockRejectedValue(new Error('ipc down'));
    const deps = createDeps();
    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(deps.navigate).toHaveBeenCalledWith('/conversation/conv-1');
  });

  it('does not request an update check when the conversation could not be created', async () => {
    createConversationInvokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => useGuidSend(createDeps()));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(checkIfStaleMock).not.toHaveBeenCalled();
  });

  it('passes selected mode into assistant conversation overrides when creating a preset ACP conversation', async () => {
    const deps = createDeps();
    (deps as any).selectedThoughtLevelValue = 'high';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBeUndefined();
    expect('model' in payload).toBe(false);
    expect(payload.assistant?.conversation_overrides?.permission).toBe('bypassPermissions');
    expect(payload.assistant?.conversation_overrides?.model).toBe('claude-opus');
    expect(payload.assistant?.conversation_overrides?.thought_level).toBe('high');
    expect(payload.extra.backend).toBeUndefined();
    expect(payload.extra.agent_name).toBeUndefined();
    expect(payload.extra.agent_id).toBeUndefined();
    expect(payload.extra.custom_agent_id).toBeUndefined();
    expect(payload.extra.preset_rules).toBeUndefined();
    expect(payload.extra.preset_context).toBeUndefined();
    expect(payload.extra.session_mode).toBeUndefined();
    expect(payload.extra.current_model_id).toBeUndefined();
    expect(payload.extra.preset_assistant_id).toBeUndefined();
    expect(swrMutateMock).toHaveBeenCalledWith('guid.assistant.detail.assistant-1.zh-CN');
    expect(swrMutateMock).toHaveBeenCalledWith('assistants.list');
  });

  it('falls back to assistant default skill and MCP ids for preset conversations before local Guid overrides exist', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = undefined;
    deps.guidDisabledBuiltinSkills = undefined;
    deps.assistantDefaultSkillIds = ['assistant-skill'];
    deps.assistantDefaultDisabledBuiltinSkillIds = ['builtin-skill'];
    deps.selectedMcpServerIds = undefined;
    deps.assistantDefaultMcpIds = ['mcp-user'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['assistant-skill']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['builtin-skill']);
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
  });

  it('preserves builtin MCP ids in assistant overrides while only sending user MCP ids to runtime selection', async () => {
    const deps = createDeps();
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-mcp', name: 'Builtin MCP', enabled: true, builtin: true } as IMcpServer,
    ];
    deps.selectedMcpServerIds = ['mcp-user', 'builtin-mcp'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-mcp']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_session_mcp_servers).toEqual([expect.objectContaining({ id: 'builtin-mcp' })]);
  });

  it('does not write legacy preset_assistant_id for preset assistant sends', async () => {
    const deps = createDeps();

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.extra.preset_assistant_id).toBeUndefined();
  });

  it('forwards local skill overrides through assistant conversation overrides for ACP assistants', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = ['pdf-reader'];
    deps.guidDisabledBuiltinSkills = ['todo-tracker'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['pdf-reader']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['todo-tracker']);
  });

  it('forwards local skill overrides for generated Aion CLI assistants through assistant conversation overrides', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gemini-2.5-pro', use_model: 'gemini-2.5-pro' } as never;
    deps.guidEnabledSkills = ['pdf-reader'];
    deps.guidDisabledBuiltinSkills = ['todo-tracker'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBeUndefined();
    expect(payload.model).toBe(deps.current_model);
    expect(payload.assistant?.id).toBe('bare:aionrs');
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['pdf-reader']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['todo-tracker']);
    expect(payload.extra.session_mode).toBeUndefined();
  });

  it('does not write legacy preset_assistant_id for generated Aion CLI assistant conversations', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gemini-2.5-pro', use_model: 'gemini-2.5-pro' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('bare:aionrs');
    expect(payload.extra.preset_assistant_id).toBeUndefined();
  });

  it('does not write legacy preset_assistant_id for generated ACP assistant conversations', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:claude';
    deps.selectedAssistantBackend = 'claude';
    deps.current_model = { provider_id: 'anthropic', model: 'claude-sonnet', use_model: 'claude-sonnet' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('bare:claude');
    expect(payload.type).toBeUndefined();
    expect('model' in payload).toBe(false);
    expect(payload.extra.preset_assistant_id).toBeUndefined();
    expect(payload.extra.backend).toBeUndefined();
  });

  it('does not hand a CLI agent the aionrs provider model on its first turn', async () => {
    // Reproduces the first-use failure: before the agent's catalog has been
    // probed there is no ACP model to offer, and the provider selection used to
    // fill the gap. A brand new Antigravity conversation therefore started on
    // `gemini-3.1-pro-preview` — a model agy has never heard of — and the turn
    // died with USER_LLM_PROVIDER_MODEL_NOT_FOUND. Once the catalog landed the
    // earlier option won again, which is why it only ever showed up on a fresh
    // machine.
    const deps = createDeps();
    deps.selectedAssistantBackend = 'antigravity';
    deps.selectedAcpModel = null;
    deps.currentAcpCachedModelInfo = null;
    deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-3.1-pro-preview' } as never;

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    // No model at all: the agent then starts on its own default, which is what
    // "the user has not picked one" actually means.
    expect(payload.assistant.conversation_overrides.model).toBeUndefined();
  });

  it('still gives aionrs its provider model', async () => {
    // The fallback exists for aionrs, whose model IS the provider selection.
    const deps = createDeps();
    deps.selectedAssistantBackend = 'aionrs';
    deps.selectedAcpModel = null;
    deps.currentAcpCachedModelInfo = null;
    deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-3.1-pro-preview' } as never;

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant.conversation_overrides.model).toBe('gemini-3.1-pro-preview');
  });

  it('prefers the agent catalog model once it has been probed', async () => {
    // The path that makes this bug invisible after first use.
    const deps = createDeps();
    deps.selectedAssistantBackend = 'antigravity';
    deps.selectedAcpModel = null;
    deps.currentAcpCachedModelInfo = {
      current_model_id: 'gemini-3.6-flash-low',
      available_models: [{ id: 'gemini-3.6-flash-low', label: 'low' }],
    } as never;
    deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-3.1-pro-preview' } as never;

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant.conversation_overrides.model).toBe('gemini-3.6-flash-low');
  });

  it('does not create a conversation without assistant identity', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = null;
    deps.selectedAssistantBackend = 'claude';

    const { result } = renderHook(() => useGuidSend(deps));

    expect(result.current.isButtonDisabled).toBe(true);

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).not.toHaveBeenCalled();
  });
});
