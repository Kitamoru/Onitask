'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CreateDeskForm, type CreateDeskFormValue } from '@/components/desk-create';
import { useAuth } from '@/hooks/useAuth';
import { useData } from '@/contexts/DataContext';

/**
 * Create Board page — универсальная форма создания доски.
 * 
 * Route: /boards/new
 * Доступна для всех авторизованных пользователей (не только новых).
 * 
 * Flow:
 * 1. Проверяем авторизацию
 * 2. Пользователь заполняет CreateDeskForm
 * 3. Submit → POST /api/workspaces
 * 4. On success → refresh auth + boards data → redirect to /boards
 */

export default function CreateBoardPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();
  const { isLoading: authLoading, error: authError, refresh } = useAuth();
  const { loadBoardsData } = useData();

  function getTelegramInitData(): string {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
      return (window as any).Telegram.WebApp.initData;
    }
    return '';
  }

  /**
   * Submit handler for board creation.
   * 
   * Flow: validate → POST /api/workspaces → refresh auth + reload boards → redirect to /boards
   * 
   * IMPORTANT: We do NOT redirect to /flowboard here — always go to /boards so user
   * can see their newly created board in the list alongside existing ones.
   */
  const handleSubmit = async (value: CreateDeskFormValue) => {
    setSubmitting(true);
    setError(undefined);

    try {
      // Validate slug length
      if (value.slug.length > 0 && (value.slug.length < 4 || value.slug.length > 5)) {
        setError('Идентификатор доски должен быть 4 или 5 символов');
        setSubmitting(false);
        return;
      }

      const spValues: [number, number, number, number, number] = [1, 3, 5, 7, 13];

      const payload: Record<string, unknown> = {
        init_data: getTelegramInitData(),
        name: value.name,
        slug: value.slug.toLowerCase().replace(/[^a-z0-9_-]/g, ''),

        story_points_config: value.spCostEnabled
          ? { enabled: true, values: spValues }
          : { enabled: false },

        enable_cognitive_budget: value.cognitiveWeightEnabled,

        workspace_context: value.context.trim() || undefined,

        external_links: value.linksEnabled && value.links.length > 0
          ? value.links.map(link => ({
              name: link.title.trim().slice(0, 100),
              url: link.url.trim().slice(0, 2048),
            }))
          : undefined,

        deadline_signals: value.trafficLightEnabled
          ? [
              { value: value.warningDays, label: `${value.warningDays} ${labelDays(value.warningDays)}` },
              { value: value.urgentDays, label: `${value.urgentDays} ${labelDays(value.urgentDays)}` },
            ]
          : undefined,
      };

      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || errData.message || res.statusText || 'Failed to create board');
      }

      // Refresh auth session and reload boards list
      await Promise.all([refresh(), loadBoardsData()]);
      
      // Always redirect to /boards (not /flowboard) — user expects to see their board list
      router.replace('/boards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh p-4"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="text-center max-w-sm">
          <p style={{ color: '#EF4444', fontFamily: 'system-ui' }}>
            Ошибка авторизации. Откройте приложение через Telegram Web App.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-bg pt-[48px]">
      {/* Error banner */}
      {error && (
        <div className="px-4 pt-4">
          <div className="rounded-[10px] bg-accent-amber/10 px-4 py-2 text-sm text-[#F59E0B]" role="alert">
            {error}
          </div>
        </div>
      )}

      {/* Submit overlay — prevents double-submission and shows loading state */}
      {submitting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          aria-live="polite"
        >
          <div className="text-center">
            <div
              className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-accent-amber/30 border-t-accent-amber"
              style={{ width: '40px', height: '40px' }}
            />
            <p
              style={{
                color: '#FAFAFA',
                fontFamily: "'Inter Display', system-ui, sans-serif",
                fontSize: '14px',
              }}
            >
              Создание доски...
            </p>
          </div>
        </div>
      )}

      <CreateDeskForm
        onSubmit={handleSubmit}
        onAddColleague={() => console.log('add colleague')}
      />
    </div>
  );
}

function labelDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
  return 'дней';
}