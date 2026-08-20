'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreateDeskForm, type CreateDeskFormValue } from '@/components/desk-create';
import { ColleagueSelectSheet, type ColleagueItem } from '@/components/desk-create/ColleagueSelectSheet';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
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
 * 5. If documents selected → POST /api/workspaces/{id}/documents
 * 6. On success → redirect to /boards
 */

export default function CreateBoardPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();
  const { isLoading: authLoading, error: authError, refresh } = useTelegramAuth();
  const { loadBoardsData } = useData();

  // Colleagues state
  const [allColleagues, setAllColleagues] = useState<ColleagueItem[]>([]);
  const [selectedColleagues, setSelectedColleagues] = useState<ColleagueItem[]>([]);
  const [selectOpen, setSelectOpen] = useState(false);
  const [colleaguesLoaded, setColleaguesLoaded] = useState(false);

  // Сброс скролла при переходе на страницу
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Load available colleagues from owner workspaces
  useEffect(() => {
    let cancelled = false;

    async function loadColleagues() {
      try {
        const initData = getTelegramInitData();
        const url = `/api/workspaces/colleagues?init_data=${encodeURIComponent(initData)}`;
        const res = await fetch(url);
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error('colleagues API error:', res.status, errText);
          return;
        }
        const json = await res.json();
        if (json.success && !cancelled) {
          console.log('colleagues loaded:', json.data?.length || 0);
          setAllColleagues(json.data || []);
        }
      } catch (e) {
        console.error('Failed to load colleagues:', e);
      } finally {
        if (!cancelled) setColleaguesLoaded(true);
      }
    }

    loadColleagues();
    return () => { cancelled = true; };
  }, []);

  // This page is accessible to all authenticated users for creating boards.

  function getTelegramInitData(): string {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
      return (window as any).Telegram.WebApp.initData;
    }
    return '';
  }

  /**
   * Upload files to the workspace documents endpoint.
   */
  const uploadDocuments = async (workspaceId: string, files: File[]): Promise<boolean> => {
    if (!files.length) return true;

    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }

    const res = await fetch(`/api/workspaces/${workspaceId}/documents`, {
      method: 'POST',
      headers: {
        'x-telegram-init-data': getTelegramInitData(),
      },
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      console.error('Document upload failed:', errData);
      return false;
    }

    return true;
  };

  /**
   * Toggle a colleague's selection.
   */
  const handleToggleColleague = useCallback((sourceId: string) => {
    setSelectedColleagues((prev) => {
      const exists = prev.find((c) => c.source_id === sourceId);
      if (exists) {
        return prev.filter((c) => c.source_id !== sourceId);
      }
      const item = allColleagues.find((c) => c.source_id === sourceId);
      if (!item) return prev;
      return [...prev, item];
    });
  }, [allColleagues]);

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
          ? { enabled: true, values: spValues, hours_per_sp: value.spHours, sprint_enabled: value.spSprintEnabled }
          : { enabled: false, sprint_enabled: value.spSprintEnabled },

        enable_cognitive_budget: value.cognitiveWeightEnabled,

        workspace_context: value.context.trim() || undefined,

        external_links: value.linksEnabled && value.links.length > 0
          ? value.links.map(link => ({
              name: link.label.trim().slice(0, 100),
              url: link.url.trim().slice(0, 2048),
            }))
          : undefined,

        deadline_signals: value.trafficLightEnabled
          ? [
              { value: value.warningDays, label: `${value.warningDays} ${labelDays(value.warningDays)}` },
              { value: value.urgentDays, label: `${value.urgentDays} ${labelDays(value.urgentDays)}` },
            ]
          : undefined,

        doc_kb_enabled: value.documentsEnabled,

        // Coworking: add selected colleagues as workers
        coworking_members: value.colleagueIds.length > 0
          ? value.colleagueIds.map((sid) => ({ source_id: sid }))
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

      const result = await res.json();
      const workspaceId = result.data?.workspace?.id;

      // Upload documents if any were selected
      if (workspaceId && value.documents.length > 0) {
        const uploadSuccess = await uploadDocuments(workspaceId, value.documents);
        if (!uploadSuccess) {
          // Don't block creation, just log the error
          console.warn('Document upload failed, but workspace was created successfully');
        }
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

  if (authLoading || !colleaguesLoaded) {
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
    <main
      className="min-h-[var(--tg-viewport-stable-height)] bg-bg"
      style={{
        paddingTop: "max(64px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--size-bottom-menu-height) + 16px)",
      }}
    >
      {error && (
        <div className="px-4 pt-4">
          <div className="rounded-[10px] bg-accent-amber/10 px-4 py-2 text-sm text-[#F59E0B]" role="alert">
            {error}
          </div>
        </div>
      )}
      <CreateDeskForm
        onSubmit={handleSubmit}
        availableColleagues={allColleagues}
        selectedColleagues={selectedColleagues}
        onToggleColleague={handleToggleColleague}
        onOpenSelect={() => setSelectOpen(true)}
      />

      {/* Colleague selection bottom sheet */}
      <ColleagueSelectSheet
        open={selectOpen}
        onClose={() => setSelectOpen(false)}
        colleagues={allColleagues}
        selectedIds={new Set(selectedColleagues.map((c) => c.source_id))}
        onToggle={handleToggleColleague}
        onConfirm={() => {}} // handled by CreateDeskForm submit
        stacked={true}
      />
    </main>
  );
}

function labelDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
  return 'дней';
}