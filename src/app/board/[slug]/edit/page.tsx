'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { EditDeskForm } from '@/components/desk-create/EditDeskForm';
import type { ExternalLink } from '@/components/desk-create/ExternalLinksCard';

// Сброс скролла при переходе на страницу
function useScrollReset() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
}

function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

export default function BoardEditPage() {
  useScrollReset();
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;
  const { isLoading: authLoading, error: authError, data: authData } = useTelegramAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<any>(null);
  const [initialData, setInitialData] = useState<{
    name: string;
    slug: string;
    spCostEnabled: boolean;
    spSprintEnabled: boolean;
    cognitiveWeightEnabled: boolean;
    context: string;
    documentsEnabled: boolean;
    linksEnabled: boolean;
    links: ExternalLink[];
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

        const { workspaces: wsData } = json.data;

        // Find workspace by slug
        const ws = (wsData ?? []).find((w: any) => w.slug === slug);
        if (!ws) {
          router.push('/boards');
          return;
        }

        setWorkspace(ws);

        // 2. Load workspace settings and links via new dedicated endpoint
        const settingsRes = await fetch(`/api/workspaces/${ws.id}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ init_data: getTelegramInitData() }),
        });

        let settingsData: any = null;
        let linksData: any[] = [];

        if (settingsRes.ok) {
          const settingsJson = await settingsRes.json();
          if (settingsJson.success) {
            settingsData = settingsJson.data?.workspace_settings;
            linksData = settingsJson.data?.workspace_links ?? [];
          }
        }

        // Parse deadline_signals with level field
        const signals = (settingsData?.deadline_signals ?? []) as any[];
        const hasSignals = signals.length > 0;

        // Extract warning/urgent days from signals
        const amberSignal = signals.find((s: any) => s.level === 'amber' || s.value >= 2);
        const redSignal = signals.find((s: any) => s.level === 'red' || s.value <= 1);

        // Transform into form initial data
        setInitialData({
          name: ws.name || '',
          slug: ws.slug || '',
          spCostEnabled: (settingsData?.story_points_config?.enabled) ?? false,
          spSprintEnabled: (settingsData?.story_points_config?.sprint_enabled) ?? false,
          cognitiveWeightEnabled: settingsData?.enable_cognitive_budget ?? false,
          context: settingsData?.workspace_context || '',
          documentsEnabled: false,
          linksEnabled: linksData.length > 0,
          links: linksData.map((link: any) => ({
            label: link.name || link.label || '',
            url: link.url || '',
          })),
          trafficLightEnabled: hasSignals,
          warningDays: amberSignal?.value ?? 3,
          urgentDays: redSignal?.value ?? 1,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        console.error('Board edit page load error:', message);
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

  if (!workspace || !initialData) {
    return null;
  }

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height)] bg-bg"
      style={{
        paddingTop: "max(64px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--size-bottom-menu-height) + 16px)",
      }}
    >
      <EditDeskForm
        workspaceId={workspace.id}
        initialData={initialData}
        onAddColleague={() => router.push(`/board/${slug}/members`)}
      />
    </main>
  );
}