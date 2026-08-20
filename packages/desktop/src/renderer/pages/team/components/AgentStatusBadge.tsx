import React from 'react';
import type { TeammateStatus } from '@/common/types/team/teamTypes';

type Props = {
  status: TeammateStatus;
  testId?: string;
  /** As an overlay dot on an avatar: absolutely positioned bottom-right with a ring so it lifts off the avatar. */
  overlay?: boolean;
};

const STATUS_CONFIG: Record<TeammateStatus, { color: string }> = {
  pending: { color: 'bg-gray-400' },
  idle: { color: 'bg-gray-400' },
  active: { color: 'bg-green-500' },
  completed: { color: 'bg-gray-400' },
  failed: { color: 'bg-red-500' },
  // Dormant = never woken (leader-only warmup). Hollow/outlined dot reads as
  // "asleep", visually distinct from idle's solid gray.
  dormant: { color: 'bg-transparent border border-solid border-gray-400' },
};

const FALLBACK_COLOR = 'bg-gray-400';

const AgentStatusBadge: React.FC<Props> = ({ status, testId, overlay = true }) => {
  const color = STATUS_CONFIG[status]?.color ?? FALLBACK_COLOR;
  const overlayClass = overlay
    ? 'absolute -bottom-1px -right-1px w-8px h-8px border-2 border-solid border-[color:var(--color-bg-base)]'
    : 'inline-block w-2 h-2';
  return (
    <span
      data-testid={testId}
      className={`${overlayClass} rounded-full ${color} ${status === 'active' ? 'animate-pulse' : ''}`}
      aria-label={status}
    />
  );
};

export default AgentStatusBadge;
