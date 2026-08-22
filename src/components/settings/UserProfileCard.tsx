'use client';

import { PlanBadge } from './PlanBadge';
import { SettingsRow } from './SettingsRow';

/**
 * UserProfileCard — секция "personal" на Figma-макете.
 * Содержит: аватар, имя пользователя, бейдж тарифа, строку статуса.
 * Figma: frame "personal" #99:7918
 */
export function UserProfileCard({
  username,
  planName,
  price,
  statusLabel,
}: {
  username: string;
  planName: string;
  price: string;
  statusLabel?: string;
}) {
    return (
    <div className="flex flex-col gap-4 w-full bg-surface rounded-[8px] p-3">
      {/* Avatar circle */}
      <div
        className="flex items-center justify-center bg-surface"
        style={{ width: 104, height: 104, borderRadius: 4 }}
        aria-label="Аватар пользователя"
      >
        <span
          className="text-[32px] font-medium text-text-muted"
          style={{ fontFamily: 'var(--font-family-display)' }}
        >
          {username.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Username + plan badge row */}
      <div className="flex items-center gap-2 w-full">
        <span
          className="text-[20px] font-medium leading-[24px] text-white tracking-[-0.025em]"
          style={{ fontFamily: 'var(--font-family-display)' }}
        >
          {username}
        </span>
        <PlanBadge planName={planName} price={price} />
      </div>

      {/* Status row */}
      {statusLabel && (
        <SettingsRow label="Статус" value={statusLabel} />
      )}
    </div>
  );
}