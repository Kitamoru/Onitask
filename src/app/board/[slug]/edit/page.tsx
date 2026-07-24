'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { EditDeskForm } from '@/components/desk-create/EditDeskForm';
import type { ExternalLink } from '@/components/desk-create/ExternalLinksCard';

function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

export default function BoardEditPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;
  const { isLoading: authLoading, error: authError, data: authData } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<any>(null);
  const [initialData, setInitialData] = useState<{
    name: string;
    slug: string;
    spCostEnabled: boolean;
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

        // Transform workspace data into form initial data
        setInitialData({
          name: ws.name || '',
          slug: ws.slug || '',
          spCostEnabled: ws.story_points_config?.enabled || false,
          cognitiveWeightEnabled: ws.enable_cognitive_budget || false,
          context: ws.workspace_context || '',
          documentsEnabled: false,
          linksEnabled: (ws.external_links?.length ?? 0) > 0,
          links: (ws.external_links || []).map((link: any) => ({
            id: link.id || crypto.randomUUID(),
            name: link.name || link.label || '',
            url: link.url || '',
          })),
          trafficLightEnabled: (ws.deadline_signals?.length ?? 0) > 0,
          warningDays: ws.deadline_signals?.find((s: any) => s.value === 1) ? 1 : 0,
          urgentDays: ws.deadline_signals?.find((s: any) => s.value === 3) ? 3 : 0,
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
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid #2A2A2A' }}>
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="16" height="11" rx="1.5" stroke="#F59E0B" strokeWidth="1.5" />
            <rect x="7" y="14" width="6" height="2" rx="0.5" fill="#F59E0B" />
            <rect x="5" y="16" width="10" height="1" rx="0.5" fill="#F59E0B" />
          </svg>
          <h1
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-md)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
            }}
          >
            Редактирование доски
          </h1>
        </div>
        <button
          onClick={() => router.push(`/board/${slug}`)}
          className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-surface/50"
          aria-label="Закрыть"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5 5L15 15M15 5L5 15"
              stroke="var(--color-text-muted)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Form */}
      <EditDeskForm
        workspaceId={workspace.id}
        initialData={initialData}
        onAddColleague={() => router.push(`/board/${slug}/members`)}
      />
    </div>
  );
}