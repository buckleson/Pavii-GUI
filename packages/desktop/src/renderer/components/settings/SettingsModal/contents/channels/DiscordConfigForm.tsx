/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PaviiChannelState } from '@/common/adapter/ipcBridge';
import { shell } from '@/common/adapter/ipcBridge';
import { Button, Input, Typography } from '@arco-design/web-react';
import { LinkTwo } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

type DiscordConfigFormProps = {
  state: PaviiChannelState | null;
  onCredentialsChange: (credentials: { botToken: string }) => void;
};

/**
 * Credential form for the app-hosted Discord bridge (Gateway). v1 flow: one
 * bot token, with the guide showing exactly where it lives and how to invite
 * the bot.
 */
const DiscordConfigForm: React.FC<DiscordConfigFormProps> = ({ state, onCredentialsChange }) => {
  const { t } = useTranslation();
  const [botToken, setBotToken] = useState('');

  const steps: string[] = [
    t('settings.channels.discordStep1', {
      defaultValue: 'Open discord.com/developers/applications, click "New Application", and name it (e.g. Pavii).',
    }),
    t('settings.channels.discordStep2', {
      defaultValue:
        'On the "Bot" tab, click "Reset Token" and copy the token. Below it, enable "Message Content Intent".',
    }),
    t('settings.channels.discordStep3', {
      defaultValue:
        'On "OAuth2" > "URL Generator", check scope "bot" and permissions "Send Messages" + "Read Message History", then open the generated URL to invite the bot to your server.',
    }),
    t('settings.channels.discordStep4', {
      defaultValue: 'Paste the bot token here and turn the switch on. DM the bot or @mention it in a channel to chat.',
    }),
  ];

  return (
    <div className='space-y-12px py-8px'>
      <Typography.Paragraph className='mb-0 text-13px text-t-secondary'>
        {t('settings.channels.discordSetupHint', {
          defaultValue:
            'Connect your own Discord bot: paste one token, invite the bot to your server, and DM or @mention it to chat with your Pavii assistant.',
        })}
      </Typography.Paragraph>

      <div className='rd-10px border border-line bg-fill-1 px-12px py-10px space-y-8px'>
        <div className='flex items-center justify-between gap-8px'>
          <span className='text-13px font-500 text-t-primary'>
            {t('settings.channels.discordWhereTitle', { defaultValue: 'Where do I find the token?' })}
          </span>
          <Button
            size='mini'
            type='primary'
            icon={<LinkTwo size={12} />}
            onClick={() => void shell.openExternal.invoke('https://discord.com/developers/applications')}
          >
            {t('settings.channels.discordOpenConsole', { defaultValue: 'Open Discord console' })}
          </Button>
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
          {t('settings.channels.discordBotToken', { defaultValue: 'Bot token' })}
        </div>
        <Input.Password
          value={botToken}
          onChange={(value) => {
            setBotToken(value);
            onCredentialsChange({ botToken: value.trim() });
          }}
          placeholder={t('settings.channels.discordBotTokenPlaceholder', { defaultValue: 'Paste your bot token' })}
          data-testid='discord-bot-token'
        />
      </div>
      {state?.running && (
        <div className='text-13px text-success'>
          {t('settings.channels.discordConnected', {
            defaultValue: 'Connected as {{bot}}',
            bot: state.botUser ?? 'bot',
          })}
        </div>
      )}
      {state?.error && !state.running && <div className='text-13px text-danger'>{state.error}</div>}
    </div>
  );
};

export default DiscordConfigForm;
