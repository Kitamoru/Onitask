'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { BoardDetail } from '@/components/board';

// Сброс скролла при переходе на страницу
function useScrollReset() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
}
import type { ExternalLinkData, DocumentData, WorkerCardData } from '@/components/board';

/**
 * Board Detail Page — displays the content of a single board/workspace.
 * 
 * Route: /board/[slug]
 * Matches Figma node: 1:836 (desk / [desk_UUID] / edit)
 * 
 * Now uses /api/workspaces/my-data (server-side, service_role key) 
 * instead of direct Supabase client queries.
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
  const [workspace, setWorkspace] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [links, setLinks] = useState<any[]>([]);

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

        const { workers: workersData, workspaces: wsData, tasks: tasksData } = json.data;

        setWorkers(workersData ?? []);

        const workspaceIds = (workersData ?? []).map((w: any) => w.workspace_id).filter(Boolean);

        if (workspaceIds.length === 0) {
          setLoading(false);
          return;
        }

        // Find workspace by slug
        const ws = (wsData ?? []).find((w: any) => w.slug === slug);
        if (!ws) {
          router.push('/boards');
          return;
        }

        setWorkspace(ws);

        // Get tasks for this workspace
        const wsTasks = (tasksData ?? []).filter((t: any) => t.workspace_id === ws.id);
        setTasks(wsTasks ?? []);

        // Load workspace settings + links via dedicated endpoint
        try {
          const settingsRes = await fetch(`/api/workspaces/${ws.id}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ init_data: getTelegramInitData() }),
          });

          if (settingsRes.ok) {
            const settingsJson = await settingsRes.json();
            if (settingsJson.success) {
              setSettings(settingsJson.data?.workspace_settings ?? null);
              setLinks(settingsJson.data?.workspace_links ?? []);
            }
          }
        } catch (settingsErr) {
          console.error('Board detail: settings load error', settingsErr);
        }
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

  if (!workspace) {
    return null;
  }

  // Transform data into BoardDetail props
  const memberWorkers = workers.filter((w: any) => w.workspace_id === workspace.id && w.type === 'human');
  const agentWorkers = workers.filter((w: any) => w.workspace_id === workspace.id && w.type === 'agent');

  // Build colleagues (human workers) — maps to FlowBoard's WorkerCardData
  const colleagues: WorkerCardData[] = memberWorkers.map((w: any) => ({
    id: w.id,
    displayName: w.display_name || w.source_id.slice(0, 8),
    avatarUrl: w.avatar_url,
    cognitiveWeight: w.cognitive_weight ?? 1,
    spPerDay: w.sp_per_day ?? 8,
    trendUp: false,
    roleLabel: w.role || 'member',
    activeDays: 0,
    overloaded: false,
    tasks: [],
  }));

  // Build external links from loaded settings data
  const externalLinks: ExternalLinkData[] = links.map((link: any) => ({
    id: link.id,
    label: link.name || link.label || '',
    url: link.url || '',
  }));

  // Build documents placeholder (doc storage not yet implemented)
  const boardDocuments: DocumentData[] = [];

  // Build board settings from loaded workspace_settings
  const spConfig = settings?.story_points_config || {};
  const boardSettings = {
    spCostEnabled: spConfig.enabled || false,
    spSprintEnabled: spConfig.sprint_enabled || false,
    cognitiveWeightEnabled: settings?.enable_cognitive_budget || false,
    context: settings?.workspace_context || '',
    documentsEnabled: settings?.doc_kb_config?.enabled ?? false,
  };

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)] bg-bg"
      style={{
        paddingTop: "max(64px, var(--tg-content-safe-top, 0px))",
        paddingBottom: "calc(var(--size-bottom-menu-height) + 16px)",
      }}
    >
      <BoardDetail
        boardName={workspace.name}
        slug={workspace.slug}
        colleagues={colleagues}
        externalLinks={externalLinks}
        documents={boardDocuments}
        boardSettings={boardSettings}
      />
    </main>
  );
}