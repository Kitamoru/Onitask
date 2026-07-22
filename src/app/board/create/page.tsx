'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CreateDeskForm, type CreateDeskFormValue } from '@/components/desk-create';
import { useAuth } from '@/hooks/useAuth';
import { useData } from '@/contexts/DataContext';

/**
 * Create Board page — renders the desk/create design from Figma.
 * 
 * Route: /board/create
 * Uses the pixel‑perfect CreateDeskForm with NotchedPanel, chamfered corners,
 * TrafficLight steppers, and all Telegram‑optimised safe‑area handling.
 * 
 * Flow:
 * 1. User arrives here either from root redirect (new user) or manually
 * 2. If user already has a workspace (not new), redirect to /flowboard
 * 3. User fills CreateDeskForm
 * 4. Submit → POST /api/workspaces with form data + Telegram init_data
 * 5. On success → redirect to /boards
 */

export default function CreateBoardPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();
  const { isLoading: authLoading, error: authError, refresh } = useAuth();
  const { loadBoardsData } = useData();

  // This page is accessible to all authenticated users for creating boards.

  function getTelegramInitData(): string {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
      return (window as any).Telegram.WebApp.initData;
    }
    return '';
  }

  /**
   * Maps the new CreateDeskForm format to the API payload.
   * SP hours are stored as raw strings; deadline signals are derived
   * from the traffic‑light stepper values.
   */
  const handleSubmit = async (value: CreateDeskFormValue) => {
    setLoading(true);
    setError(undefined);

    try {
      if (value.slug.length > 0 && (value.slug.length < 4 || value.slug.length > 5)) {
        setError('Идентификатор доски должен быть 4 или 5 символов');
        setLoading(false);
        return;
      }

      // Build the SP values array from the hours map (fall back to default)
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

      await refresh();
      await loadBoardsData();
      router.push('/boards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
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
    <div className="flex min-h-dvh w-full flex-col bg-bg pt-[48px]">
      {error && (
        <div className="px-4 pt-4">
          <div className="rounded-[10px] bg-accent-amber/10 px-4 py-2 text-sm text-[#F59E0B]" role="alert">
            {error}
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