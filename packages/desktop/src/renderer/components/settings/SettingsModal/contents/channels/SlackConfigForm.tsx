/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PaviiChannelState } from '@/common/adapter/ipcBridge';
import { shell } from '@/common/adapter/ipcBridge';
import { Button, Input, Message, Typography } from '@arco-design/web-react';
import { Copy, LinkTwo } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

type SlackConfigFormProps = {
  state: PaviiChannelState | null;
  onCredentialsChange: (credentials: { botToken: string; appToken: string }) => void;
};

/**
 * Pre-configured Slack app manifest: pasting it while creating an app sets up
 * the bot user, scopes, Socket Mode, and event subscriptions in one step, so
 * users only have to collect the two tokens.
 */
const SLACK_APP_MANIFEST = JSON.stringify(
  {
    display_information: { name: 'Pavii' },
    features: { bot_user: { display_name: 'Pavii', always_online: true } },
    oauth_config: {
      scopes: { bot: ['chat:write', 'app_mentions:read', 'im:history', 'im:write', 'channels:history'] },
    },
    settings: {
      event_subscriptions: { bot_events: ['message.im', 'app_mention'] },
      socket_mode_enabled: true,
      interactivity: { is_enabled: false },
    },
  },
  null,
  2
);

/**
 * Credential form for the app-hosted Slack bridge (Socket Mode). v1 flow:
 * users create their own Slack app and paste two tokens; the form shows
 * exactly where each one lives.
 */
const SlackConfigForm: React.FC<SlackConfigFormProps> = ({ state, onCredentialsChange }) => {
  const { t } = useTranslation();
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');

  const update = (nextBot: string, nextApp: string) => {
    onCredentialsChange({ botToken: nextBot.trim(), appToken: nextApp.trim() });
  };

  const copyManifest = () => {
    void navigator.clipboard
      .writeText(SLACK_APP_MANIFEST)
      .then(() => Message.success(t('settings.channels.slackManifestCopied', { defaultValue: 'Manifest copied.' })))
      .catch(() => {});
  };

  const steps: string[] = [
    t('settings.channels.slackStep1', {
      defaultValue: 'Open api.slack.com/apps, click "Create New App", and choose "From a manifest".',
    }),
    t('settings.channels.slackStep2', {
      defaultValue: 'Pick your workspace, paste the copied manifest, and create the app.',
    }),
    t('settings.channels.slackStep3', {
      defaultValue: 'On "OAuth & Permissions", click "Install to Workspace", then copy the Bot token (xoxb-...).',
    }),
    t('settings.channels.slackStep4', {
      defaultValue:
        'On "Basic Information" under "App-Level Tokens", generate a token with the connections:write scope and copy it (xapp-...).',
    }),
  ];

  return (
    <div className='space-y-12px py-8px'>
      <Typography.Paragraph className='mb-0 text-13px text-t-secondary'>
        {t('settings.channels.slackSetupHint', {
          defaultValue:
            'Connect your own Slack app: paste two tokens once, and DM the bot (or @mention it) to chat with your Pavii assistant from Slack.',
        })}
      </Typography.Paragraph>

      {/* Where to find the keys */}
      <div className='rd-10px border border-line bg-fill-1 px-12px py-10px space-y-8px'>
        <div className='flex items-center justify-between gap-8px'>
          <span className='text-13px font-500 text-t-primary'>
            {t('settings.channels.slackWhereTitle', { defaultValue: 'Where do I find the keys?' })}
          </span>
          <div className='flex items-center gap-6px'>
            <Button size='mini' icon={<Copy size={12} />} onClick={copyManifest}>
              {t('settings.channels.slackCopyManifest', { defaultValue: 'Copy manifest' })}
            </Button>
            <Button
              size='mini'
              type='primary'
              icon={<LinkTwo size={12} />}
              onClick={() => void shell.openExternal.invoke('https://api.slack.com/apps?new_app=1')}
            >
              {t('settings.channels.slackOpenConsole', { defaultValue: 'Open Slack console' })}
            </Button>
          </div>
        </div>
        <ol className='m-0 pl-16px space-y-4px'>
          {steps.map((step, index) => (
            <li key={index} className='text-12px text-t-secondary leading-relaxed'>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className='space-y-6px'>
        <div className='text-13px text-t-primary'>
          {t('settings.channels.slackBotToken', { defaultValue: 'Bot token (xoxb-...)' })}
        </div>
        <Input.Password
          value={botToken}
          onChange={(value) => {
            setBotToken(value);
            update(value, appToken);
          }}
          placeholder='xoxb-...'
          data-testid='slack-bot-token'
        />
      </div>
      <div className='space-y-6px'>
        <div className='text-13px text-t-primary'>
          {t('settings.channels.slackAppToken', {
            defaultValue: 'App-level token (xapp-..., scope connections:write)',
          })}
        </div>
        <Input.Password
          value={appToken}
          onChange={(value) => {
            setAppToken(value);
            update(botToken, value);
          }}
          placeholder='xapp-...'
          data-testid='slack-app-token'
        />
      </div>
      {state?.running && (
        <div className='text-13px text-success'>
          {t('settings.channels.slackConnected', {
            defaultValue: 'Connected as {{bot}} in {{team}}',
            bot: state.botUser ?? 'bot',
            team: state.team ?? 'workspace',
          })}
        </div>
      )}
      {state?.error && !state.running && <div className='text-13px text-danger'>{state.error}</div>}
    </div>
  );
};

export default SlackConfigForm;
