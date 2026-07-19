/**
 * CalendarView — Main calendar component using react-day-picker
 * 
 * Uses Onitask design tokens from src/styles/tokens.css
 * Displays calendar events in a month grid with event indicators
 */

'use client';

import React, { useMemo, useState } from 'react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import type { CalendarEvent } from '@/types/calendar';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface CalendarViewProps {
  events: CalendarEvent[];
  selectedDate?: Date;
  onDateSelect?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  isLoading?: boolean;
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/**
 * Groups events by date string (YYYY-MM-DD).
 */
function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  
  for (const event of events) {
    const dateKey = new Date(event.start_at).toISOString().split('T')[0];
    const existing = map.get(dateKey) ?? [];
    existing.push(event);
    map.set(dateKey, existing);
  }
  
  return map;
}

/**
 * Formats time from ISO string (HH:MM).
 */
function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Gets provider badge color based on token colors.
 */
function getProviderColor(provider: CalendarEvent['provider']): string {
  return provider === 'yandex'
    ? 'var(--color-signal-yellow)'
    : 'var(--color-signal-cyan)';
}

// ═══════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════

/**
 * Provider badge showing calendar source.
 */
function ProviderBadge({ provider }: { provider: CalendarEvent['provider'] }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-xs px-1 py-0.5"
      style={{
        backgroundColor: `${getProviderColor(provider)}20`,
        color: getProviderColor(provider),
        fontSize: 'var(--text-body-xs)',
        fontWeight: 'var(--font-weight-medium)',
      }}
    >
      {provider === 'yandex' ? 'Я' : 'O'}
    </span>
  );
}

/**
 * Event chip displayed inside a calendar day cell.
 */
function EventChip({
  event,
  onClick,
}: {
  event: CalendarEvent;
  onClick: (event: CalendarEvent) => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      className="
        w-full text-left truncate rounded-sm px-1 py-0.5
        transition-colors duration-fast
        hover:bg-surface-hover
        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-amber
      "
      style={{
        borderLeft: `2px solid ${getProviderColor(event.provider)}`,
        fontSize: 'var(--text-body-xs)',
        color: 'var(--color-text-primary)',
        lineHeight: '1.2',
      }}
      title={`${event.title}\n${formatTime(event.start_at)} – ${formatTime(event.end_at)}`}
      aria-label={`Событие: ${event.title}`}
    >
      {event.title.length > 20
        ? `${event.title.slice(0, 20)}…`
        : event.title}
    </button>
  );
}

/**
 * Day cell component — renders date number + event chips.
 */
function CustomDayCell({
  date,
  events,
  onEventClick,
}: {
  date: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const hasEvents = events.length > 0;
  const maxShow = 3;
  const displayEvents = events.slice(0, maxShow);
  const moreCount = events.length - maxShow;

  return (
    <div
      className="
        flex flex-col items-center justify-start
        p-0.5
        min-h-[2.5rem]
      "
    >
      <span
        className="
          flex h-7 w-7 items-center justify-center rounded-full
          text-body-md font-medium
          transition-colors duration-fast
        "
        style={{
          color: 'var(--color-text-primary)',
        }}
      >
        {date.getDate()}
      </span>
      
      {hasEvents && (
        <div className="mt-0.5 w-full space-y-0.5">
          {displayEvents.map((event) => (
            <EventChip key={event.id} event={event} onClick={onEventClick} />
          ))}
          {moreCount > 0 && (
            <span
              className="truncate text-center"
              style={{
                fontSize: 'var(--text-body-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              +{moreCount} ещё
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Event detail panel — shows when an event is clicked.
 */
function EventDetailPanel({
  event,
  onClose,
  onEditReminder,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onEditReminder: (eventId: string, minutes: number | null) => void;
}) {
  const [showReminder, setShowReminder] = useState(false);
  const [reminderValue, setReminderValue] = useState<number | null>(
    event.reminder_minutes_before ?? 15
  );

  const handleSaveReminder = async () => {
    await onEditReminder(event.id, reminderValue);
    setShowReminder(false);
  };

  /**
   * Calculate bottom offset for Telegram MainButton area.
   * When running inside Telegram WebApp, the modal must avoid overlap
   * with the native Telegram "MainButton" which can occupy ~54px at bottom.
   */
  const tgBottomOffset = typeof window !== 'undefined'
    ? ((window as any).Telegram?.WebApp?.mainButton?.height || 0)
    : 0;

  // Safe area bottom inset (CSS env() — read from computed styles if available)
  const safeAreaBottom = typeof window !== 'undefined' && document.documentElement
    ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom') || '0', 10)
    : 0;

  return (
    <div
      className="
        fixed inset-x-0 z-modal flex items-end justify-center
        sm:items-center
        /* Safe area for notched devices + Telegram MainButton */
        pb-safe-bottom pt-safe-top
      "
      style={{
        // Push up above Telegram's MainButton + safe area when active
        paddingBottom: Math.max(tgBottomOffset, safeAreaBottom, 16) + 'px',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Детали события: ${event.title}`}
    >
       {/* Backdrop — full screen on mobile, centered on desktop */}
       <div
         className="absolute inset-0 bg-black/60"
         onClick={onClose}
         aria-hidden="true"
       />

       {/* Panel — slide-up from bottom on mobile, centered on desktop */}
       <div
         className="
           relative w-full max-w-md
           rounded-t-card sm:rounded-card
           bg-primary-dark
           border border-border-default
           animate-slide-up
         "
         style={{
           maxHeight: `calc(var(--tg-viewport-stable-height, 100dvh) - ${tgBottomOffset + 16}px)`,
           overflowY: 'auto',
           backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark))',
         }}
       >
         {/* Header */}
         <div
           className="
             flex items-center justify-between
             px-4 py-3
             border-b
           "
           style={{ borderColor: 'var(--color-border-default)' }}
         >
           <h2
             className="
               truncate text-heading-sm font-semibold
             "
             style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
           >
             {event.title}
           </h2>
           <button
             onClick={onClose}
             className="
               rounded-sm p-1
               transition-colors duration-fast
               hover:bg-surface/50
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
               active:scale-95
             "
             aria-label="Закрыть"
           >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="var(--color-text-muted)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

         {/* Content — scrollable event details */}
         <div className="px-4 py-3 space-y-3">
           {/* Provider badge */}
           <div className="flex items-center gap-2 shrink-0">
            <ProviderBadge provider={event.provider} />
             <span
               className="text-body-sm"
               style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
             >
               {event.provider === 'yandex' ? 'Yandex Календарь' : 'Outlook'}
             </span>
          </div>

           {/* Time */}
           <div
             className="
               flex flex-col gap-1
               rounded-md px-3 py-2
               bg-surface
             "
             style={{ 
               borderColor: 'var(--color-border-white-subtle)',
               backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
             }}
           >
            <div className="flex items-center justify-between">
               <span
                 className="text-body-sm"
                 style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
               >
                 Начало
               </span>
               <span
                 className="text-body-sm font-medium"
                 style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
               >
                {new Date(event.start_at).toLocaleString('ru-RU')}
              </span>
            </div>
            <div className="flex items-center justify-between">
               <span
                 className="text-body-sm"
                 style={{ color: 'var(--tg-theme-hint-color, var(--color-text-muted))' }}
               >
                 Окончание
               </span>
               <span
                 className="text-body-sm font-medium"
                 style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
               >
                {new Date(event.end_at).toLocaleString('ru-RU')}
              </span>
            </div>
          </div>

           {/* Description */}
           {event.description && (
             <div
               className="
                 rounded-md px-3 py-2
                 bg-surface
               "
               style={{ backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))' }}
             >
               <span
                 className="text-body-sm"
                 style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
               >
                {event.description}
              </span>
            </div>
          )}

           {/* Reminder settings */}
           <div
             className="
               flex items-center justify-between
               rounded-md px-3 py-2
               bg-surface
             "
             style={{ backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))' }}
           >
             <span
               className="text-body-sm"
               style={{ color: 'var(--tg-theme-text-color, var(--color-text-primary))' }}
             >
               Напоминание
             </span>
            
            {!showReminder ? (
               <button
                 onClick={() => setShowReminder(true)}
                 className="
                   rounded-sm px-2 py-1
                   transition-colors duration-fast
                   hover:bg-surface/50
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                   active:scale-95
                 "
                 style={{
                   fontSize: 'var(--text-body-sm)',
                   color: 'var(--tg-theme-button-color, var(--color-accent-amber))',
                 }}
               >
                {event.reminder_minutes_before === null
                  ? 'Без напоминания'
                  : `За ${event.reminder_minutes_before} мин`}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={reminderValue ?? ''}
                  onChange={(e) => setReminderValue(e.target.value === '' ? null : Number(e.target.value))}
                   className="
                     rounded-sm px-2 py-1
                     bg-surface-hover
                     border
                     text-body-sm
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                     active:scale-95
                   "
                   style={{ 
                     color: 'var(--tg-theme-text-color, var(--color-text-primary))',
                     borderColor: 'var(--color-border-default)',
                     backgroundColor: 'var(--color-bg-surface-hover)',
                   }}
                  aria-label="Выбрать время напоминания"
                >
                   {/* Options inherit text color from parent */}
                   <option value="">Без напоминания</option>
                   <option value={5}>За 5 мин</option>
                   <option value={10}>За 10 мин</option>
                   <option value={15}>За 15 мин</option>
                   <option value={30}>За 30 мин</option>
                   <option value={60}>За 1 час</option>
                </select>
                <button
                  onClick={handleSaveReminder}
                   className="
                     rounded-sm px-2 py-1
                     transition-colors duration-fast
                     hover:bg-surface/50
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                     active:scale-95
                   "
                   style={{
                     fontSize: 'var(--text-body-sm)',
                     color: 'var(--color-signal-green)',
                   }}
                >
                  OK
                </button>
                <button
                  onClick={() => setShowReminder(false)}
                   className="
                     rounded-sm px-2 py-1
                     transition-colors duration-fast
                     hover:bg-surface/50
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                     active:scale-95
                   "
                   style={{
                     fontSize: 'var(--text-body-sm)',
                     color: 'var(--tg-theme-hint-color, var(--color-text-muted))',
                   }}
                >
                  Отмена
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════

export function CalendarView({
  events,
  selectedDate,
  onDateSelect,
  onEventClick,
  isLoading,
}: CalendarViewProps) {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  
  // Use JSON string as dependency to avoid reference change issues
  const eventsKey = JSON.stringify(events.map(e => e.id));
  const eventsByDate = useMemo(() => groupEventsByDate(events), [eventsKey]);

  /**
   * Custom week header — Russian day names.
   */
  const weekHeader = useMemo(
    () => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const,
    []
  );

  /**
   * Handle day click — select date or show events.
   */
  const handleDayClick: DayPickerProps['onDayClick'] = (day, modifiers, e) => {
    if (e?.detail === 2) {
      // Double-click — create new event (Phase 2)
      return;
    }
    
    const dayEvents = eventsByDate.get(day.toISOString().split('T')[0]) ?? [];
    
    if (dayEvents.length === 1) {
      // Single event — show detail
      setSelectedEvent(dayEvents[0]);
    } else if (dayEvents.length > 1) {
      // Multiple events — show first, user can navigate
      setSelectedEvent(dayEvents[0]);
    } else if (dayEvents.length === 0) {
      // No events — just select date
      onDateSelect?.(day);
    }
  };

  /**
   * Custom render for each day cell.
   */
  const renderDay = (date: Date): React.ReactNode => {
    const dateKey = date.toISOString().split('T')[0];
    const dayEvents = eventsByDate.get(dateKey) ?? [];

    return (
      <CustomDayCell
        key={dateKey}
        date={date}
        events={dayEvents}
        onEventClick={(event) => setSelectedEvent(event)}
      />
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Calendar header */}
      <div
        className="
          flex items-center justify-between
          px-4 py-3
          border-b border-border-default
        "
      >
        <h1
          className="
            text-heading-md font-semibold
          "
          style={{ color: 'var(--color-text-primary)' }}
        >
          📅 Календарь
        </h1>
        
        {/* Sync button (Phase 2) */}
        <button
          className="
            rounded-sm px-2 py-1
            transition-colors duration-fast
            hover:bg-surface-hover
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          "
          style={{
            fontSize: 'var(--text-body-sm)',
            color: 'var(--color-accent-amber)',
          }}
          disabled
          title="Синхронизация (скоро)"
        >
          ↻ Синхронизировать
        </button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div
          className="
            flex items-center justify-center
            flex-1
          "
          style={{ minHeight: '300px' }}
        >
          <span
            className="text-body-md"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Загрузка событий...
          </span>
        </div>
      ) : (
        /* DayPicker with custom styling */
        <div
          className="
            flex-1 px-2 pb-2
            overflow-auto
          "
        >
          <DayPicker
            mode="single"
            selected={selectedDate}
            onDayClick={handleDayClick}
            showOutsideDays
            classNames={{
              months: 'flex flex-col',
              month: 'space-y-4',
              month_grid: 'w-full border-collapse',
              weekdays: 'flex',
              weekday: 'text-muted-foreground text-sm font-medium',
              day: 'h-9 w-9 p-0 font-normal aria-selected:opacity-100',
              selected:
                'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
              today: 'bg-accent text-accent-foreground',
              outside: 'text-muted-foreground opacity-50',
              disabled: 'text-muted-foreground opacity-50',
              hidden: 'invisible',
            }}
            startMonth={new Date(2024, 0)}
            endMonth={new Date(2030, 11)}
          />
        </div>
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEditReminder={async (eventId, minutes) => {
            // TODO: Call API to update reminder
            console.log('Update reminder:', eventId, minutes);
            setSelectedEvent(null);
          }}
        />
      )}
    </div>
  );
}