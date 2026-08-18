import type { AssistantDetail } from '@/common/types/agent/assistantTypes';

/**
 * Skills enabled out of the box for users who never picked skills themselves.
 * Applied only while `preferences.last_skill_ids` is unset: the first send
 * records the user's actual selection, so deselecting sticks from then on.
 */
export const DEFAULT_ENABLED_SKILL_IDS = ['token-optimizer'];

export type ResolvedGuidAssistantDefaults = {
  modelId?: string;
  permissionMode?: string;
  thoughtLevel?: string;
  skillIds: string[];
  disabledBuiltinSkillIds: string[];
  mcpIds: string[];
};

export const resolveGuidAssistantDefaults = (
  detail: AssistantDetail | null | undefined
): ResolvedGuidAssistantDefaults => {
  if (!detail) {
    return {
      modelId: undefined,
      permissionMode: undefined,
      thoughtLevel: undefined,
      skillIds: [],
      disabledBuiltinSkillIds: [],
      mcpIds: [],
    };
  }

  const modelId =
    detail.defaults.model.mode === 'fixed'
      ? detail.defaults.model.value
      : detail.defaults.model.mode === 'auto'
        ? detail.preferences.last_model_id
        : undefined;

  const permissionMode =
    detail.defaults.permission.mode === 'fixed'
      ? detail.defaults.permission.value
      : detail.defaults.permission.mode === 'auto'
        ? detail.preferences.last_permission_value
        : undefined;

  const thoughtLevelDefault = detail.defaults.thought_level ?? { mode: 'auto' };
  const thoughtLevel =
    thoughtLevelDefault.mode === 'fixed'
      ? thoughtLevelDefault.value
      : thoughtLevelDefault.mode === 'auto'
        ? detail.preferences.last_thought_level_value
        : undefined;

  const skillIds =
    detail.defaults.skills.mode === 'fixed'
      ? (detail.defaults.skills.value ?? [])
      : detail.defaults.skills.mode === 'auto'
        ? (detail.preferences.last_skill_ids ?? DEFAULT_ENABLED_SKILL_IDS)
        : [];

  const disabledBuiltinSkillIds =
    detail.defaults.skills.mode === 'fixed'
      ? (detail.capabilities.default_disabled_builtin_skill_ids ?? [])
      : detail.defaults.skills.mode === 'auto'
        ? (detail.preferences.last_disabled_builtin_skill_ids ?? [])
        : [];

  const mcpIds =
    detail.defaults.mcps.mode === 'fixed'
      ? (detail.defaults.mcps.value ?? [])
      : detail.defaults.mcps.mode === 'auto'
        ? (detail.preferences.last_mcp_ids ?? [])
        : [];

  return {
    modelId: modelId || undefined,
    permissionMode: permissionMode || undefined,
    thoughtLevel: thoughtLevel || undefined,
    skillIds,
    disabledBuiltinSkillIds,
    mcpIds,
  };
};
