/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { Button, Spin } from '@arco-design/web-react';
import { ShareOne } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { useThemeContext } from '@renderer/hooks/context/ThemeContext';
import { resolveConversationBackend } from '@renderer/pages/conversation/utils/conversationAssistantIdentity';
import ActivityHeatmap from './ActivityHeatmap';
import ShareModal from './ShareModal';
import type { ConversationStatsInput, LedgerDays } from './profileStats';
import { computeProfileStats, formatCompactNumber, formatDuration } from './profileStats';

/**
 * Profile page: identity, activity stats, and "most used" insights.
 * Token figures come from the local usage ledger (accumulating since this
 * build); activity/streaks also draw on conversation timestamps. MCP/skill
 * entries are creation-time attachments, labelled accordingly.
 */

const conversationExtra = (conversation: TChatConversation): { mcp_servers?: string[]; skills?: string[] } =>
  (conversation.extra ?? {}) as { mcp_servers?: string[]; skills?: string[] };

const conversationModel = (conversation: TChatConversation): string | undefined => {
  const extra = conversation.extra as { current_model_id?: string; codexModel?: string } | undefined;
  const model = (conversation as { model?: { use_model?: string } }).model;
  return model?.use_model || extra?.current_model_id || extra?.codexModel || undefined;
};

const initialsOf = (name: string | undefined, email: string | undefined): string => {
  const base = (name || email || 'P').trim();
  const parts = base.split(/\s+/);
  const first = parts[0]?.[0] ?? 'P';
  const second = parts.length > 1 ? (parts[1][0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase();
};

const ProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useThemeContext();
  const [shareOpen, setShareOpen] = useState(false);

  const { data: session } = useSWR('pavii-auth.session', () => ipcBridge.paviiAuth.getSession.invoke());
  const { data: ledger } = useSWR('pavii-usage.ledger', () => ipcBridge.paviiUsage.get.invoke());
  const { data: conversationsPage, isLoading } = useSWR('profile.conversations', () =>
    ipcBridge.database.getUserConversations.invoke({ limit: 10000 })
  );

  const stats = useMemo(() => {
    const ledgerDays = (ledger?.days ?? {}) as LedgerDays;
    const conversations: ConversationStatsInput[] = (conversationsPage?.items ?? []).map((conversation) => ({
      created_at: conversation.created_at,
      modified_at: conversation.modified_at,
      backend: resolveConversationBackend(conversation),
      model: conversationModel(conversation),
      mcpServers: conversationExtra(conversation).mcp_servers,
      skills: conversationExtra(conversation).skills,
    }));
    return computeProfileStats(ledgerDays, conversations);
  }, [ledger, conversationsPage]);

  const signOut = () => {
    void ipcBridge.paviiAuth.signOut.invoke().then(() => window.location.reload());
  };

  const displayName = session?.name || session?.email?.split('@')[0] || 'Pavii user';
  const isDark = theme === 'dark';

  const tiles: Array<{ value: string; label: string }> = [
    {
      value: formatCompactNumber(stats.totalTokens),
      label: t('profile.lifetimeTokens', { defaultValue: 'Lifetime tokens' }),
    },
    {
      value: stats.peakDay ? formatCompactNumber(stats.peakDay.tokens) : '0',
      label: t('profile.peakTokens', { defaultValue: 'Peak day' }),
    },
    {
      value: stats.longestChatMs > 0 ? formatDuration(stats.longestChatMs) : '0m',
      label: t('profile.longestChat', { defaultValue: 'Longest chat' }),
    },
    {
      value: `${stats.currentStreak} ${t('profile.days', { defaultValue: 'days' })}`,
      label: t('profile.currentStreak', { defaultValue: 'Current streak' }),
    },
    {
      value: `${stats.longestStreak} ${t('profile.days', { defaultValue: 'days' })}`,
      label: t('profile.longestStreak', { defaultValue: 'Longest streak' }),
    },
  ];

  const insights: Array<{ label: string; value: string }> = [
    {
      label: t('profile.mostUsedCli', { defaultValue: 'Most used CLI' }),
      value: stats.mostUsedBackend?.name ?? '-',
    },
    {
      label: t('profile.mostUsedModel', { defaultValue: 'Most used AI model' }),
      value: stats.mostUsedModel?.name ?? '-',
    },
    {
      label: t('profile.mostAttachedMcp', { defaultValue: 'Most attached MCP server' }),
      value: stats.mostAttachedMcp?.name ?? '-',
    },
    {
      label: t('profile.mostAttachedSkill', { defaultValue: 'Most attached skill' }),
      value: stats.mostAttachedSkill?.name ?? '-',
    },
    {
      label: t('profile.skillsUsed', { defaultValue: 'Skills used' }),
      value: `${stats.skillsUsedCount}`,
    },
    {
      label: t('profile.totalChats', { defaultValue: 'Total chats' }),
      value: `${stats.totalChats}`,
    },
  ];

  return (
    <div className='h-full overflow-y-auto bg-base'>
      <div className='mx-auto max-w-760px px-24px py-40px'>
        <div className='mb-8px flex items-center justify-between'>
          <div className='text-14px font-medium text-t-secondary'>
            {t('profile.title', { defaultValue: 'Profile' })}
          </div>
          <div className='flex items-center gap-8px'>
            <Button icon={<ShareOne size={14} />} onClick={() => setShareOpen(true)}>
              {t('profile.share', { defaultValue: 'Share' })}
            </Button>
            <Button status='danger' type='text' onClick={signOut} data-testid='profile-sign-out'>
              {t('profile.signOut', { defaultValue: 'Sign out' })}
            </Button>
          </div>
        </div>

        <div className='mb-32px flex flex-col items-center pt-16px text-center'>
          <div className='mb-12px flex size-80px items-center justify-center rounded-full bg-primary text-28px font-bold text-white'>
            {initialsOf(session?.name, session?.email)}
          </div>
          <div className='text-24px font-bold text-t-primary'>{displayName}</div>
          {session?.email && <div className='text-13px text-t-tertiary'>{session.email}</div>}
        </div>

        {isLoading ? (
          <div className='flex justify-center py-48px'>
            <Spin size={24} />
          </div>
        ) : (
          <>
            <div className='mb-32px grid grid-cols-2 gap-1px overflow-hidden rounded-12px border border-base bg-3 md:grid-cols-5'>
              {tiles.map((tile) => (
                <div key={tile.label} className='flex flex-col items-center bg-base px-12px py-16px'>
                  <div className='text-20px font-bold text-t-primary'>{tile.value}</div>
                  <div className='mt-2px text-12px text-t-tertiary'>{tile.label}</div>
                </div>
              ))}
            </div>

            <div className='mb-8px flex items-baseline justify-between'>
              <div className='text-15px font-semibold text-t-primary'>
                {t('profile.activity', { defaultValue: 'Token activity' })}
              </div>
              {stats.firstLedgerDay && (
                <div className='text-12px text-t-tertiary'>
                  {t('profile.since', { defaultValue: 'since {{day}}', day: stats.firstLedgerDay })}
                </div>
              )}
            </div>
            <div className='mb-32px rounded-12px border border-base p-16px'>
              <ActivityHeatmap daily={stats.daily} />
            </div>

            <div className='mb-8px text-15px font-semibold text-t-primary'>
              {t('profile.insights', { defaultValue: 'Activity insights' })}
            </div>
            <div className='rounded-12px border border-base'>
              {insights.map((insight, i) => (
                <div
                  key={insight.label}
                  className={`flex items-center justify-between px-16px py-12px ${i > 0 ? 'border-t border-base' : ''}`}
                >
                  <span className='text-14px text-t-secondary'>{insight.label}</span>
                  <span className='text-14px font-medium text-t-primary'>{insight.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ShareModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        isDark={isDark}
        data={{
          name: displayName,
          handle: session?.email ?? '',
          initials: initialsOf(session?.name, session?.email),
          totalTokens: stats.totalTokens,
          peakDayTokens: stats.peakDay?.tokens ?? 0,
          currentStreak: stats.currentStreak,
          longestStreak: stats.longestStreak,
          daily: stats.daily,
        }}
      />
    </div>
  );
};

export default ProfilePage;
