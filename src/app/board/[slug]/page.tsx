'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { BoardViewEdit } from '@/components/board';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import type { ExternalLink } from '@/components/desk-create/ExternalLinksCard';
import type { ServerDocument } from '@/components/desk-create/DocumentsCard';
import type { ColleagueItem } from '@/components/desk-create/ColleagueSelectSheet';

// Сброс скролла при переходе на страницу
function useScrollReset() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
}

/**
 * Board Detail Page — единая страница view/edit доски (паттерн TaskViewEdit).
 *
 * Route: /board/[slug] (?edit=1 — начальный режим редактирования)
 * Загрузка данных — один раз при входе в доску; переключение view↔edit —
 * мгновенное локальное переключение режима без навигации/перезагрузки.
 * /board/[slug]/edit — устаревший алиас, редиректит на ?edit=1.
 */

function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

export default function BoardDetailPage() {
  useScrollReset();
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;
  const searchParams = useSearchParams();
  const { isLoading: authLoading, error: authError, data: authData } = useTelegramAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Режим edit активен либо после клика «Редактировать» (onModeChange),
  // либо при прямом входе с ?edit=1 (для canEdit).
  const [isEditing, setIsEditing] = useState(false);
  const [renderData, setRenderData] = useState<{
    workspaceId: string;
    canEdit: boolean;
    memberCount: number;
    initialData: {
      name: string;
      slug: string;
      spCostEnabled: boolean;
      spSprintEnabled: boolean;
      spHours?: { 1: string; 3: string; 5: string; 7: string; 13: string };
      cognitiveWeightEnabled: boolean;
      context: string;
      documentsEnabled: boolean;
      linksEnabled: boolean;
      links: ExternalLink[];
      trafficLightEnabled: boolean;
      warningDays: number;
      urgentDays: number;
    };
    serverDocuments: ServerDocument[];
    availableColleagues: ColleagueItem[];
  } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (authError) {
      setError(authError);
      setLoading(false);
      return;
    }
    if (!authData) return;

    async function loadData() {
      try {
        // 1. Load workspace list to find by slug
        const res = await fetch('/api/workspaces/my-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ init_data: getTelegramInitData() }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(errData.error || 'Failed to load board data');
        }

        const json = await res.json();
        if (!json.success) {
          throw new Error(json.error || 'Failed to load board data');
        }

        const { workers: workersData, allWorkspaceWorkers: allWorkersData, workspaces: wsData } = json.data;

        // Find workspace by slug
        const ws = (wsData ?? []).find((w: any) => w.slug === slug);
        if (!ws) {
          router.push('/boards');
          return;
        }

        // Может ли текущий пользователь редактировать доску (owner)
        const myWorker = (workersData ?? []).find((w: any) => w.workspace_id === ws.id);
        const canEdit = myWorker?.role === 'owner';

        // 2. Load workspace settings and links
        const settingsRes = await fetch(`/api/workspaces/${ws.id}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ init_data: getTelegramInitData() }),
        });

        let settingsData: any = null;
        let linksData: any[] = [];
        let serverDocuments: ServerDocument[] = [];

        if (settingsRes.ok) {
          const settingsJson = await settingsRes.json();
          if (settingsJson.success) {
            settingsData = settingsJson.data?.workspace_settings;
            linksData = settingsJson.data?.workspace_links ?? [];
          }
        }

        // 3. Load server documents — always fetch them regardless of doc_kb_config.enabled
        //    This ensures users can see their uploaded documents even if the feature was later disabled.
        try {
          const docsRes = await fetch(`/api/workspaces/${ws.id}/documents`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'x-telegram-init-data': getTelegramInitData(),
            },
          });
          if (!docsRes.ok) {
            console.warn('Board detail: failed to load documents, status:', docsRes.status);
          } else {
            const docsJson = await docsRes.json();
            if (docsJson.success) {
              serverDocuments = (docsJson.data?.documents ?? []).map((d: any) => ({
                id: d.id,
                filename: d.filename,
                file_type: d.file_type,
                size_bytes: d.size_bytes,
                status: d.status,
                chunk_count: d.chunk_count,
                storage_path: d.storage_path,
                created_at: d.created_at,
              }));
            }
          }
        } catch (err) {
          console.error('Board detail: failed to load documents', err);
        }

        // 4. Load colleagues — один раз при входе в доску, чтобы вход в edit
        //    не требовал повторной загрузки (мгновенное переключение).
        let availableColleagues: ColleagueItem[] = [];
        try {
          const collRes = await fetch(
            `/api/workspaces/colleagues?init_data=${encodeURIComponent(getTelegramInitData())}&workspace_id=${ws.id}`,
          );
          if (collRes.ok) {
            const collJson = await collRes.json();
            if (collJson.success) {
              availableColleagues = collJson.data ?? [];
            }
          }
        } catch (err) {
          console.error('Board detail: failed to load colleagues', err);
        }

        // Parse deadline_signals with level field
        const signals = (settingsData?.deadline_signals ?? []) as any[];
        const hasSignals = signals.length > 0;

        const amberSignal = signals.find((s: any) => s.level === 'amber' || s.value >= 2);
        const redSignal = signals.find((s: any) => s.level === 'red' || s.value <= 1);

        // Count colleagues (active human workers in this workspace)
        const memberWorkers = (allWorkersData ?? []).filter(
          (w: any) => w.workspace_id === ws.id && w.type === 'human' && w.is_active === true,
        );

        setRenderData({
          workspaceId: ws.id,
          canEdit,
          memberCount: memberWorkers.length,
          initialData: {
            name: ws.name || '',
            slug: ws.slug || '',
            spCostEnabled: (settingsData?.story_points_config?.enabled) ?? false,
            spSprintEnabled: (settingsData?.story_points_config?.sprint_enabled) ?? false,
            spHours: (settingsData?.story_points_config?.hours_per_sp) as
              | { 1: string; 3: string; 5: string; 7: string; 13: string }
              | undefined,
            cognitiveWeightEnabled: settingsData?.enable_cognitive_budget ?? false,
            context: settingsData?.workspace_context || '',
            // Show documents section if feature was enabled OR if there are existing documents
            documentsEnabled: (settingsData?.doc_kb_config?.enabled ?? false) || serverDocuments.length > 0,
            linksEnabled: linksData.length > 0,
            links: linksData.map((link: any) => ({
              label: link.name || link.label || '',
              url: link.url || '',
            })),
            trafficLightEnabled: hasSignals,
            warningDays: amberSignal?.value ?? 3,
            urgentDays: redSignal?.value ?? 1,
          },
          serverDocuments,
          availableColleagues,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        console.error('Board detail page load error:', message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [authLoading, authError, authData, slug, router]);

  const bgStyle = { background: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark, #0A0A0A))' };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-dvh" style={bgStyle}>
        <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
      </div>
    );
  }

  if (authError || error) {
    return (
      <div className="flex items-center justify-center h-full min-h-dvh p-4" style={bgStyle}>
        <div className="text-center max-w-sm">
          <p style={{ color: '#EF4444', fontFamily: 'system-ui' }}>
            {authError || error}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: '14px',
              padding: '8px 16px',
              borderRadius: '8px',
              backgroundColor: '#F59E0B',
              color: '#0A0A0A',
              border: 'none',
              cursor: 'pointer',
              fontWeight: '600',
              marginTop: '12px',
            }}
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (!renderData) {
    return null;
  }

  const initialMode: 'view' | 'edit' = searchParams?.get('edit') === '1' ? 'edit' : 'view';
  const editingNow = isEditing || (renderData.canEdit && initialMode === 'edit');

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)]"
      style={{
        ...bgStyle,
        paddingTop: "max(64px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--size-bottom-menu-height) + 16px)",
      }}
    >
      <BoardViewEdit
        workspaceId={renderData.workspaceId}
        initialData={renderData.initialData}
        serverDocuments={renderData.serverDocuments}
        canEdit={renderData.canEdit}
        initialMode={initialMode}
        availableColleagues={renderData.availableColleagues}
        memberCount={renderData.memberCount}
        onModeChange={(m) => setIsEditing(m === 'edit')}
      />

      {/* Back button — скрыт в режиме редактирования */}
      {!editingNow && (
        <div
          className="px-4 pt-1"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            onClick={() => router.back()}
            className="block h-10 w-full appearance-none border-0 bg-transparent p-0"
          >
            <NotchedPanel
              corner="action"
              notch={8}
              radius={4}
              borderWidth={1.5}
              borderGradient={['var(--color-grad-add-from)', 'var(--color-grad-add-to)']}
              fill="#101010"
              className="h-full"
              contentClassName="flex h-full w-full items-center justify-center text-[15px] font-semibold text-text"
            >
              Назад
            </NotchedPanel>
          </button>
        </div>
      )}
    </main>
  );
}