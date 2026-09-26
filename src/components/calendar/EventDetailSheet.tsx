/**
 * EventDetailSheet — bottom sheet with a single calendar event.
 *
 * Tapping an event used to do nothing at all: the page passed
 * `onEventClick={() => {}}` while this panel already existed, unreachable,
 * inside CalendarView. It is rebuilt here on the shared BottomSheet so it
 * inherits the swipe-to-dismiss and safe-area handling the rest of the app
 * already relies on, instead of the hand-rolled overlay it grew from.
 *
 * Type scale follows the app: 20/24/500 for the title (same as the «Стол» and
 * «Настройки» headers) and `--text-body-md` (14px) for content, rather than the
 * 12px `--text-body-sm` this first shipped with.
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

/** Matches bare http(s) URLs. Yandex puts the call link in the description. */
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Punctuation that ends a sentence rather than belonging to the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/**
 * External links open through Telegram so the Mini App is not replaced by the
 * target page; the window.open fallback matches InviteModal and the settings
 * support link.
 */
function openExternal(url: string) {
  const tg = (window as unknown as {
    Telegram?: { WebApp?: { openLink?: (u: string) => void } };
  }).Telegram?.WebApp;

  if (tg?.openLink) {
    try {
      tg.openLink(url);
      return;
    } catch {
      // fall through to the browser
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Splits description text into plain runs and links. Trailing sentence
 * punctuation is pushed back out of the URL so "встреча (https://x.co/a)."
 * does not link the closing dot.
 */
function splitLinks(text: string): { url: string | null; value: string }[] {
  const parts: { url: string | null; value: string }[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[1];

    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    if (trailing) raw = raw.slice(0, -trailing.length);

    if (start > cursor) parts.push({ url: null, value: text.slice(cursor, start) });
    if (raw) parts.push({ url: raw, value: raw });
    if (trailing) parts.push({ url: null, value: trailing });
    cursor = start + match[1].length;
  }

  if (cursor < text.length) parts.push({ url: null, value: text.slice(cursor) });
  return parts;
}

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
      className="flex items-baseline justify-between gap-4 rounded-md px-3 py-2.5"
      style={{ backgroundColor: 'var(--color-bg-surface)' }}
    >
      <span className="text-body-md shrink-0" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        className="text-body-md font-medium text-right"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {value}
      </span>
    </div>
  );
}

/** Description with its URLs turned into tappable links. */
function Description({ text }: { text: string }) {
  const parts = splitLinks(text);

  return (
    <div
      className="rounded-md px-3 py-2.5 whitespace-pre-wrap break-words"
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
        fontSize: 'var(--text-body-md)',
        lineHeight: 'var(--text-body-md-line)',
      }}
    >
      {parts.map((part, index) =>
        part.url ? (
          <a
            key={index}
            href={part.url}
            onClick={(e) => {
              e.preventDefault();
              openExternal(part.url as string);
            }}
            className="underline underline-offset-2 active:opacity-70"
            style={{ color: 'var(--color-accent-amber)', wordBreak: 'break-all' }}
          >
            {part.value}
          </a>
        ) : (
          <React.Fragment key={index}>{part.value}</React.Fragment>
        )
      )}
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

  const reminderLabel = (minutes: number | null) =>
    REMINDER_OPTIONS.find((o) => o.value === minutes)?.label ?? 'Без напоминания';

  return (
    <BottomSheet open onClose={onClose}>
      <div className="px-4 pb-4 space-y-3">
        <h2
          className="pr-2"
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: '20px',
            lineHeight: '24px',
            fontWeight: 500,
            letterSpacing: '-0.025em',
            color: 'var(--color-text-primary)',
          }}
        >
          {event.title}
        </h2>

        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-2 w-2 rounded-full flex-none"
            style={{ backgroundColor: 'var(--color-signal-yellow)' }}
            aria-hidden="true"
          />
          <span className="text-body-md" style={{ color: 'var(--color-text-muted)' }}>
            Yandex Календарь
          </span>
        </div>

        <div className="space-y-1.5">
          <Row
            label="Когда"
            value={`${formatDay(event.start_at)}, ${formatClock(event.start_at)}`}
          />
          <Row label="Длительность" value={formatDuration(event.start_at, event.end_at)} />
        </div>

        {event.description && <Description text={event.description} />}

        <div
          className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5"
          style={{ backgroundColor: 'var(--color-bg-surface)' }}
        >
          <span className="text-body-md shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            Напоминание
          </span>

          {!editingReminder ? (
            <button
              type="button"
              onClick={() => setEditingReminder(true)}
              className="text-body-md font-medium transition-opacity duration-fast active:opacity-70"
              style={{ color: 'var(--color-accent-amber)' }}
            >
              {reminderLabel(event.reminder_minutes_before)}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={reminderValue === null ? '' : String(reminderValue)}
                onChange={(e) =>
                  setReminderValue(e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={saving}
                className="rounded-sm px-2 py-1.5 text-body-md disabled:opacity-50"
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
                className="text-body-md font-medium disabled:opacity-50"
                style={{ color: 'var(--color-signal-green)' }}
              >
                {saving ? '…' : 'ОК'}
              </button>
              <button
                type="button"
                onClick={() => setEditingReminder(false)}
                disabled={saving}
                className="text-body-md"
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
