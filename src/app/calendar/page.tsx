'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { CalendarTabs } from '@/components/calendar/CalendarTabs';
import { DayView } from '@/components/calendar/DayView';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekStrip } from '@/components/calendar/WeekStrip';
import { EventDetailSheet } from '@/components/calendar/EventDetailSheet';
import { getCalendarEvents, getCalendarConnections, syncCalendar } from '@/lib/api/calendar';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';
import { groupEventsByDate } from '@/lib/calendar';
import type {
  CalendarEvent,
  CalendarConnection,
  CalendarProvider,
  CalendarViewMode,
} from '@/types/calendar';
import { OrbitLoader } from '@/components/shared/OrbitLoader';
import { IconCalendarWeek } from '@tabler/icons-react';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

/**
 * How stale calendar data may get before an automatic sync runs on open.
 *
 * A sync is a write against Yandex, not a cheap read: one run walks the
 * CalDAV home-set and GETs every event .ics (measured ~2.7 s and 18 requests
 * for an 18-event calendar). So unlike board counts there is no
 * `refetchInterval` here — that would hammer CalDAV all day. Instead we sync
 * once when the calendar is opened, and only if the data is older than this.
 */
const AUTO_SYNC_STALE_MS = 15 * 60_000;

function CalendarContent() {
  const { isLoading: authLoading, data: authData, initData } = useTelegramAuth();
  const { state, loadBoardsData } = useData();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  // Distinguishes "loaded and there is none" from "not loaded yet / failed" —
  // without it a failed load renders the "not connected" empty state.
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  // Day/Month are two ends of one scale, so the day is the default landing.
  const [viewMode, setViewMode] = useState<CalendarViewMode>('day');
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // OAuth code modal state
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [oauthToken, setOauthToken] = useState('');
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [oauthInstructions, setOauthInstructions] = useState('');

  // CalDAV app password modal state (CAL-08). Yandex CalDAV rejects the OAuth
  // token, so a password is required before any event can be synced.
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [caldavPassword, setCaldavPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Use active workspace from DataContext (like flowboard does)
  const workspaceId = state.activeWorkspaceId;

  // Ref to prevent duplicate loadData calls when deps change rapidly
  const loadingRef = useRef(false);
  const loadedProfileRef = useRef<string | null>(null);
  // Auto-sync fires at most once per open; the manual button is unaffected.
  const autoSyncRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !workspaceId) {
      loadBoardsData(undefined).catch(() => {});
    }
  }, [authLoading, workspaceId, loadBoardsData]);

  useEffect(() => {
    // Skip if already loading or already loaded for this profile
    if (loadingRef.current || !workspaceId || authLoading) return;
    // `initData` is separate state in useTelegramAuth and is filled only after
    // the Telegram SDK loads, so profile_id can be ready before it. Loading
    // without it gets a 401, and the "already loaded" latch below would then
    // block every retry for the rest of the session — the calendar stayed
    // "not connected" on every open.
    if (!initData) return;
    if (!authData?.profile_id) {
      if (!authLoading && !workspaceId) {
        setIsLoading(false);
      }
      return;
    }

    // Only load once per profile_id
    if (loadedProfileRef.current === authData.profile_id) return;

    loadingRef.current = true;
    loadData()
      .then((loaded) => {
        // Latch only on success, otherwise a transient failure is permanent.
        if (loaded) loadedProfileRef.current = authData.profile_id;
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [workspaceId, authLoading, initData, authData?.profile_id]);

  // Auto-sync on open. Syncs once, and only when the stored data has gone
  // stale — AUTO_SYNC_STALE_MS is the throttle, since each run is a write
  // against Yandex. Runs silently: the data already on screen stays visible
  // and a failure does not raise an error banner, because nothing the user
  // was looking at became wrong. The manual button is there for a retry.
  useEffect(() => {
    if (autoSyncRef.current) return;
    if (!connectionsLoaded || isLoading) return;

    const connection = connections.find((c) => c.is_active);
    // No app password means Yandex would reject the sync outright.
    if (!connection?.has_caldav_password) return;

    const lastSyncAt = connection.last_sync_at
      ? Date.parse(connection.last_sync_at)
      : NaN;
    const age = Date.now() - lastSyncAt;
    // Never synced (null) counts as stale.
    if (Number.isFinite(age) && age <= AUTO_SYNC_STALE_MS) return;

    autoSyncRef.current = true;
    handleSync(connection.provider, { silent: true });
  }, [connections, connectionsLoaded, isLoading]);

  /**
   * Loads connections + events.
   *
   * `silent` leaves the screen as it is — no full-page loader, no error reset.
   * Used by the background auto-sync, where the events on screen are still
   * valid, just slightly old, and replacing them with a spinner would be a
   * worse experience than the staleness.
   */
  async function loadData(silent = false): Promise<boolean> {
    if (!workspaceId) return false;

    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const [eventsRes, connectionsRes] = await Promise.all([
        getCalendarEvents(authData?.profile_id ?? '', {
          initData,
          startDate: new Date(new Date().getFullYear(), 0, 1),
          endDate: new Date(new Date().getFullYear(), 11, 31),
        }),
        getCalendarConnections(authData?.profile_id ?? '', initData),
      ]);

      if (connectionsRes.error) {
        console.error('Failed to load calendar connections:', connectionsRes.error);
        // Surface the failure instead of falling through to the empty state,
        // which would claim the calendar is not connected.
        setError('Не удалось загрузить подключения календаря');
        return false;
      }
      setConnections(connectionsRes.data ?? []);
      setConnectionsLoaded(true);

      if (eventsRes.error && (connectionsRes.data?.length ?? 0) > 0) {
        console.error('Failed to load calendar events:', eventsRes.error);
        setError('Не удалось загрузить события календаря');
      } else {
        setEvents(eventsRes.data ?? []);
      }
      return true;
    } catch (err) {
      console.error('Calendar page error:', err);
      setError('Произошла ошибка при загрузке данных');
      return false;
    } finally {
      if (!silent) setIsLoading(false);
    }
  }

  async function handleConnect(provider: CalendarProvider) {
    try {
      if (!initData) {
        throw new Error('Нет данных авторизации Telegram');
      }

      const response = await fetch(`/api/calendar/connect/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: initData }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to get OAuth URL');
      }

      const data = await response.json();
      if (data.success && data.url) {
        // Open OAuth authorization in new window
        window.open(data.url, '_blank', 'noopener,noreferrer');
        // Show code input modal with instructions
        setOauthInstructions(data.instructions || 'Разрешите доступ на странице Яндекса, скопируйте код авторизации и вставьте его ниже.');
        setShowTokenModal(true);
        setOauthToken('');
      }
    } catch (err) {
      console.error(`Connect failed for ${provider}:`, err);
      setError(`Ошибка подключения: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async function handleStoreToken() {
    if (!oauthToken?.trim()) {
      setError('Код авторизации не введен');
      return;
    }

    if (!initData) {
      setError('Нет данных авторизации Telegram');
      return;
    }

    setTokenSubmitting(true);
    try {
      // Yandex redirect_uri is fixed to oauth.yandex.ru/verification_code, so
      // the user pastes the authorization code here instead of us receiving it.
      // profile_id is resolved server-side from init_data.
      const response = await fetch('/api/calendar/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'yandex',
          code: oauthToken.trim(),
          init_data: initData,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Не удалось подключить календарь');
      }

      // Success — close modal and reload data
      setShowTokenModal(false);
      setOauthToken('');
      await loadData();
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 2000);
    } catch (err) {
      console.error('[Calendar] Authorization code exchange error:', err);
      const errMsg = err instanceof Error ? err.message : 'unknown';
      setError(`Ошибка подключения: ${errMsg}`);
    } finally {
      setTokenSubmitting(false);
    }
  }

  /**
   * Saves the CalDAV app password and immediately attempts a sync, so the user
   * sees whether the password actually works instead of a silent no-op.
   */
  async function handleSavePassword() {
    const password = caldavPassword.trim();
    if (!password) {
      setPasswordError('Введите пароль приложения');
      return;
    }
    if (!initData) {
      setPasswordError('Нет данных авторизации Telegram');
      return;
    }

    setPasswordSubmitting(true);
    setPasswordError(null);

    try {
      const { setCalDavPassword } = await import('@/lib/api/calendar');
      const result = await setCalDavPassword(password, initData);

      if (!result.success) {
        setPasswordError(
          result.error === 'missing_caldav_password'
            ? 'Введите пароль приложения'
            : 'Не удалось сохранить пароль'
        );
        return;
      }

      setShowPasswordModal(false);
      setCaldavPassword('');
      setShowPassword(false);
      await loadData();

      // Try a sync right away: a wrong password only shows up here.
      if (authData?.profile_id) {
        setIsSyncing(true);
        setSyncStatus('syncing');
        try {
          const syncResult = await syncCalendar(
            { profile_id: authData.profile_id, provider: 'yandex', action: 'sync' },
            initData
          );
          const synced = (syncResult as { synced?: number } | undefined)?.synced ?? 0;
          if (synced > 0) {
            setSyncStatus('success');
            setTimeout(() => setSyncStatus('idle'), 2000);
            await loadData();
          } else {
            setPasswordError(
              'Пароль сохранён, но Яндекс его не принял. Проверьте, что создан пароль типа «Календарь».'
            );
            setShowPasswordModal(true);
          }
        } catch {
          setPasswordError('Пароль сохранён, но синхронизация не удалась');
          setShowPasswordModal(true);
        } finally {
          setIsSyncing(false);
          setSyncStatus('idle');
        }
      }
    } catch {
      setPasswordError('Что-то пошло не так. Попробуйте ещё раз');
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function handleSync(
    provider: CalendarProvider,
    opts: { silent?: boolean } = {}
  ) {
    if (!workspaceId || !authData?.profile_id) return;
    const silent = opts.silent ?? false;
    
    console.log('[Calendar/handleSync] START', {
      provider,
      profile_id: authData.profile_id,
      workspace_id: workspaceId,
    });
    
    setIsSyncing(true);
    setSyncStatus('syncing');

    try {
      const result = await syncCalendar(
        { profile_id: authData.profile_id, provider, action: 'sync' },
        initData
      );
      
      console.log('[Calendar/handleSync] Success', result);
      // A background sync keeps the quiet «синхронизация…» chip in the header
      // instead of a celebratory flash nobody asked for.
      if (!silent) {
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 2000);
      }
      await loadData(silent);
    } catch (err) {
      console.error('[Calendar/handleSync] Error:', err);
      // A failed background refresh must not interrupt the user with an error
      // banner — nothing they were looking at became wrong.
      if (!silent) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(`Синхронизация не удалась: ${errMsg}`);
        setSyncStatus('error');
      }
    } finally {
      setIsSyncing(false);
      // The non-silent path already moved off 'syncing' above (success flash or
      // the error state). The silent one has to clear it here, or the header
      // chip would claim «синхронизация…» forever after a background run.
      if (silent) setSyncStatus('idle');
    }
  }

  async function handleReminderUpdate(eventId: string, minutes: number | null) {
    try {
      const { updateReminderSettings } = await import('@/lib/api/calendar');
      const result = await updateReminderSettings(eventId, minutes);
      if (!result.success) {
        console.error('Failed to update reminder:', result.error);
      }
      await loadData();
    } catch (err) {
      console.error('Failed to update reminder:', err);
    }
  }

  // Per-day presence counts, keyed by local day so the strip dots and the
  // month grid agree with what the day view will show.
  const eventCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, list] of groupEventsByDate(events)) {
      map.set(key, list.length);
    }
    return map;
  }, [events]);

  const bgStyle = { background: 'var(--color-bg-primary-dark, #0A0A0A)' };

  // Loading state while auth or workspace is loading
  if (authLoading || (!workspaceId && !state.tasks.items.length)) {
    return (
      <div className="flex items-center justify-center h-full min-h-dvh" style={bgStyle}>
        <OrbitLoader />
      </div>
    );
  }

  // No workspace selected
  if (!workspaceId) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-dvh px-4" style={bgStyle}>
        <span className="mb-3 text-5xl">🏢</span>
        <p className="text-heading-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
          Рабочая область не выбрана
        </p>
        <p className="text-body-sm" style={{ color: 'var(--color-text-muted)' }}>
          Перейдите на доску задач, чтобы подключить календарь
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-tg-screen overflow-hidden"
      style={{ 
        ...bgStyle,
        paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
        paddingBottom: 'calc(var(--size-bottom-menu-height) + 16px)',
      }}
    >
      <header
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border-default)' }}
      >
        <div className="flex items-center gap-2">
          <IconCalendarWeek size={20} stroke={1.5} className="flex-none" aria-hidden="true" />
          <h1
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: '20px',
              lineHeight: '24px',
              fontWeight: 500,
              letterSpacing: '-0.025em',
              color: 'var(--color-text-primary)',
            }}
          >
            Календарь
          </h1>
        </div>

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

      {/* Connections bar with sync buttons */}
      {connections.length > 0 && (
        <div
          className="flex flex-col gap-2 px-4 py-2 border-b"
          style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-bg-dark)' }}
        >
          <div className="flex items-center gap-2 overflow-x-auto">
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
                  disabled={isSyncing || conn.has_caldav_password === false}
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

          {/* CalDAV app password (CAL-08): without it the OAuth token cannot read
              the calendar, so this is a blocking state, not a nicety. */}
          {connections.some((c) => c.has_caldav_password === false) && (
            <div
              className="flex flex-col gap-2 rounded-md px-3 py-2.5 border"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'var(--color-accent-amber)' }}
            >
              <p className="text-body-xs" style={{ color: 'var(--color-text-primary)' }}>
                Чтобы события появились, нужен пароль приложения Яндекс
              </p>
              <button
                onClick={() => {
                  setPasswordError(null);
                  setShowPasswordModal(true);
                }}
                className="
                  self-start rounded-card px-3 py-1.5
                  text-body-xs font-medium
                  transition-all duration-fast
                  hover:opacity-90 active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                "
                style={{ backgroundColor: 'var(--color-accent-amber)', color: '#000' }}
              >
                Добавить пароль
              </button>
            </div>
          )}

          {/* Freshness — only shown once a sync has actually succeeded. */}
          {connections.some((c) => c.last_sync_at) && (
            <p className="text-body-xs" style={{ color: 'var(--color-text-muted)' }}>
              Синхронизировано{' '}
              {new Date(
                Math.max(...connections.map((c) => new Date(c.last_sync_at ?? 0).getTime()))
              ).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}

      {/* No connections state — show connect button. Only once a load actually
          succeeded, so a failed request is not reported as "not connected". */}
      {connectionsLoaded && connections.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
          <span className="mb-3 text-5xl">📭</span>
          <p className="text-heading-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Календари не подключены
          </p>
          <p className="text-body-sm mb-4 max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
            Подключите Яндекс Календарь для синхронизации событий
          </p>
          
          {/* Connect Yandex button */}
          <button
            onClick={() => handleConnect('yandex')}
            className="
              rounded-card px-4 py-2
              text-body-sm font-medium
              transition-all duration-fast
              hover:opacity-90 active:scale-95
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
            "
            style={{
              backgroundColor: 'var(--color-accent-amber)',
              color: '#000',
            }}
            aria-label="Подключить Яндекс Календарь"
          >
            🟡 Подключить Яндекс Календарь
          </button>
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
        <div className="flex-1 min-h-0 flex flex-col">
          <CalendarTabs activeMode={viewMode} onModeChange={setViewMode} />

          {viewMode === 'day' ? (
            <>
              <WeekStrip
                selectedDate={selectedDate}
                onDateSelect={setSelectedDate}
                eventCounts={eventCounts}
              />
              <div className="flex-1 min-h-0">
                <DayView
                  date={selectedDate}
                  events={events}
                  onEventClick={setSelectedEvent}
                  onDateSelect={setSelectedDate}
                  isLoading={isLoading}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0">
              <MonthView
                month={viewMonth}
                onMonthChange={setViewMonth}
                selectedDate={selectedDate}
                onDateSelect={(date) => {
                  setSelectedDate(date);
                  setViewMode('day');
                }}
                events={events}
              />
            </div>
          )}
        </div>
      )}

      <EventDetailSheet
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onEditReminder={handleReminderUpdate}
      />

      {/* Authorization code modal */}
      {showTokenModal && (
        <div
          className="
            fixed inset-x-0 z-modal flex items-end justify-center
            sm:items-center
            pb-safe-bottom pt-safe-top
          "
          style={{ paddingBottom: Math.max(0, 16) + 'px' }}
          role="dialog"
          aria-modal="true"
          aria-label="Ввод кода авторизации"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={!tokenSubmitting ? () => setShowTokenModal(false) : undefined}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            className="
              relative w-full max-w-md
              rounded-t-card sm:rounded-card
              bg-primary-dark
              border border-border-default
              animate-slide-up
            "
            style={{
              maxHeight: 'calc(var(--tg-viewport-stable-height, 100dvh) - 16px)',
              overflowY: 'auto',
              background: 'var(--color-bg-primary-dark, #0A0A0A)',
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
                style={{ color: 'var(--color-text-primary)' }}
              >
                🔐 Код авторизации
              </h2>
              <button
                onClick={() => !tokenSubmitting && setShowTokenModal(false)}
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

            {/* Content */}
            <div className="px-4 py-3 space-y-3">
              {/* Instructions */}
              <div
                className="
                  rounded-md px-3 py-2
                  bg-surface
                "
                style={{ backgroundColor: 'var(--color-bg-surface)' }}
              >
                <p
                  className="text-body-sm whitespace-pre-line"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {oauthInstructions || 'Разрешите доступ на странице Яндекса, скопируйте код авторизации и вставьте его ниже.'}
                </p>
              </div>

              {/* Token input */}
              <div className="space-y-2">
                <label
                  className="text-body-sm font-medium"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Код авторизации
                </label>
                <input
                  type="text"
                  value={oauthToken}
                  onChange={(e) => setOauthToken(e.target.value)}
                  placeholder="Вставьте код со страницы Яндекса"
                  className="
                    w-full rounded-md px-3 py-2
                    border
                    text-body-sm
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                  "
                  style={{
                    color: 'var(--color-text-primary)',
                    borderColor: 'var(--color-border-default)',
                    backgroundColor: 'var(--color-bg-surface)',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !tokenSubmitting) {
                      handleStoreToken();
                    }
                  }}
                  disabled={tokenSubmitting}
                  aria-label="Код авторизации от Yandex"
                />
              </div>

              {/* Submit button */}
              <button
                onClick={handleStoreToken}
                disabled={tokenSubmitting || !oauthToken.trim()}
                className="
                  w-full rounded-card px-4 py-2
                  text-body-sm font-medium
                  transition-all duration-fast
                  hover:opacity-90 active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                  disabled:opacity-50
                "
                style={{
                  backgroundColor: 'var(--color-accent-amber)',
                  color: '#000',
                }}
                aria-label="Подключить календарь"
              >
                {tokenSubmitting ? 'Подключение...' : '✓ Подключить'}
              </button>

              {/* Link to verification code page */}
              <a
                href="https://oauth.yandex.ru/verification_code"
                target="_blank"
                rel="noopener noreferrer"
                className="
                  block text-center text-body-sm
                  transition-colors duration-fast
                  hover:underline
                "
                style={{ color: 'var(--color-accent-amber)' }}
              >
                Открыть страницу с кодом →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* CalDAV app password modal (CAL-08) */}
      {showPasswordModal && (
        <div
          className="fixed inset-x-0 z-modal flex items-end justify-center sm:items-center pb-safe-bottom pt-safe-top"
          style={{ paddingBottom: Math.max(0, 16) + 'px' }}
          role="dialog"
          aria-modal="true"
          aria-label="Пароль приложения Яндекс"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={!passwordSubmitting ? () => setShowPasswordModal(false) : undefined}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-md rounded-t-card sm:rounded-card border animate-slide-up"
            style={{
              maxHeight: 'calc(var(--tg-viewport-stable-height, 100dvh) - 16px)',
              overflowY: 'auto',
              background: 'var(--color-bg-primary-dark, #0A0A0A)',
              borderColor: 'var(--color-border-default)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
              <h2 className="text-heading-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                🔑 Пароль приложения
              </h2>
              <button
                onClick={() => !passwordSubmitting && setShowPasswordModal(false)}
                className="rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber"
                aria-label="Закрыть"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--color-bg-surface)' }}>
                <p className="text-body-sm whitespace-pre-line" style={{ color: 'var(--color-text-primary)' }}>
                  {'Яндекс не даёт читать календарь по OAuth-токену — нужен отдельный пароль.\n\n1. Откройте Яндекс ID → Пароли приложений\n2. Создайте пароль типа «Календарь»\n3. Вставьте его сюда — пароль показывается один раз'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-body-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  Пароль приложения
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={caldavPassword}
                    onChange={(e) => setCaldavPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !passwordSubmitting) handleSavePassword(); }}
                    disabled={passwordSubmitting}
                    autoComplete="off"
                    placeholder="Вставьте пароль приложения"
                    className="w-full rounded-md px-3 py-2 pr-10 border text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber"
                    style={{
                      color: 'var(--color-text-primary)',
                      borderColor: 'var(--color-border-default)',
                      backgroundColor: 'var(--color-bg-surface)',
                    }}
                    aria-label="Пароль приложения Яндекс"
                  />
                  <button
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber"
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" stroke="var(--color-text-muted)" strokeWidth="1.2" />
                      <circle cx="8" cy="8" r="2" stroke="var(--color-text-muted)" strokeWidth="1.2" />
                    </svg>
                  </button>
                </div>
              </div>

              {passwordError && (
                <p className="text-body-xs" style={{ color: 'var(--color-error)' }}>{passwordError}</p>
              )}

              <button
                onClick={handleSavePassword}
                disabled={passwordSubmitting || !caldavPassword.trim()}
                className="w-full rounded-card px-4 py-2 text-body-sm font-medium transition-all duration-fast hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent-amber)', color: '#000' }}
                aria-label="Сохранить пароль"
              >
                {passwordSubmitting ? 'Сохранение...' : '✓ Сохранить и синхронизировать'}
              </button>

              <a
                href="https://id.yandex.ru/security/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-body-sm transition-colors duration-fast hover:underline"
                style={{ color: 'var(--color-accent-amber)' }}
              >
                Открыть пароли приложений →
              </a>
            </div>
          </div>
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
          <OrbitLoader />
        </div>
      }
    >
      <CalendarContent />
    </Suspense>
  );
}