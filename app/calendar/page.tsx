/**
 * Calendar Page — /calendar
 * 
 * Displays calendar events with 4 view modes for Telegram TWA:
 * - day: Single day detail view with hourly breakdown (default)
 * - three-days: Horizontal 2-day compact grid
 * - list: Infinite vertical scroll of all upcoming events
 * - month-list: Month grid + agenda list below
 * 
 * Demo Mode: When NEXT_PUBLIC_SUPABASE_URL is not set, uses mock data
 * for UX/UI testing without a live Supabase connection.
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CalendarTabs,
  MonthListView,
  DayView,
  ListView,
} from '../../src/components/calendar';
import type { CalendarEvent, CalendarConnection, CalendarViewMode, CalendarProvider } from '../../src/types/calendar';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

const ALL_PROVIDERS: { key: CalendarProvider; label: string; icon: string; color: string }[] = [
  { key: 'yandex', label: 'Yandex Календарь', icon: 'Я', color: 'var(--color-signal-yellow)' },
  { key: 'outlook', label: 'Outlook Календарь', icon: 'O', color: 'var(--color-signal-cyan)' },
];

// ═══════════════════════════════════════════════════════
// Mock Data for Demo / UX Testing
// ═══════════════════════════════════════════════════════

const DEMO_CONNECTIONS: CalendarConnection[] = [
  {
    id: 'conn-demo-1',
    workspace_id: 'demo-workspace',
    worker_id: 'worker-demo-1',
    provider: 'yandex',
    provider_account_email: 'user@yandex.ru',
    token_expires_at: '2026-08-01T10:00:00Z',
    is_active: true,
    connected_at: '2026-07-01T10:00:00Z',
    last_sync_at: '2026-07-18T08:00:00Z',
  },
  {
    id: 'conn-demo-2',
    workspace_id: 'demo-workspace',
    worker_id: 'worker-demo-2',
    provider: 'outlook',
    provider_account_email: 'user@outlook.com',
    token_expires_at: '2026-08-05T14:30:00Z',
    is_active: true,
    connected_at: '2026-07-05T14:30:00Z',
    last_sync_at: '2026-07-17T16:00:00Z',
  },
];

function generateMockEvents(): CalendarEvent[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();

  return [
    {
      id: 'evt-demo-1',
      workspace_id: 'demo-workspace',
      remote_event_id: 'yandex-001',
      provider: 'yandex',
      title: 'Планёрка команды',
      description: 'Еженедельная планёрка по статусу спринта',
      start_at: new Date(year, month, today, 10, 0).toISOString(),
      end_at: new Date(year, month, today, 11, 0).toISOString(),
      reminder_minutes_before: 15,
      created_by: 'worker-demo-1',
      updated_by: 'worker-demo-1',
      source_synced_at: '2026-07-18T08:00:00Z',
      created_at: '2026-07-01T09:00:00Z',
      updated_at: '2026-07-18T08:00:00Z',
    },
    {
      id: 'evt-demo-2',
      workspace_id: 'demo-workspace',
      remote_event_id: 'yandex-002',
      provider: 'yandex',
      title: 'Code Review: PR #42',
      description: 'Ревью merge request для модуля календаря',
      start_at: new Date(year, month, today, 14, 0).toISOString(),
      end_at: new Date(year, month, today, 15, 30).toISOString(),
      reminder_minutes_before: 30,
      created_by: 'worker-demo-2',
      updated_by: 'worker-demo-2',
      source_synced_at: '2026-07-15T09:00:00Z',
      created_at: '2026-07-10T11:00:00Z',
      updated_at: '2026-07-15T09:00:00Z',
    },
    {
      id: 'evt-demo-3',
      workspace_id: 'demo-workspace',
      remote_event_id: 'outlook-001',
      provider: 'outlook',
      title: 'Демо с заказчиком',
      description: 'Показываем прогресс Q3',
      start_at: new Date(year, month, today + 1, 11, 0).toISOString(),
      end_at: new Date(year, month, today + 1, 12, 0).toISOString(),
      reminder_minutes_before: 60,
      created_by: 'worker-demo-3',
      updated_by: 'worker-demo-3',
      source_synced_at: '2026-07-16T14:00:00Z',
      created_at: '2026-07-12T10:00:00Z',
      updated_at: '2026-07-16T14:00:00Z',
    },
    {
      id: 'evt-demo-4',
      workspace_id: 'demo-workspace',
      remote_event_id: 'yandex-003',
      provider: 'yandex',
      title: 'Ретроспектива спринта',
      description: 'Обсуждение итогов спринта и улучшения',
      start_at: new Date(year, month, today + 2, 16, 0).toISOString(),
      end_at: new Date(year, month, today + 2, 17, 0).toISOString(),
      reminder_minutes_before: 15,
      created_by: 'worker-demo-1',
      updated_by: 'worker-demo-1',
      source_synced_at: '2026-07-17T10:00:00Z',
      created_at: '2026-07-14T08:00:00Z',
      updated_at: '2026-07-17T10:00:00Z',
    },
    {
      id: 'evt-demo-5',
      workspace_id: 'demo-workspace',
      remote_event_id: 'outlook-002',
      provider: 'outlook',
      title: 'Онбординг нового участника',
      description: 'Знакомство с проектом и процессами',
      start_at: new Date(year, month, today + 3, 10, 0).toISOString(),
      end_at: new Date(year, month, today + 3, 11, 30).toISOString(),
      reminder_minutes_before: 30,
      created_by: 'worker-demo-4',
      updated_by: 'worker-demo-4',
      source_synced_at: '2026-07-17T16:00:00Z',
      created_at: '2026-07-15T12:00:00Z',
      updated_at: '2026-07-17T16:00:00Z',
    },
    {
      id: 'evt-demo-6',
      workspace_id: 'demo-workspace',
      remote_event_id: 'yandex-004',
      provider: 'yandex',
      title: 'Техническое собеседование',
      description: 'Frontend developer (React/Next.js)',
      start_at: new Date(year, month, today - 1, 15, 0).toISOString(),
      end_at: new Date(year, month, today - 1, 16, 0).toISOString(),
      reminder_minutes_before: null,
      created_by: 'worker-demo-4',
      updated_by: 'worker-demo-4',
      source_synced_at: '2026-07-10T11:00:00Z',
      created_at: '2026-07-08T09:00:00Z',
      updated_at: '2026-07-10T11:00:00Z',
    },
  ];
}

// Check if we're in demo mode (no Supabase URL configured)
const IS_DEMO_MODE = !process.env.NEXT_PUBLIC_SUPABASE_URL;

// ═══════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════

export default function CalendarPage() {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month-list');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showProviderPicker, setShowProviderPicker] = useState(false);

  // Workspace ID (from URL params or auth)
  const workspaceId = searchParams.get('workspace_id') ?? '';

  /**
   * Load events and connections on mount.
   * Uses mock data in demo mode (no Supabase configured).
   */
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(() => {
    setIsLoading(true);
    setError(null);

    if (IS_DEMO_MODE) {
      console.log('[Calendar] Demo mode — using mock data');
      setEvents(generateMockEvents());
      setConnections(DEMO_CONNECTIONS);
      setIsLoading(false);
      return;
    }

    // Production mode: fetch from Supabase
    import('../../src/lib/api/calendar').then(
      async ({ getCalendarEvents, getCalendarConnections }) => {
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
    );
  }, [workspaceId]);

  /**
   * Trigger sync for a specific provider.
   */
  async function handleSync(provider: CalendarEvent['provider']) {
    setIsSyncing(true);
    setSyncStatus('syncing');

    try {
      if (!IS_DEMO_MODE && workspaceId) {
        const { syncCalendar } = await import('../../src/lib/api/calendar');
        await syncCalendar({
          workspace_id: workspaceId,
          provider,
          action: 'sync',
        });
      }
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

  /**
   * Disconnect a calendar account.
   */
  async function handleDisconnect(conn: CalendarConnection) {
    if (!confirm(`Отключить ${conn.provider_account_email}?`)) {
      return;
    }

    try {
      if (!IS_DEMO_MODE && workspaceId) {
        const { disconnectCalendar } = await import('../../src/lib/api/calendar');
        const result = await disconnectCalendar(workspaceId, conn.provider, conn.worker_id);
        if (result.error) {
          setError(result.error);
          return;
        }
      }
      // Remove from state
      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
    } catch (err) {
      console.error(`Disconnect ${conn.provider} failed:`, err);
      setError(`Не удалось отключить ${conn.provider}`);
    }
  }

  /**
   * Handle event click from any view.
   */
  function handleEventClick(event: CalendarEvent) {
    console.log('Event clicked:', event.id, event.title);
  }

  /**
   * Handle date selection — switches to 'day' tab when coming from month view.
   */
  function handleDateSelect(date: Date) {
    setSelectedDate(date);
    setViewMode('day');
  }

  /**
   * Go back to month view from day view.
   */
  function handleBackToMonth() {
    setViewMode('month-list');
  }

  /**
   * Initiate provider connection (opens OAuth flow via Edge Function).
   */
  async function handleConnectProvider(provider: CalendarProvider) {
    setIsConnecting(true);
    try {
      if (IS_DEMO_MODE) {
        console.log(`[Calendar] Demo: connect ${provider}`);
        // In demo mode, just simulate connection
        setShowProviderPicker(false);
        return;
      }

      // Call Edge Function to get OAuth URL
      const response = await fetch(`/api/calendar/connect/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });

      if (!response.ok) {
        throw new Error('Failed to get OAuth URL');
      }

      const { url } = await response.json();
      // Open OAuth in new window/tab (TWA handles redirect)
      window.open(url, '_blank');
      setShowProviderPicker(false);
    } catch (err) {
      console.error(`Connect ${provider} failed:`, err);
      setError(`Не удалось начать подключение ${provider}`);
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div
      className="flex flex-col"
      style={{
        minHeight: '100vh',
        overflowX: 'hidden' as const,
        overflowY: 'auto' as const,
        padding: '16px',
        gap: '8px',
        maxWidth: '390px',
        margin: '0 auto',
        backgroundColor: 'var(--tg-theme-bg-color, var(--color-bg-dark))',
        boxSizing: 'border-box' as const,
      }}
    >
      {/* Header section */}
      <div
        className="flex flex-col"
        style={{
          alignSelf: 'stretch',
          justifyContent: 'center',
          gap: '4px',
          paddingBottom: '4px',
        }}
      >
        {/* Title row with calendar icon */}
        <div
          className="flex items-center gap-2"
          style={{ maxWidth: '390px', margin: '0 auto' }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="16" height="15" rx="2" stroke="var(--color-accent-amber, #F59E0B)" strokeWidth="1.5" />
            <line x1="6" y1="1" x2="6" y2="4" stroke="var(--color-accent-amber, #F59E0B)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="14" y1="1" x2="14" y2="4" stroke="var(--color-accent-amber, #F59E0B)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="2" y1="8" x2="18" y2="8" stroke="var(--color-accent-amber, #F59E0B)" strokeWidth="1.5" />
            <rect x="6" y="11" width="2" height="2" rx="0.5" fill="var(--color-accent-amber, #F59E0B)" />
            <rect x="12" y="11" width="2" height="2" rx="0.5" fill="var(--color-accent-amber, #F59E0B)" />
            <rect x="6" y="14.5" width="2" height="2" rx="0.5" fill="var(--color-accent-amber, #F59E0B)" opacity="0.5" />
          </svg>
          <h1
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '20px',
              lineHeight: '24px',
              fontWeight: '500',
              letterSpacing: '-0.025em',
              textAlign: 'left' as const,
              color: 'var(--tg-theme-text-color, var(--color-text-primary))',
            }}
          >
            Календарь
          </h1>
        </div>
      </div>

      {/* Connected accounts + Connect button */}
      {(connections.length > 0 || showProviderPicker) && (
        <div
          className="flex items-center"
          style={{
            gap: '6px',
            padding: '0 2px',
            flexWrap: 'wrap',
          }}
        >
          {/* Connected account badges */}
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-1.5 rounded-full shrink-0"
              style={{
                height: '24px',
                padding: '0 8px',
                backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
                border: '1px solid var(--tg-theme-border-color, var(--color-border-white-subtle))',
              }}
            >
              <span
                className="flex h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: conn.provider === 'yandex'
                    ? 'var(--color-signal-yellow)'
                    : 'var(--color-signal-cyan)',
                }}
              />
              <span
                className="text-body-xs whitespace-nowrap"
                style={{
                  fontSize: '11px',
                  color: 'var(--tg-theme-hint-color, var(--color-text-muted))',
                }}
              >
                {conn.provider_account_email}
              </span>
              <button
                onClick={() => handleSync(conn.provider)}
                disabled={isSyncing}
                className="rounded-full p-0.5 transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber disabled:opacity-50"
                aria-label={`Синхронизировать ${conn.provider}`}
                title={`Синхронизировать ${conn.provider}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.76-4.24L11 8h6V2l-3.35 3.35z"
                    stroke="var(--tg-theme-hint-color, var(--color-text-muted))"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                onClick={() => handleDisconnect(conn)}
                className="rounded-full p-0.5 transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                aria-label={`Отключить ${conn.provider}`}
                title={`Отключить ${conn.provider}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 4L12 12M12 4L4 12"
                    stroke="var(--color-error, #EF4444)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}

          {/* Provider picker or Connect + badge */}
          {showProviderPicker ? (
            <>
              {ALL_PROVIDERS.map((p) => {
                const alreadyConnected = connections.some((c) => c.provider === p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => !alreadyConnected && handleConnectProvider(p.key)}
                    disabled={alreadyConnected || isConnecting}
                    className="flex items-center gap-1 rounded-full shrink-0 transition-all duration-fast active:scale-95"
                    style={{
                      height: '24px',
                      padding: '0 8px',
                      backgroundColor: alreadyConnected
                        ? 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))'
                        : 'var(--tg-theme-button-color, var(--color-accent-amber))',
                      border: '1px solid var(--tg-theme-border-color, var(--color-border-white-subtle))',
                      opacity: alreadyConnected ? 0.4 : 1,
                      cursor: alreadyConnected ? 'default' : 'pointer',
                    }}
                    aria-label={`Подключить ${p.label}`}
                    title={alreadyConnected ? `Уже подключено: ${p.label}` : `Подключить ${p.label}`}
                  >
                    <span
                      className="flex h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span
                      className="text-body-xs font-medium whitespace-nowrap"
                      style={{
                        fontSize: '11px',
                        color: alreadyConnected
                          ? 'var(--tg-theme-hint-color, var(--color-text-muted))'
                          : 'var(--tg-theme-button-text-color, var(--color-text-white))',
                      }}
                    >
                      {alreadyConnected ? '✓' : '+'}
                    </span>
                  </button>
                );
              })}
              <button
                onClick={() => setShowProviderPicker(false)}
                className="flex items-center justify-center rounded-full shrink-0 transition-colors duration-fast hover:bg-surface-hover"
                style={{
                  height: '24px',
                  width: '24px',
                  padding: 0,
                }}
                aria-label="Закрыть"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="var(--tg-theme-hint-color, var(--color-text-muted))" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowProviderPicker(true)}
              className="flex items-center gap-1 rounded-full shrink-0 transition-all duration-fast active:scale-95 hover:bg-surface-hover"
              style={{
                height: '24px',
                padding: '0 8px',
                backgroundColor: 'var(--tg-theme-secondary-bg-color, var(--color-bg-surface))',
                border: '1px dashed var(--tg-theme-border-color, var(--color-border-white-subtle))',
              }}
              aria-label="Подключить календарь"
              title="Подключить календарь"
            >
              <span
                className="text-body-xs font-semibold"
                style={{
                  fontSize: '11px',
                  color: 'var(--tg-theme-link-color, var(--color-accent-amber))',
                }}
              >
                + Подключить
              </span>
            </button>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="rounded-md px-3 py-2"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderColor: 'var(--color-error)',
            borderWidth: '1px',
            marginBottom: '8px',
          }}
        >
          <p
            className="text-body-xs"
            style={{ color: 'var(--color-error)' }}
          >
            ⚠ {error}
          </p>
        </div>
      )}

      {/* View mode tabs */}
      <CalendarTabs
        activeMode={viewMode}
        onModeChange={setViewMode}
      />

      {/* Active view */}
      <div
        className="flex-1 overflow-x-hidden"
        style={{
          minHeight: '400px',
          marginTop: '0px',
          boxSizing: 'border-box',
          alignSelf: 'stretch',
        }}
      >
        {viewMode === 'month-list' && (
          <MonthListView
            events={events}
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
            isLoading={isLoading}
          />
        )}

        {viewMode === 'day' && (
          <DayView
            selectedDate={selectedDate}
            events={events}
            onBack={handleBackToMonth}
            onEventClick={handleEventClick}
            isLoading={isLoading}
          />
        )}

        {viewMode === 'list' && (
          <ListView
            events={events}
            onEventClick={handleEventClick}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  );
}