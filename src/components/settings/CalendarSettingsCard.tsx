'use client';

import React, { useState, useEffect } from 'react';
import { getCalendarConnections, syncCalendar, disconnectCalendar } from '@/lib/api/calendar';
import { getClient } from '@/lib/supabase/client';
import { Button, SectionHeader } from '@/components/ui/desk-ui';
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
    <div className="flex flex-col gap-3 w-full bg-surface rounded-[8px] p-3">
      <SectionHeader title="Календари" />

      {error && (
        <p className="text-body-sm mb-3" style={{ color: 'var(--color-error)' }}>
          ⚠ {error}
        </p>
      )}

      {/* Yandex */}
      <div
        className="flex flex-col gap-2 rounded-md px-3 py-2"
        style={{ backgroundColor: 'var(--color-bg-dark)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>🟡</span>
            <span
              className="text-body-sm font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Яндекс Календарь
            </span>
            {yandexConn && yandexConn.provider_account_email && (
              <span
                className="text-body-xs truncate"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ({yandexConn.provider_account_email})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isConnected('yandex') && (
              <span
                className="text-body-xs"
                style={{ color: 'var(--color-signal-green)' }}
              >
                Подключено
              </span>
            )}
            {syncStatus['yandex'] === 'syncing' && (
              <span
                className="text-body-xs animate-pulse"
                style={{ color: 'var(--color-accent-amber)' }}
              >
                Синхронизация…
              </span>
            )}
            {syncStatus['yandex'] === 'success' && (
              <span
                className="text-body-xs"
                style={{ color: 'var(--color-signal-green)' }}
              >
                ✓ Готово
              </span>
            )}
            {syncStatus['yandex'] === 'error' && (
              <span
                className="text-body-xs"
                style={{ color: 'var(--color-error)' }}
              >
                ✕ Ошибка
              </span>
            )}

            {isConnected('yandex') && (
              <>
                <Button
                  variant="outline"
                  corner="field"
                  onClick={() => handleSync('yandex')}
                  disabled={syncStatus['yandex'] === 'syncing'}
                  fill="var(--color-accent-amber)"
                  textColor="#000000"
                  className="w-full"
                  aria-label="Синхронизировать Яндекс Календарь"
                >
                  ↻
                </Button>
                <Button
                  variant="outline"
                  corner="field"
                  onClick={() => yandexConn && handleDisconnect('yandex')}
                  disabled={!profileId}
                  fill="var(--color-error)"
                  textColor="#FAFAFA"
                  className="w-full"
                  aria-label="Отключить Яндекс Календарь"
                >
                  ✕
                </Button>
              </>
            )}

            {!isConnected('yandex') && (
              <Button
                variant="solid"
                corner="action"
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
                      window.location.href = data.url;
                    }
                  } catch (err) {
                    console.error('OAuth error:', err);
                  }
                }}
                fill="var(--color-accent-amber)"
                textColor="#000000"
                className="w-full"
                aria-label="Подключить Яндекс Календарь"
              >
                Подключить
              </Button>
            )}
          </div>
        </div>
      </div>

      {!isConnected('yandex') && !error && (
        <p
          className="text-body-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Подключите Яндекс Календарь для синхронизации событий.
        </p>
      )}
    </div>
  );
}