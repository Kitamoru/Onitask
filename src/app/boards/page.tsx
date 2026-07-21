'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { RiskPulse, BoardCard } from '@/components/board';
import type { RiskPulseData, BoardCardData } from '@/components/board';

/**
 * Boards Overview Page — "Стол" (Desk)
 * 
 * Figma spec (node 307:28401 "stol"):
 *   - Header: "Стол" with desk icon
 *   - Sub-header: board count + active board
 *   - RiskPulse section: aggregated metrics across all boards
 *   - Board list: cards with stats and sprint info
 * 
 * Uses /api/workspaces/my-data (server-side, service_role key) 
 * instead of direct Supabase client queries (which fail due to RLS).
 */

function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

export default function BoardsPage() {
  const router = useRouter();
  const { isLoading: authLoading, error: authError, data: authData } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [riskData, setRiskData] = useState<RiskPulseData>({
    people: 0,
    processes: 0,
    escalations: 0,
  });
  const [boardCards, setBoardCards] = useState<BoardCardData[]>([]);

  // No redirect - new users will see empty state and can create board via modal

  // Load boards data when auth data is available
  useEffect(() => {
    async function loadData() {
      if (!authData) return;

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

        const { workers: workersData, workspaces: wsData, tasks } = json.data;

        setWorkers(workersData ?? []);
        setWorkspaces(wsData ?? []);

        const workspaceIds = (workersData ?? []).map((w: any) => w.workspace_id).filter(Boolean);

        if (workspaceIds.length === 0) {
          setLoading(false);
          return;
        }

        const tasksList = tasks ?? [];

        // Aggregate risk data
        const peopleSet = new Set<string>();
        let processCount = 0;
        let escalationCount = 0;

        tasksList.forEach((task: any) => {
          if (task.assigned_to) {
            peopleSet.add(task.assigned_to);
          }
          if (task.column === 'process') {
            processCount++;
          }
          if (task.escalation_reason) {
            escalationCount++;
          }
        });

        setRiskData({
          people: peopleSet.size,
          processes: processCount,
          escalations: escalationCount,
        });

        // Build board cards
        const cards: BoardCardData[] = (wsData ?? []).map((ws: any) => {
          const wsTasks = tasksList.filter((t: any) => t.workspace_id === ws.id);
          
          return {
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
            memberCount: (workersData ?? []).filter((w: any) => w.workspace_id === ws.id && w.type === 'human').length,
            agentCount: (workersData ?? []).filter((w: any) => w.workspace_id === ws.id && w.type === 'agent').length,
            stats: {
              inWork: wsTasks.filter((t: any) => t.column === 'in_progress').length,
              escalations: wsTasks.filter((t: any) => t.escalation_reason !== null).length,
              overloaded: 0,
              done: wsTasks.filter((t: any) => t.column === 'done').length,
            },
            sprint: undefined,
          };
        });

        setBoardCards(cards);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        console.error('Boards page load error:', message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [authData]);

   // Auth loading state
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

   // Auth error state
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

   if (loading) {
     return (
       <div
         className="flex items-center justify-center h-full min-h-dvh"
         style={{ backgroundColor: '#0A0A0A' }}
       >
         <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
       </div>
     );
   }

   if (error) {
     return (
       <div
         className="flex items-center justify-center h-full min-h-dvh p-4"
         style={{ backgroundColor: '#0A0A0A' }}
       >
         <div className="text-center max-w-sm">
           <p style={{ color: '#EF4444', fontFamily: 'system-ui', fontSize: '14px' }}>
             {error}
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

   const activeWorkspace = workspaces[0]?.slug || '';

   return (
     <div
       className="h-full min-h-dvh p-4"
       style={{
         backgroundColor: '#0A0A0A',
         maxWidth: '390px',
         margin: '0 auto',
       }}
     >
      {/* Header: "Стол" */}
      <div className="flex flex-col items-center gap-1 mb-6">
        <div className="flex items-center justify-center gap-2">
          {/* Desk icon placeholder */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="6" width="16" height="2" rx="1" fill="#F59E0B" />
            <rect x="4" y="8" width="2" height="8" rx="0.5" fill="#F59E0B" />
            <rect x="14" y="8" width="2" height="8" rx="0.5" fill="#F59E0B" />
          </svg>
           <h1
             className="text-text-primary"
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '20px',
              lineHeight: '24px',
              fontWeight: '500',
              letterSpacing: '-0.025em',
              color: '#FAFAFA',
            }}
          >
            Стол
          </h1>
        </div>

        {/* Sub-header: board count + active */}
        <div className="flex items-center gap-1">
          <span
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '12px',
              lineHeight: '14px',
              fontWeight: '500',
              color: '#F59E0B',
            }}
          >
            {workspaces.length} досок • активная:
          </span>
          <span
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '12px',
              lineHeight: '14px',
              fontWeight: '500',
              color: '#F59E0B',
            }}
          >
            @{activeWorkspace}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col gap-5">
        {/* Risk Pulse Section */}
        <RiskPulse
          data={riskData}
          onSprintClick={() => router.push('/sprints')}
        />

        {/* Divider */}
        <div
          className="my-1"
          style={{ backgroundColor: '#8B8B8B', height: '1px' }}
          aria-hidden="true"
        />

        {/* "Мои доски" section header */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="bg-accent-amber shrink-0"
              style={{ width: '2px', height: '18px' }}
              aria-hidden="true"
            />
            <h2
              className="text-text-primary truncate"
              style={{
                fontFamily: "'Inter Display', system-ui, sans-serif",
                fontSize: '14px',
                lineHeight: '18px',
                fontWeight: '500',
                color: '#FAFAFA',
              }}
            >
              Мои доски
            </h2>
          </div>
        </div>

        {/* Board Cards List */}
        <div className="flex flex-col gap-3">
          {boardCards.map((card) => (
            <BoardCard
              key={card.id}
              data={card}
              onClick={() => router.push(`/board/${card.slug}`)}
              isActive={card.slug === activeWorkspace}
            />
          ))}
        </div>

        {/* "Добавить доску" button */}
        <button
          onClick={() => router.push('/boards/new')}
          className="flex items-center justify-center w-full h-10 rounded bg-surface border border-border-default hover:border-accent-amber/50 transition-colors mt-2"
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: '14px',
            lineHeight: '18px',
            fontWeight: '600',
            letterSpacing: '-0.0357em',
            color: '#FAFAFA',
          }}
          aria-label="Добавить доску"
        >
          Добавить доску
        </button>
      </div>

    </div>
  );
}