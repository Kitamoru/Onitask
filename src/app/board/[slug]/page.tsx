'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { BoardDetail } from '@/components/board';
import type { ExternalLink } from '@/components/desk-create/ExternalLinksCard';
import type { ServerDocument } from '@/components/desk-create/DocumentsCard';

// Сброс скролла при переходе на страницу
function useScrollReset() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
}

/**
 * Board Detail Page — displays the content of a single board/workspace.
 *
 * Route: /board/[slug]
 * Uses the same desk-ui layout as the edit page, but all fields are disabled.
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
  const { isLoading: authLoading, error: authError, data: authData } = useTelegramAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailProps, setDetailProps] = useState<{
    boardName: string;
    slug: string;
    spCostEnabled: boolean;
    spSprintEnabled: boolean;
    spHours?: { 1: string; 3: string; 5: string; 7: string; 13: string };
    cognitiveWeightEnabled: boolean;
    colleagueCount: number;
    context: string;
    documentsEnabled: boolean;
    linksEnabled: boolean;
    links: ExternalLink[];
    serverDocuments: ServerDocument[];
    trafficLightEnabled: boolean;
    warningDays: number;
    urgentDays: number;
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

        const { workers: workersData, workspaces: wsData } = json.data;

        // Find workspace by slug
        const ws = (wsData ?? []).find((w: any) => w.slug === slug);
        if (!ws) {
          router.push('/boards');
          return;
        }

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

        // Parse deadline_signals with level field
        const signals = (settingsData?.deadline_signals ?? []) as any[];
        const hasSignals = signals.length > 0;

        const amberSignal = signals.find((s: any) => s.level === 'amber' || s.value >= 2);
        const redSignal = signals.find((s: any) => s.level === 'red' || s.value <= 1);

        // Count colleagues (human workers in this workspace)
        const memberWorkers = (workersData ?? []).filter(
          (w: any) => w.workspace_id === ws.id && w.type === 'human',
        );

        setDetailProps({
          boardName: ws.name || '',
          slug: ws.slug || '',
          spCostEnabled: (settingsData?.story_points_config?.enabled) ?? false,
          spSprintEnabled: (settingsData?.story_points_config?.sprint_enabled) ?? false,
          spHours: (settingsData?.story_points_config?.hours_per_sp) as
            | { 1: string; 3: string; 5: string; 7: string; 13: string }
            | undefined,
          cognitiveWeightEnabled: settingsData?.enable_cognitive_budget ?? false,
          colleagueCount: memberWorkers.length,
          context: settingsData?.workspace_context || '',
          // Show documents section if feature was enabled OR if there are existing documents
          documentsEnabled: (settingsData?.doc_kb_config?.enabled ?? false) || serverDocuments.length > 0,
          linksEnabled: linksData.length > 0,
          links: linksData.map((link: any) => ({
            label: link.name || link.label || '',
            url: link.url || '',
          })),
          serverDocuments,
          trafficLightEnabled: hasSignals,
          warningDays: amberSignal?.value ?? 3,
          urgentDays: redSignal?.value ?? 1,
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

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-dvh" style={{ backgroundColor: '#0A0A0A' }}>
        <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
      </div>
    );
  }

  if (authError || error) {
    return (
      <div className="flex items-center justify-center h-full min-h-dvh p-4" style={{ backgroundColor: '#0A0A0A' }}>
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

  if (!detailProps) {
    return null;
  }

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)] bg-bg"
      style={{
        paddingTop: "max(64px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--size-bottom-menu-height) + 16px)",
      }}
    >
      <BoardDetail {...detailProps} />
    </main>
  );
}