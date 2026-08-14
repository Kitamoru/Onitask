'use client';

import React, { useState, useEffect } from 'react';
import { getCalendarConnections, syncCalendar, disconnectCalendar } from '@/lib/api/calendar';
import { getClient } from '@/lib/supabase/client';
import type { CalendarConnection, CalendarProvider } from '@/types/calendar';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface CalendarSettingsCardProps {
  workspaceId: string;
}

type SyncStatus = Record<string, 'idle' | 'syncing' | 'success' | 'error'>;

// ═══════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════

export function CalendarSettingsCard({ workspaceId }: CalendarSettingsCardProps) {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({});
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  const isConnected = (provider: CalendarProvider) => {
    return connections.some((c) => c.provider === provider && c.is_active);
  };

  // Fetch profile_id from auth (profiles.id = auth.users.id)
  useEffect(() => {
    async function fetchProfileId() {
      try {
        const supabase = getClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          setProfileId(user.id);
        }
      } catch (err) {
        console.error('Failed to fetch profile_id:', err);
      }
    }

    fetchProfileId();
  }, []);

  useEffect(() => {
    if (!workspaceId || !profileId) return;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await getCalendarConnections(profileId!);
        if (res.error) {
          setError('Не удалось загрузить подключения');
        } else {
          setConnections(res.data ?? []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [workspaceId, profileId]);

  async function handleSync(provider: CalendarProvider) {
    if (!profileId) return;
    setSyncStatus((prev) => ({ ...prev, [provider]: 'syncing' }));
    try {
      await syncCalendar({ 
        profile_id: profileId,
        provider, 
        action: 'sync' 
      });
      setSyncStatus((prev) => ({ ...prev, [provider]: 'success' }));
      setTimeout(() => setSyncStatus((prev) => ({ ...prev, [provider]: 'idle' })), 2000);
      
      // Reload connections
      const res = await getCalendarConnections(profileId);
      if (!res.error) setConnections(res.data ?? []);
    } catch (err) {
      console.error('Sync error:', err);
      setSyncStatus((prev) => ({ ...prev, [provider]: 'error' }));
    }
  }

  async function handleDisconnect(provider: CalendarProvider) {
    if (!profileId) return;
    const result = await disconnectCalendar(profileId, provider);
    if (result.success) {
      setConnections((prev) => prev.filter((c) => !(c.provider === provider)));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-body-sm" style={{ color: 'var(--color-text-muted)' }}>
          Загрузка…
        </span>
      </div>
    );
  }

  const yandexConn = connections.find((c) => c.provider === 'yandex' && c.is_active);

  return (
    <div
      className="rounded-card border p-4"
      style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-bg-surface)' }}
    >
      <h3
        className="text-heading-sm font-semibold mb-3 flex items-center gap-2"
        style={{ color: 'var(--color-text-primary)' }}
      >
        📅 Календари
      </h3>

      {error && (
        <p className="text-body-sm mb-3" style={{ color: 'var(--color-error)' }}>
          ⚠ {error}
        </p>
      )}

      {/* Yandex */}
      <div
        className="flex items-center justify-between rounded-md px-3 py-2"
        style={{ backgroundColor: 'var(--color-bg-dark)' }}
      >
        <div className="flex items-center gap-2">
          <span>🟡</span>
          <span className="text-body-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Яндекс Календарь
          </span>
          {yandexConn && yandexConn.provider_account_email && (
            <span className="text-body-xs" style={{ color: 'var(--color-text-muted)' }}>
              ({yandexConn.provider_account_email})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isConnected('yandex') && (
            <span className="text-body-xs" style={{ color: 'var(--color-signal-green)' }}>
              Подключено
            </span>
          )}
          {syncStatus['yandex'] === 'syncing' && (
            <span className="text-body-xs animate-pulse" style={{ color: 'var(--color-accent-amber)' }}>
              Синхронизация…
            </span>
          )}
          {syncStatus['yandex'] === 'success' && (
            <span className="text-body-xs" style={{ color: 'var(--color-signal-green)' }}>
              ✓ Готово
            </span>
          )}
          {syncStatus['yandex'] === 'error' && (
            <span className="text-body-xs" style={{ color: 'var(--color-error)' }}>
              ✕ Ошибка
            </span>
          )}

          {isConnected('yandex') && (
            <>
              <button
                onClick={() => handleSync('yandex')}
                disabled={syncStatus['yandex'] === 'syncing'}
                className="rounded-sm px-2 py-1 text-body-xs transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber disabled:opacity-50"
                style={{ color: 'var(--color-accent-amber)' }}
                aria-label="Синхронизировать Яндекс Календарь"
              >
                ↻
              </button>
              <button
                onClick={() => yandexConn && handleDisconnect('yandex')}
                disabled={!profileId}
                className="rounded-sm px-2 py-1 text-body-xs transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-50"
                style={{ color: 'var(--color-error)' }}
                aria-label="Отключить Яндекс Календарь"
              >
                ✕
              </button>
            </>
          )}

          {!isConnected('yandex') && (
            <button
              onClick={async () => {
                if (!profileId) return;
                try {
                  const res = await fetch(`${window.location.origin}/api/calendar/connect/yandex`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile_id: profileId }),
                  });
                  const data = await res.json();
                  if (data.url) {
                    // Redirect to Yandex OAuth — after auth, Yandex redirects back to callback
                    window.location.href = data.url;
                  }
                } catch (err) {
                  console.error('OAuth error:', err);
                }
              }}
              className="rounded-sm px-2 py-1 text-body-xs font-medium transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber"
              style={{ backgroundColor: 'var(--color-accent-amber)', color: '#000' }}
              aria-label="Подключить Яндекс Календарь"
            >
              Подключить
            </button>
          )}
        </div>
      </div>

      {!isConnected('yandex') && !error && (
        <p className="text-body-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
          Подключите Яндекс Календарь для синхронизации событий.
        </p>
      )}
    </div>
  );
}