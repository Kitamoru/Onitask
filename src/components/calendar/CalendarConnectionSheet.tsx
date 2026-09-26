/**
 * CalendarConnectionSheet — actions for one connected calendar account.
 *
 * Opened by tapping the account pill. The inline sync icon that used to sit
 * inside the pill is gone: a one-tap action hidden in a 12px glyph is hard to
 * find, and a destructive action does not belong one stray tap away.
 *
 * Deleting is two-step and names the number of events it will destroy, because
 * it has no undo.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { IconRefresh, IconTrash } from '@tabler/icons-react';
import type { CalendarConnection } from '@/types/calendar';
import { BottomSheet } from '@/components/ui/BottomSheet';

interface CalendarConnectionSheetProps {
  connection: CalendarConnection | null;
  onClose: () => void;
  onSync: (connection: CalendarConnection) => void;
  onDelete: (connection: CalendarConnection) => Promise<void>;
  isSyncing: boolean;
  eventCount: number;
  /** True when other accounts remain, so their events are re-fetched, not lost. */
  hasOtherAccounts: boolean;
}

const PROVIDER_LABEL: Record<CalendarConnection['provider'], string> = {
  yandex: 'Яндекс',
};

const PROVIDER_COLOR: Record<CalendarConnection['provider'], string> = {
  yandex: 'var(--color-signal-yellow)',
};

export function CalendarConnectionSheet({
  connection,
  onClose,
  onSync,
  onDelete,
  isSyncing,
  eventCount,
  hasOtherAccounts,
}: CalendarConnectionSheetProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    setConfirming(false);
    setError(null);
  }, [connection?.id]);

  if (!connection) return null;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete(connection);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить интеграцию');
    } finally {
      setDeleting(false);
    }
  };

  const actionRow = 'flex w-full items-center gap-3 rounded-card px-3 py-3 text-left transition-colors duration-fast active:opacity-70 disabled:opacity-50';

  return (
    <BottomSheet open onClose={onClose}>
      <div
        className="px-4 pb-4 flex flex-col gap-2"
        style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex items-center gap-2 pb-1">
          <span
            className="flex h-2.5 w-2.5 rounded-full flex-none"
            style={{ backgroundColor: PROVIDER_COLOR[connection.provider] }}
            aria-hidden="true"
          />
          <span
            className="truncate text-body-md font-medium"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {connection.provider_account_email}
          </span>
          <span className="text-body-sm" style={{ color: 'var(--color-text-muted)' }}>
            {' · '}
            {PROVIDER_LABEL[connection.provider]}
          </span>
        </div>

        {!confirming ? (
          <>
            <button
              type="button"
              onClick={() => onSync(connection)}
              disabled={isSyncing}
              className={actionRow}
              style={{ backgroundColor: 'var(--color-bg-surface)' }}
            >
              <IconRefresh size={18} stroke={1.75} className="flex-none" aria-hidden="true" />
              <span className="text-body-md" style={{ color: 'var(--color-text-primary)' }}>
                {isSyncing ? 'Синхронизация…' : 'Синхронизировать'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={actionRow}
              style={{ backgroundColor: 'var(--color-bg-surface)' }}
            >
              <IconTrash size={18} stroke={1.75} className="flex-none" aria-hidden="true" />
              <span className="text-body-md" style={{ color: 'var(--color-error)' }}>
                Удалить интеграцию
              </span>
            </button>
          </>
        ) : (
          <div
            className="flex flex-col gap-3 rounded-card px-3 py-3"
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              border: '1px solid var(--color-error)',
            }}
          >
            <p className="text-body-sm" style={{ color: 'var(--color-text-primary)' }}>
              {hasOtherAccounts
                ? 'События этого календаря будут удалены и заново загружены из других интеграций.'
                : eventCount > 0
                  ? `Будут удалены все события календаря (${eventCount}). Отменить это нельзя.`
                  : 'Интеграция будет отключена. Событий для удаления нет.'}
            </p>

            {error && (
              <p className="text-body-sm" style={{ color: 'var(--color-error)' }}>
                {error}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-card px-3 py-2 text-body-md font-medium transition-opacity duration-fast active:opacity-70 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-error)', color: 'var(--color-bg-primary-dark)' }}
              >
                {deleting ? 'Удаляем…' : 'Удалить'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-card px-3 py-2 text-body-md transition-opacity duration-fast active:opacity-70 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-bg-surface-hover)' }}
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}