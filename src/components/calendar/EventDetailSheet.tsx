/**
 * EventDetailSheet — bottom sheet with a single calendar event.
 *
 * Tapping an event used to do nothing at all: the page passed
 * `onEventClick={() => {}}` while this panel already existed, unreachable,
 * inside CalendarView. It is rebuilt here on the shared BottomSheet so it
 * inherits the swipe-to-dismiss and safe-area handling the rest of the app
 * already relies on, instead of the hand-rolled overlay it grew from.
 */

'use client';

import React, { useEffect, useState } from 'react';
import type { CalendarEvent } from '@/types/calendar';
import { BottomSheet } from '@/components/ui/BottomSheet';

interface EventDetailSheetProps {
  event: CalendarEvent | null;
  onClose: () => void;
  onEditReminder: (eventId: string, minutes: number | null) => Promise<void>;
}

const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Без напоминания' },
  { value: 5, label: 'За 5 мин' },
  { value: 10, label: 'За 10 мин' },
  { value: 15, label: 'За 15 мин' },
  { value: 30, label: 'За 30 мин' },
  { value: 60, label: 'За 1 час' },
];

/** "среда, 14 августа" */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** "30 мин" / "1 ч 30 мин" */
function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  );
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
      style={{ backgroundColor: 'var(--color-bg-surface)' }}
    >
      <span className="text-body-sm shrink-0" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span className="text-body-sm font-medium text-right" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

export function EventDetailSheet({ event, onClose, onEditReminder }: EventDetailSheetProps) {
  const [editingReminder, setEditingReminder] = useState(false);
  const [reminderValue, setReminderValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // BottomSheet keeps children mounted, so a new event has to re-seed the form
  // or the previous event's reminder would be offered for this one.
  useEffect(() => {
    setEditingReminder(false);
    setReminderValue(event?.reminder_minutes_before ?? null);
  }, [event?.id, event?.reminder_minutes_before]);

  // Hooks above run unconditionally, so returning null here is safe.
  if (!event) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onEditReminder(event.id, reminderValue);
      setEditingReminder(false);
    } finally {
      setSaving(false);
    }
  };

  const reminderLabel = (minutes: number | null) => {
    const option = REMINDER_OPTIONS.find((o) => o.value === minutes);
    return option?.label ?? 'Без напоминания';
  };

  return (
    <BottomSheet open onClose={onClose}>
      <div className="px-4 pb-4 space-y-3">
        <h2
          className="text-heading-sm font-semibold pr-2"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {event.title}
        </h2>

        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: 'var(--color-signal-yellow)' }}
            aria-hidden="true"
          />
          <span className="text-body-sm" style={{ color: 'var(--color-text-muted)' }}>
            Yandex Календарь
          </span>
        </div>

        <div className="space-y-1.5">
          <Row
            label="Когда"
            value={`${formatDay(event.start_at)}, ${formatClock(event.start_at)}`}
          />
          <Row
            label="Длительность"
            value={formatDuration(event.start_at, event.end_at)}
          />
        </div>

        {event.description && (
          <div
            className="rounded-md px-3 py-2 whitespace-pre-wrap"
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-body-sm)',
            }}
          >
            {event.description}
          </div>
        )}

        <div
          className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
          style={{ backgroundColor: 'var(--color-bg-surface)' }}
        >
          <span className="text-body-sm shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            Напоминание
          </span>

          {!editingReminder ? (
            <button
              type="button"
              onClick={() => setEditingReminder(true)}
              className="text-body-sm font-medium transition-opacity duration-fast active:opacity-70"
              style={{ color: 'var(--color-accent-amber)' }}
            >
              {reminderLabel(event.reminder_minutes_before)}
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <select
                value={reminderValue === null ? '' : String(reminderValue)}
                onChange={(e) =>
                  setReminderValue(e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={saving}
                className="rounded-sm px-2 py-1 text-body-sm disabled:opacity-50"
                style={{
                  color: 'var(--color-text-primary)',
                  backgroundColor: 'var(--color-bg-surface-hover)',
                  border: '1px solid var(--color-border-white-subtle)',
                }}
                aria-label="Время напоминания"
              >
                {REMINDER_OPTIONS.map((option) => (
                  <option key={String(option.value)} value={option.value ?? ''}>
                    {option.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-body-sm font-medium disabled:opacity-50"
                style={{ color: 'var(--color-signal-green)' }}
              >
                {saving ? '…' : 'ОК'}
              </button>
              <button
                type="button"
                onClick={() => setEditingReminder(false)}
                disabled={saving}
                className="text-body-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
