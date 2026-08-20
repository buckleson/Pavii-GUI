/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { TeamAssistant } from '@/common/types/team/teamTypes';
import type { TeamWarmupMemberState, TeamWarmupPhase } from '../hooks/useTeamWarmup';
import TeamAgentIdentity from './TeamAgentIdentity';

type Props = {
  phase: TeamWarmupPhase;
  assistants: TeamAssistant[];
  /** slot_id -> runtime state (from useTeamWarmup: the real per-member wake signal and any failure reason). */
  runtimeStatus: Map<string, TeamWarmupMemberState>;
  colorOf: (slot_id: string | undefined) => string;
  onRetry?: () => void;
};

/**
 * Team warmup overlay: frosted glass over the conversation area, starting below the column
 * headers (top-40px) so each header's model selector stays clickable - switching model is how both teammates and the leader recover from failure.
 *
 * Avatars follow the real per-member runtime signals (the backend wakes the leader first, then
 *   staggers pending by 3s): not started is dim, pending breathes in the identity colour for "waking", ready lights solid, failed greys out in red.
 * Dismissal follows the overall `phase` gate; success means everyone becomes ready at once.
 *
 * On error the overlay becomes a failure card naming the member, the reason and what to do.
 *   A failed teammate can switch model or be removed from the pills and retried; a failed leader can only switch model, never be removed.
 */
// Column headers are h-40px with a 1px bottom border; starting the overlay at 41 leaves that
// 1px line visible, separating header from overlay content more clearly (44 would cover it).
const COLUMN_HEADER_HEIGHT = 41;

/**
 * Backend errors arrive wrapped in layers (`Invalid request: failed to warm up rebuilt agent
 * <uuid>: Invalid request: Bad request: Provider 'aionrs' not found`), and only the tail means
 * anything to the user. Strip the rebuild noise and generic prefixes to leave the real cause, falling back to the original text when nothing can be extracted.
 */
export function simplifyWarmupError(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let s = raw.trim();
  // Drop the "failed to warm up rebuilt agent <uuid>:" noise in the middle
  s = s.replace(/failed to warm up rebuilt agent \S+:\s*/gi, '');
  // Collapse the repeated generic wrapper prefixes
  s = s.replace(/\b(invalid request|bad request|internal error):\s*/gi, '');
  s = s.trim();
  return s || raw.trim();
}

const TeamWarmupOverlay: React.FC<Props> = ({ phase, assistants, runtimeStatus, colorOf, onRetry }) => {
  const { t } = useTranslation();
  if (phase === 'ready') return null;

  const isFailure = phase === 'error';

  // Collect every failed member: a concurrent backend rebuild can report several at once, each with its own error.
  // Sorted stably in assistants order (leader first) so the rows read predictably.
  const failedMembers = assistants
    .filter((a) => runtimeStatus.get(a.slot_id)?.status === 'failed')
    .map((a) => ({ assistant: a, error: runtimeStatus.get(a.slot_id)?.error }));
  // With no failed member available, fall back to the leader as the single failure.
  const fallbackLeader = assistants.find((a) => a.role === 'leader');
  if (failedMembers.length === 0 && fallbackLeader) {
    failedMembers.push({ assistant: fallbackLeader, error: undefined });
  }
  const isMulti = failedMembers.length > 1;
  const single = failedMembers[0];
  const singleIsLeader = single?.assistant.role === 'leader';
  // Only offer the "remove" route when at least one failed member is a removable teammate; the leader cannot be removed.
  const anyRemovable = failedMembers.some((m) => m.assistant.role !== 'leader');

  return (
    <div
      data-testid='team-warmup-overlay'
      data-phase={phase}
      className='absolute left-0 right-0 bottom-0 z-20 flex flex-col items-center justify-center'
      style={{
        top: COLUMN_HEADER_HEIGHT,
        background: 'color-mix(in srgb, var(--bg-1) 80%, transparent)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div className='flex flex-col items-center gap-14px px-40px py-28px max-w-420px'>
        {/* Member avatars follow their own runtime state. The leader lights first, since the backend rebuilds it first. */}
        <div className='flex items-center gap-10px'>
          {assistants.slice(0, 6).map((a) => {
            const status = runtimeStatus.get(a.slot_id)?.status;
            const mc = colorOf(a.slot_id);
            const isReady = status === 'ready';
            const isPending = status === 'pending';
            const isFailed = status === 'failed';
            // Not started or failed is dim; pending is half-lit and breathing; ready is fully lit in colour; failed adds a red ring and greys out.
            const opacity = isReady || isFailed ? 1 : isPending ? 0.75 : 0.35;
            const boxShadow = isFailed
              ? '0 0 0 2px var(--danger)'
              : isReady
                ? `0 0 0 2px ${mc}, 0 0 12px 2px color-mix(in srgb, ${mc} 45%, transparent)`
                : isPending
                  ? `0 0 0 2px color-mix(in srgb, ${mc} 55%, transparent)`
                  : 'none';
            return (
              <span
                key={a.slot_id}
                data-testid={`team-warmup-avatar-${a.slot_id}`}
                data-status={status ?? 'idle'}
                className={`relative inline-flex rounded-full transition-all duration-300 ${isPending ? 'team-warmup-breathe' : ''}`}
                style={{ opacity, boxShadow }}
              >
                <TeamAgentIdentity
                  assistant_name=''
                  assistant_backend={a.assistant_backend}
                  icon={a.icon}
                  conversation_id={a.conversation_id}
                  className='!gap-0'
                  logoClassName={`w-34px h-34px object-cover rounded-full ${isFailed ? 'grayscale' : ''}`}
                  avatarClassName='w-34px h-34px rounded-full flex items-center justify-center text-15px leading-none bg-fill-2'
                  nameClassName='hidden'
                />
                {isFailed && (
                  <span
                    className='absolute -right-2px -bottom-2px w-14px h-14px rounded-full flex items-center justify-center text-9px font-700 text-white'
                    style={{ background: 'var(--danger)', border: '1.5px solid var(--bg-1)' }}
                  >
                    !
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {isFailure ? (
          <>
            <div className='text-15px font-600 text-t-primary text-center'>
              {isMulti
                ? t('team.warmup.multiFailedTitle', {
                    defaultValue: '{{count}} members failed to start',
                    count: failedMembers.length,
                  })
                : single
                  ? singleIsLeader
                    ? t('team.warmup.leaderFailedTitle', {
                        defaultValue: 'Lead {{name}} failed to start',
                        name: single.assistant.assistant_name,
                      })
                    : t('team.warmup.memberFailedTitle', {
                        defaultValue: 'Member {{name}} failed to start',
                        name: single.assistant.assistant_name,
                      })
                  : t('team.warmup.genericFailedTitle', { defaultValue: 'The team could not start' })}
            </div>
            {isMulti ? (
              // Several failures list one row each with the name and trimmed reason, scrolling within a capped height.
              <div
                data-testid='team-warmup-error'
                className='w-320px max-h-120px overflow-y-auto flex flex-col gap-4px rounded-6px px-10px py-8px'
                style={{ background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-base))' }}
              >
                {failedMembers.map((m) => (
                  <div
                    key={m.assistant.slot_id}
                    className='flex items-start gap-6px text-11px leading-relaxed text-left'
                  >
                    <span className='shrink-0 font-600' style={{ color: 'var(--danger)' }}>
                      {m.assistant.assistant_name}
                      {m.assistant.role === 'leader' ? t('team.warmup.leaderSuffix', { defaultValue: ' (Lead)' }) : ''}
                    </span>
                    <span className='min-w-0 break-words' style={{ color: 'var(--danger)' }}>
                      {simplifyWarmupError(m.error) ??
                        t('team.warmup.unknownError', { defaultValue: 'failed to start' })}
                    </span>
                  </div>
                ))}
              </div>
            ) : single?.error ? (
              <div
                data-testid='team-warmup-error'
                className='max-w-320px max-h-64px overflow-y-auto text-11px leading-relaxed text-left rounded-6px px-10px py-6px'
                style={{ background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-base))', color: 'var(--danger)' }}
              >
                {simplifyWarmupError(single.error)}
              </div>
            ) : null}
            <div className='text-12px text-t-tertiary text-center leading-relaxed'>
              {anyRemovable
                ? t('team.warmup.memberFailedHint', {
                    defaultValue: 'Switch its model above, or remove the member from the bar on top, then retry.',
                  })
                : t('team.warmup.leaderFailedHint', {
                    defaultValue: 'Switch its model in the column header above, then retry.',
                  })}
            </div>
            {onRetry && (
              <button
                type='button'
                onClick={onRetry}
                data-testid='team-warmup-retry'
                className='mt-4px flex items-center gap-6px h-32px px-18px rounded-8px border-none text-13px font-500 text-white cursor-pointer'
                style={{ background: 'var(--brand)' }}
              >
                <Refresh theme='outline' size='14' fill='currentColor' />
                {t('team.warmup.retry', { defaultValue: 'Retry' })}
              </button>
            )}
          </>
        ) : (
          <>
            <div className='text-15px font-600 text-t-primary'>
              {t('team.warmup.title', { defaultValue: 'Waking up the team…' })}
            </div>
            <div className='text-12px text-t-tertiary'>
              {t('team.warmup.subtitle', { defaultValue: 'Getting members ready' })}
            </div>
            {/* Brand-coloured progress bar, indeterminate and sweeping back and forth */}
            <div className='w-180px h-4px rounded-2px overflow-hidden' style={{ background: 'var(--bg-3)' }}>
              <div
                className='h-full rounded-2px team-warmup-sweep'
                style={{ background: 'linear-gradient(90deg, var(--brand-hover), var(--brand))' }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TeamWarmupOverlay;
