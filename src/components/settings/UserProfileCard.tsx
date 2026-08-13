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
        className="flex items-center justify-center rounded bg-surface"
        style={{ width: 104, height: 104, borderRadius: 4 }}
        aria-label="Аватар пользователя"
      >
        {/* Placeholder avatar — in production this would be user image */}
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
        <StatusRow label="Статус" value={statusLabel} />
      )}
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between w-full px-3 py-[14px]"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 6,
      }}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${value}`}
    >
      {/* Left decorative line */}
      <div
        className="h-[18px] w-[2px]"
        style={{ backgroundColor: '#F59E0B' }}
        aria-hidden="true"
      />
      <span
        className="text-base font-medium leading-5 text-amber"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {label}
      </span>
      <span
        className="text-base font-medium leading-5 text-white"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {value}
      </span>
      <ChevronRight className="h-5 w-5 text-text-secondary" />
    </div>
  );
}