'use client';

import { ChevronRight } from 'lucide-react';
import { PlanBadge } from './PlanBadge';

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
    <div className="flex flex-col items-center gap-4 w-full">
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
      <div className="flex items-center gap-2 w-full justify-center">
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

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between w-full px-3 py-[14px] cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 6,
        border: '1px solid var(--color-line)',
        // Chamfered corners: top-left + bottom-right (action style)
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${value}`}
    >
      <span
        className="text-base font-medium leading-5 text-white"
        style={{ fontFamily: 'var(--font-family-display)' }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          className="text-base font-medium leading-5 text-white"
          style={{ fontFamily: 'var(--font-family-display)' }}
        >
          {value}
        </span>
        <ChevronRight className="h-5 w-5 text-text-secondary shrink-0" />
      </div>
    </div>
  );
}