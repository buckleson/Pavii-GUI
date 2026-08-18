/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginStatus } from '@/common/types/channel/channel';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { PaviiChannelState } from '@/common/adapter/ipcBridge';
import { channel, paviiChannels } from '@/common/adapter/ipcBridge';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import type { GoogleModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection';
import { useGoogleModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection';
import { Input, InputNumber, Message, Select, Switch } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../../settingsViewContext';
import ChannelItem from './ChannelItem';
import type { ChannelConfig } from './types';
import TelegramConfigForm from './TelegramConfigForm';
import SlackConfigForm from './SlackConfigForm';
import DiscordConfigForm from './DiscordConfigForm';

type ChannelSettingsPlatform = 'telegram';

type ExtensionFieldType = 'text' | 'password' | 'select' | 'number' | 'boolean';

type ExtensionFieldSchema = {
  key: string;
  label: string;
  type: ExtensionFieldType;
  required?: boolean;
  options?: string[];
  default?: string | number | boolean;
};

type ExtensionFieldValues = Record<string, Record<string, string | number | boolean>>;

const BUILTIN_CHANNEL_TYPES = new Set(['telegram', 'slack', 'discord']);

/**
 * Channel types the aioncore backend still ships but Pavii.Ai does not offer.
 * The backend keeps returning them from GET /api/channel/plugins; without this
 * filter they would resurface as generic extension rows.
 */
const HIDDEN_CHANNEL_TYPES = new Set(['lark', 'dingtalk', 'weixin', 'wecom']);

/**
 * Internal hook: wraps useGoogleModelSelection with backend-owned channel settings
 * for a specific platform (e.g. 'telegram').
 *
 * Restoration is done by resolving the saved model reference into a full
 * TProviderWithModel and passing it as `initialModel` — this avoids triggering
 * the onSelectModel callback (and its toast) on mount.
 */
const useChannelModelSelection = (platform: ChannelSettingsPlatform): GoogleModelSelection => {
  const { t } = useTranslation();

  // Resolve persisted model into a full TProviderWithModel for initialModel.
  // useModelProviderList is SWR-backed so the duplicate call inside
  // useGoogleModelSelection is deduplicated automatically.
  const { providers } = useModelProviderList();
  const [resolvedInitialModel, setResolvedInitialModel] = useState<TProviderWithModel | undefined>(undefined);
  const [restored, setRestored] = useState(false);
  const retryCountRef = useRef(0);

  // Cap retries to prevent infinite re-runs when a saved provider ID is stale
  // (e.g. provider deleted, or agent switched to a non-gemini backend).
  // The Google Auth provider typically loads within 1-2 SWR cycles, so 5 is generous.
  const MAX_RESTORE_RETRIES = 5;

  useEffect(() => {
    if (restored || providers.length === 0) return;

    const restore = async () => {
      try {
        const settings = await channel.getPlatformSettings.invoke({ platform });
        const saved = settings.default_model ?? undefined;
        if (!saved?.id || !saved?.use_model) {
          // Nothing saved — mark restored so we don't keep retrying
          setRestored(true);
          return;
        }

        const provider = providers.find((p) => p.id === saved.id);
        if (!provider) {
          retryCountRef.current += 1;
          if (retryCountRef.current >= MAX_RESTORE_RETRIES) {
            // Provider is permanently missing — give up to avoid infinite retries
            setRestored(true);
          }
          // The Google Auth provider may load after API-key providers;
          // leaving restored=false lets this effect re-run when providers update.
          return;
        }

        // Google Auth provider's model array only contains top-level modes
        // ('auto', 'auto-gemini-2.5', 'manual'), but sub-model values like
        // 'gemini-2.5-flash' are also valid — skip strict membership check.
        const isGoogleAuth = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
        if (isGoogleAuth || provider.models?.includes(saved.use_model)) {
          setResolvedInitialModel({
            ...provider,
            use_model: saved.use_model,
          } as TProviderWithModel);
        }
        setRestored(true);
      } catch (error) {
        console.error(`[ChannelSettings] Failed to restore model for ${platform}:`, error);
        setRestored(true);
      }
    };

    void restore();
  }, [platform, providers, restored]);

  // Only called on explicit user selection — not during restoration
  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      try {
        const modelRef = { id: provider.id, use_model: modelName };
        await channel.setDefaultModelSetting.invoke({ platform, default_model: modelRef });

        Message.success(t('settings.assistant.modelSwitched', 'Model switched successfully'));
        return true;
      } catch (error) {
        console.error(`[ChannelSettings] Failed to save model for ${platform}:`, error);
        Message.error(t('settings.assistant.modelSaveFailed', 'Failed to save model'));
        return false;
      }
    },
    [platform, t]
  );

  return useGoogleModelSelection({
    initialModel: resolvedInitialModel,
    onSelectModel,
  });
};

/**
 * Assistant Settings Content Component
 */
const ChannelModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  // Plugin state
  const [pluginStatus, setPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [enableLoading, setEnableLoading] = useState(false);
  // App-hosted Slack/Discord bridges (run in the Electron main process, not aioncore)
  const [slackState, setSlackState] = useState<PaviiChannelState | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const slackCredentialsRef = useRef<{ botToken: string; appToken: string }>({ botToken: '', appToken: '' });
  const [discordState, setDiscordState] = useState<PaviiChannelState | null>(null);
  const [discordLoading, setDiscordLoading] = useState(false);
  const discordTokenRef = useRef('');
  const [extensionStatuses, setExtensionStatuses] = useState<Record<string, IChannelPluginStatus>>({});
  const [extensionLoadingMap, setExtensionLoadingMap] = useState<Record<string, boolean>>({});
  const [extensionFieldValues, setExtensionFieldValues] = useState<ExtensionFieldValues>({});

  // Track the token entered in TelegramConfigForm so the toggle handler can use it
  const telegramTokenRef = React.useRef<string>('');

  // Collapse state - true means collapsed (closed), false means expanded (open)
  const [collapseKeys, setCollapseKeys] = useState<Record<string, boolean>>({
    telegram: true, // Default to collapsed
    slack: true,
    discord: true,
  });

  // Model selection state — uses unified hook with backend-owned channel settings
  const telegramModelSelection = useChannelModelSelection('telegram');

  // Load plugin status
  const loadPluginStatus = useCallback(async () => {
    try {
      // getPluginStatus returns IChannelPluginStatus[] directly
      const plugins = await channel.getPluginStatus.invoke();
      if (plugins) {
        const telegramPlugin = plugins.find((p) => p.type === 'telegram');
        const extensionPlugins = plugins.filter(
          (p) => !BUILTIN_CHANNEL_TYPES.has(p.type) && !HIDDEN_CHANNEL_TYPES.has(p.type)
        );

        setPluginStatus(telegramPlugin || null);
        setExtensionStatuses(() => {
          const next: Record<string, IChannelPluginStatus> = {};
          for (const plugin of extensionPlugins) {
            next[plugin.type] = plugin;
          }
          return next;
        });

        setExtensionFieldValues((prev) => {
          const next: ExtensionFieldValues = { ...prev };
          for (const plugin of extensionPlugins) {
            const fields = [
              ...(plugin.extensionMeta?.credentialFields || []),
              ...(plugin.extensionMeta?.configFields || []),
            ] as ExtensionFieldSchema[];
            if (!next[plugin.type]) {
              next[plugin.type] = {};
            }
            for (const field of fields) {
              if (next[plugin.type][field.key] === undefined && field.default !== undefined) {
                next[plugin.type][field.key] = field.default;
              }
            }
          }
          return next;
        });
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load plugin status:', error);
    }
  }, []);

  const loadSlackStatus = useCallback(async () => {
    try {
      const status = await paviiChannels.getStatus.invoke();
      setSlackState(status.slack);
      setDiscordState(status.discord);
    } catch {
      // Bridge IPC unavailable (e.g. WebUI browser): keep the cards disabled.
      setSlackState(null);
      setDiscordState(null);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadPluginStatus();
    void loadSlackStatus();
  }, [loadPluginStatus, loadSlackStatus]);

  const handleToggleSlack = useCallback(
    async (enabled: boolean) => {
      setSlackLoading(true);
      try {
        if (enabled) {
          const credentials = slackCredentialsRef.current;
          if (!credentials.botToken || !credentials.appToken) {
            Message.warning(
              t('settings.channels.slackTokensRequired', {
                defaultValue: 'Enter both the bot token and the app-level token first.',
              })
            );
            return;
          }
          const next = await paviiChannels.enable.invoke({ platform: 'slack', credentials });
          setSlackState(next);
          Message.success(t('settings.channels.slackEnabled', { defaultValue: 'Slack connected.' }));
        } else {
          await paviiChannels.disable.invoke({ platform: 'slack' });
          await loadSlackStatus();
        }
      } catch (error) {
        Message.error(error instanceof Error ? error.message : String(error));
        await loadSlackStatus();
      } finally {
        setSlackLoading(false);
      }
    },
    [t, loadSlackStatus]
  );

  const handleToggleDiscord = useCallback(
    async (enabled: boolean) => {
      setDiscordLoading(true);
      try {
        if (enabled) {
          if (!discordTokenRef.current) {
            Message.warning(
              t('settings.channels.discordTokenRequired', { defaultValue: 'Enter the bot token first.' })
            );
            return;
          }
          const next = await paviiChannels.enable.invoke({
            platform: 'discord',
            credentials: { botToken: discordTokenRef.current },
          });
          setDiscordState(next);
          Message.success(t('settings.channels.discordEnabled', { defaultValue: 'Discord connected.' }));
        } else {
          await paviiChannels.disable.invoke({ platform: 'discord' });
          await loadSlackStatus();
        }
      } catch (error) {
        Message.error(error instanceof Error ? error.message : String(error));
        await loadSlackStatus();
      } finally {
        setDiscordLoading(false);
      }
    },
    [t, loadSlackStatus]
  );

  // Listen for plugin status changes
  useEffect(() => {
    const unsubscribe = channel.pluginStatusChanged.on(({ status }) => {
      if (status.type === 'telegram') {
        setPluginStatus(status);
      } else if (!BUILTIN_CHANNEL_TYPES.has(status.type) && !HIDDEN_CHANNEL_TYPES.has(status.type)) {
        setExtensionStatuses((prev) => ({
          ...prev,
          [status.type]: {
            ...prev[status.type],
            ...status,
            extensionMeta: status.extensionMeta || prev[status.type]?.extensionMeta,
          },
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  // Toggle collapse
  const handleToggleCollapse = (channelId: string) => {
    setCollapseKeys((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  };

  // Enable/Disable plugin
  const handleTogglePlugin = async (enabled: boolean) => {
    setEnableLoading(true);
    try {
      if (enabled) {
        // Check if we have a token - either saved in database or entered in the form
        const pendingToken = telegramTokenRef.current.trim();
        if (!pluginStatus?.hasToken && !pendingToken) {
          Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token first'));
          setEnableLoading(false);
          return;
        }

        // enablePlugin returns void; success if no throw
        await channel.enablePlugin.invoke({
          plugin_id: 'telegram',
          config: pendingToken ? { credentials: { token: pendingToken } } : {},
        });

        Message.success(t('settings.assistant.pluginEnabled', 'Telegram bot enabled'));
        await loadPluginStatus();
      } else {
        // disablePlugin returns void; success if no throw
        await channel.disablePlugin.invoke({
          plugin_id: 'telegram',
        });

        Message.success(t('settings.assistant.pluginDisabled', 'Telegram bot disabled'));
        await loadPluginStatus();
      }
    } catch (error: unknown) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setEnableLoading(false);
    }
  };

  const updateExtensionFieldValue = useCallback((pluginType: string, key: string, value: string | number | boolean) => {
    setExtensionFieldValues((prev) => ({
      ...prev,
      [pluginType]: {
        ...prev[pluginType],
        [key]: value,
      },
    }));
  }, []);

  const handleToggleExtensionPlugin = useCallback(
    async (pluginType: string, enabled: boolean) => {
      const status = extensionStatuses[pluginType];
      if (!status) return;

      setExtensionLoadingMap((prev) => ({ ...prev, [pluginType]: true }));
      try {
        if (enabled) {
          const fieldValues = extensionFieldValues[pluginType] || {};
          const credentialFields = (status.extensionMeta?.credentialFields || []) as ExtensionFieldSchema[];
          const missingField = credentialFields.find((field) => {
            if (!field.required) return false;
            const value = fieldValues[field.key];
            if (field.type === 'boolean') return value === undefined;
            return value === undefined || value === '';
          });

          if (missingField) {
            Message.warning(
              t('settings.channels.extension.requiredField', {
                defaultValue: 'Please fill required field: {{field}}',
                field: missingField.label,
              })
            );
            return;
          }

          await channel.enablePlugin.invoke({
            plugin_id: status.id || pluginType,
            config: fieldValues,
          });

          Message.success(
            t('settings.channels.extension.enabled', {
              defaultValue: 'Channel enabled',
            })
          );
          await loadPluginStatus();
        } else {
          await channel.disablePlugin.invoke({
            plugin_id: status.id || pluginType,
          });
          Message.success(
            t('settings.channels.extension.disabled', {
              defaultValue: 'Channel disabled',
            })
          );
          await loadPluginStatus();
        }
      } catch (error: unknown) {
        Message.error(error instanceof Error ? error.message : String(error));
      } finally {
        setExtensionLoadingMap((prev) => ({ ...prev, [pluginType]: false }));
      }
    },
    [extensionStatuses, extensionFieldValues, t, loadPluginStatus]
  );

  const renderExtensionConfigForm = useCallback(
    (status: IChannelPluginStatus) => {
      const pluginType = status.type;
      const fields = [
        ...((status.extensionMeta?.credentialFields || []) as ExtensionFieldSchema[]),
        ...((status.extensionMeta?.configFields || []) as ExtensionFieldSchema[]),
      ];
      const values = extensionFieldValues[pluginType] || {};

      if (fields.length === 0) {
        return (
          <div className='text-14px text-t-secondary py-12px'>
            {status.extensionMeta?.description ||
              t('settings.channels.extension.noConfig', {
                defaultValue: 'No extra configuration required.',
              })}
          </div>
        );
      }

      return (
        <div className='space-y-10px py-4px'>
          {status.extensionMeta?.description && (
            <div className='text-13px text-t-secondary leading-relaxed'>{status.extensionMeta.description}</div>
          )}
          {fields.map((field) => {
            const rawValue = values[field.key];
            const label = `${field.label}${field.required ? ' *' : ''}`;

            if (field.type === 'boolean') {
              return (
                <div key={`${pluginType}-${field.key}`} className='flex items-center justify-between'>
                  <span className='text-13px text-t-primary'>{label}</span>
                  <Switch
                    checked={Boolean(rawValue)}
                    onChange={(checked) => updateExtensionFieldValue(pluginType, field.key, checked)}
                  />
                </div>
              );
            }

            if (field.type === 'number') {
              return (
                <div key={`${pluginType}-${field.key}`} className='space-y-6px'>
                  <div className='text-13px text-t-primary'>{label}</div>
                  <InputNumber
                    value={typeof rawValue === 'number' ? rawValue : undefined}
                    onChange={(value) => updateExtensionFieldValue(pluginType, field.key, Number(value || 0))}
                    className='w-full'
                  />
                </div>
              );
            }

            if (field.type === 'select') {
              return (
                <div key={`${pluginType}-${field.key}`} className='space-y-6px'>
                  <div className='text-13px text-t-primary'>{label}</div>
                  <Select
                    value={typeof rawValue === 'string' ? rawValue : undefined}
                    options={(field.options || []).map((option) => ({
                      label: option,
                      value: option,
                    }))}
                    onChange={(value) => updateExtensionFieldValue(pluginType, field.key, String(value))}
                    placeholder={t('settings.channels.extension.selectPlaceholder', { defaultValue: 'Please select' })}
                    allowClear
                  />
                </div>
              );
            }

            return (
              <div key={`${pluginType}-${field.key}`} className='space-y-6px'>
                <div className='text-13px text-t-primary'>{label}</div>
                <Input
                  value={typeof rawValue === 'string' ? rawValue : ''}
                  onChange={(value) => updateExtensionFieldValue(pluginType, field.key, value)}
                  placeholder={field.label}
                  type={field.type === 'password' ? 'password' : 'text'}
                />
              </div>
            );
          })}
        </div>
      );
    },
    [extensionFieldValues, t, updateExtensionFieldValue]
  );

  // Build channel configurations
  const channels: ChannelConfig[] = useMemo(() => {
    const telegramChannel: ChannelConfig = {
      id: 'telegram',
      title: t('settings.channels.telegramTitle', 'Telegram'),
      description: t('settings.channels.telegramDesc', 'Chat with Pavii.Ai assistant via Telegram'),
      status: 'active',
      enabled: pluginStatus?.enabled || false,
      disabled: enableLoading,
      is_connected: pluginStatus?.connected || false,
      botUsername: pluginStatus?.botUsername,
      defaultModel: telegramModelSelection.current_model?.use_model,
      content: (
        <TelegramConfigForm
          pluginStatus={pluginStatus}
          modelSelection={telegramModelSelection}
          onStatusChange={setPluginStatus}
          onTokenChange={(token) => {
            telegramTokenRef.current = token;
          }}
        />
      ),
    };

    const extensionChannels: ChannelConfig[] = Object.values(extensionStatuses)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((status) => ({
        id: status.type,
        title: status.name,
        description:
          status.extensionMeta?.description ||
          t('settings.channels.extension.defaultDesc', {
            defaultValue: 'Extension channel plugin',
          }),
        status: 'active',
        enabled: status.enabled || false,
        disabled: extensionLoadingMap[status.type] || false,
        is_connected: status.connected || false,
        icon: status.extensionMeta?.icon,
        isExtension: true,
        content: renderExtensionConfigForm(status),
      }));

    const slackChannel: ChannelConfig = {
      id: 'slack',
      title: t('settings.channels.slackTitle', 'Slack'),
      description: t('settings.channels.slackDesc', 'Chat with Pavii.Ai assistant via Slack'),
      status: 'active',
      enabled: slackState?.enabled || false,
      disabled: slackLoading || slackState === null,
      is_connected: slackState?.running || false,
      botUsername: slackState?.botUser,
      content: (
        <SlackConfigForm
          state={slackState}
          onCredentialsChange={(credentials) => {
            slackCredentialsRef.current = credentials;
          }}
        />
      ),
    };
    const discordChannel: ChannelConfig = {
      id: 'discord',
      title: t('settings.channels.discordTitle', 'Discord'),
      description: t('settings.channels.discordDesc', 'Chat with Pavii.Ai assistant via Discord'),
      status: 'active',
      enabled: discordState?.enabled || false,
      disabled: discordLoading || discordState === null,
      is_connected: discordState?.running || false,
      botUsername: discordState?.botUser,
      content: (
        <DiscordConfigForm
          state={discordState}
          onCredentialsChange={(credentials) => {
            discordTokenRef.current = credentials.botToken;
          }}
        />
      ),
    };

    return [telegramChannel, slackChannel, discordChannel, ...extensionChannels];
  }, [
    pluginStatus,
    extensionStatuses,
    extensionLoadingMap,
    telegramModelSelection,
    enableLoading,
    slackState,
    slackLoading,
    discordState,
    discordLoading,
    renderExtensionConfigForm,
    t,
  ]);

  // Get toggle handler for each channel
  const getToggleHandler = (channelId: string) => {
    if (channelId === 'telegram') return handleTogglePlugin;
    if (channelId === 'slack') {
      return (enabled: boolean) => {
        void handleToggleSlack(enabled);
      };
    }
    if (channelId === 'discord') {
      return (enabled: boolean) => {
        void handleToggleDiscord(enabled);
      };
    }
    if (extensionStatuses[channelId]) {
      return (enabled: boolean) => {
        void handleToggleExtensionPlugin(channelId, enabled);
      };
    }
    return undefined;
  };
  const channelGuideText = t('settings.webui.featureChannelsDesc', {
    defaultValue: 'Connect Telegram to interact with Pavii.Ai from IM apps.',
  });
  const channelSetupSteps = [
    t('settings.channels.selectFirst', {
      defaultValue: 'Select a channel and configure credentials.',
    }),
    t('settings.channels.enableAfterConfig', {
      defaultValue: 'Enable it and start chatting with your AI assistant.',
    }),
  ];

  return (
    <AionScrollArea className={isPageMode ? 'h-full' : ''}>
      <div className='px-[12px] md:px-[28px]'>
        <h2 className='text-20px font-500 text-t-primary m-0'>{t('settings.channels.title', 'Channels')}</h2>
        <div className='space-y-8px mt-10px'>
          <div className='text-13px text-t-secondary leading-relaxed'>{channelGuideText}</div>
          <div className='flex flex-wrap gap-x-12px gap-y-6px'>
            {channelSetupSteps.map((stepLabel, idx) => (
              <div key={stepLabel} className='inline-flex items-center gap-6px'>
                <span className='inline-flex items-center justify-center w-16px h-16px rd-50% text-10px font-600 bg-[rgba(var(--primary-6),0.12)] text-[rgb(var(--primary-6))]'>
                  {idx + 1}
                </span>
                <CheckOne theme='outline' size='12' className='text-[rgb(var(--primary-6))]' />
                <span className='text-12px text-t-secondary'>{stepLabel}</span>
              </div>
            ))}
          </div>
        </div>

        <div className='space-y-12px mt-12px'>
          {channels.map((channelConfig) => (
            <ChannelItem
              key={channelConfig.id}
              channel={channelConfig}
              isCollapsed={collapseKeys[channelConfig.id] || false}
              onToggleCollapse={() => handleToggleCollapse(channelConfig.id)}
              onToggleEnabled={getToggleHandler(channelConfig.id)}
            />
          ))}
        </div>
      </div>
    </AionScrollArea>
  );
};

export default ChannelModalContent;
