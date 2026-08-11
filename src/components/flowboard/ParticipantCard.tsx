'use client';

/**
 * ParticipantCard — lightweight worker card for task participants.
 *
 * Differs from the full WorkerCardData by omitting sprint info, task lists,
 * and the separator line. Shows only:
 *   - Avatar (or placeholder circle)
 *   - Display name
 *   - Role badge (Постановщик / Исполнитель / Соисполнитель / Наблюдатель)
 */

import { Card } from '@/components/ui/desk-ui';

export interface ParticipantCardProps {
  /** Worker UUID */
  id: string;
  /** Display name */
  displayName: string;
  /** Optional avatar URL */
  avatarUrl?: string;
  /** Role label shown as badge */
  role: 'Постановщик' | 'Исполнитель' | 'Соисполнитель' | 'Наблюдатель';
  /** Optional extra CSS classes */
  className?: string;
}

const ROLE_COLORS: Record<ParticipantCardProps['role'], string> = {
  Постановщик: 'var(--color-primary)',
  Исполнитель: 'var(--color-priority-yellow-text)',
  Соисполнитель: 'var(--color-priority-blue-text)',
  Наблюдатель: 'var(--color-text-secondary)',
};

export default function ParticipantCard({
  id,
  displayName,
  avatarUrl,
  role,
  className = '',
}: ParticipantCardProps) {
  return (
    <Card className={className}>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-secondary"
          aria-hidden="true"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-lg font-medium text-text-secondary">
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        {/* Name + Role */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-medium text-text">
            {displayName}
          </span>
          <span
            className="truncate text-xs"
            style={{ color: ROLE_COLORS[role] }}
          >
            {role}
          </span>
        </div>
      </div>
    </Card>
  );
}