'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { BoardDetail } from '@/components/board';
import type { ExternalLinkData, DocumentData, TaskCardData, WorkerCardData } from '@/components/board';

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
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;
  const { isLoading: authLoading, error: authError, data: authData } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

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

  // Build task cards
  const taskCards: TaskCardData[] = tasks.map((t: any) => ({
    id: t.id,
    title: t.title,
    column: t.column || 'backlog',
  }));

  // Build colleagues (human workers)
  const colleagues: WorkerCardData[] = memberWorkers.map((w: any) => ({
    id: w.id,
    displayName: w.display_name || w.source_id.slice(0, 8),
    avatarUrl: w.avatar_url,
    cognitiveWeight: w.cognitive_weight ?? 1,
    spPerDay: w.sp_per_day ?? 8,
    trendUp: false,
    roleLabel: w.role || 'member',
    activeTasks: 0,
    overloaded: false,
    tasks: [],
  }));

  // Build external links placeholder
  const externalLinks: ExternalLinkData[] = [];

  // Build documents placeholder
  const boardDocuments: DocumentData[] = [];

  // Build board settings for display
  const boardSettings = {
    spCostEnabled: workspace.story_points_config?.enabled || false,
    cognitiveWeightEnabled: workspace.enable_cognitive_budget || false,
    context: workspace.workspace_context || '',
  };

  return (
    <BoardDetail
      boardName={workspace.name}
      slug={workspace.slug}
      sprintTasks={taskCards}
      colleagues={colleagues}
      externalLinks={externalLinks}
      documents={boardDocuments}
      deadlineWarningDays={2}
      boardSettings={boardSettings}
    />
  );
}