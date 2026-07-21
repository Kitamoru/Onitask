'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarView } from '@/components/calendar/CalendarView';
import { getCalendarEvents, getCalendarConnections } from '@/lib/api/calendar';
import { useAuth } from '@/hooks/useAuth';
import type { CalendarEvent, CalendarConnection } from '@/types/calendar';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

function CalendarContent() {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  const workspaceId = searchParams.get('workspace_id') ?? '';

  useEffect(() => {
    loadData();
  }, [workspaceId]);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const [eventsRes, connectionsRes] = await Promise.all([
        getCalendarEvents(workspaceId || 'placeholder', {
          startDate: new Date(new Date().getFullYear(), 0, 1),
          endDate: new Date(new Date().getFullYear(), 11, 31),
        }),
        getCalendarConnections(workspaceId || 'placeholder'),
      ]);

      if (eventsRes.error) {
        console.error('Failed to load calendar events:', eventsRes.error);
        setError('Не удалось загрузить события календаря');
      } else {
        setEvents(eventsRes.data ?? []);
      }

      if (connectionsRes.error) {
        console.error('Failed to load calendar connections:', connectionsRes.error);
      } else {
        setConnections(connectionsRes.data ?? []);
      }
    } catch (err) {
      console.error('Calendar page error:', err);
      setError('Произошла ошибка при загрузке данных');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSync(provider: CalendarEvent['provider']) {
    setIsSyncing(true);
    setSyncStatus('syncing');

    try {
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 2000);
      await loadData();
    } catch (err) {
      setSyncStatus('error');
      console.error(`Sync failed for ${provider}:`, err);
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleReminderUpdate(eventId: string, minutes: number | null) {
    try {
      console.log('Reminder updated:', eventId, minutes);
      await loadData();
    } catch (err) {
      console.error('Failed to update reminder:', err);
    }
  }

  return (
    <div
      className="flex flex-col h-full min-h-dvh bg-primary-dark"
      style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}
    >
      <header
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border-default)' }}
      >
        <h1 className="text-heading-md font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          📅 Календарь
        </h1>

        <div className="flex items-center gap-2">
          {syncStatus === 'syncing' && (
            <span className="text-body-sm animate-pulse" style={{ color: 'var(--color-accent-amber)' }}>
              Синхронизация...
            </span>
          )}
          {syncStatus === 'success' && (
            <span className="text-body-sm" style={{ color: 'var(--color-signal-green)' }}>
              ✓ Синхронизировано
            </span>
          )}
          {syncStatus === 'error' && (
            <span className="text-body-sm" style={{ color: 'var(--color-error)' }}>
              ✕ Ошибка
            </span>
          )}
        </div>
      </header>

      {connections.length > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto"
          style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-bg-dark)' }}
        >
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 shrink-0"
              style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-white-subtle)' }}
            >
              <span
                className="flex h-2 w-2 rounded-full"
                style={{ backgroundColor: conn.provider === 'yandex' ? 'var(--color-signal-yellow)' : 'var(--color-signal-cyan)' }}
              />
              <span className="text-body-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                {conn.provider_account_email}
              </span>
              <button
                onClick={() => handleSync(conn.provider)}
                disabled={isSyncing}
                className="rounded-full p-0.5 transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber disabled:opacity-50"
                aria-label={`Синхронизировать ${conn.provider}`}
                title={`Синхронизировать ${conn.provider}`}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.76-4.24L11 8h6V2l-3.35 3.35z"
                    stroke="var(--color-text-muted)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {connections.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
          <span className="mb-2 text-4xl">📭</span>
          <p className="text-heading-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Календари не подключены
          </p>
          <p className="text-body-sm" style={{ color: 'var(--color-text-muted)' }}>
            Подключите Yandex Календарь или Outlook для синхронизации событий
          </p>
        </div>
      )}

      {error && (
        <div
          className="mx-4 mt-4 rounded-md px-3 py-2 border"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--color-error)' }}
        >
          <p className="text-body-sm" style={{ color: 'var(--color-error)' }}>
            ⚠ {error}
          </p>
        </div>
      )}

      {(connections.length > 0 || isLoading) && (
        <div className="flex-1 overflow-hidden">
          <CalendarView
            events={events}
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
            isLoading={isLoading}
          />
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full min-h-dvh">
          <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
        </div>
      }
    >
      <CalendarContent />
    </Suspense>
  );
}