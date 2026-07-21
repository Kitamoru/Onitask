'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Database } from '../../../types/supabase';
import { RiskPulse, BoardCard } from '@/components/board';
import type { RiskPulseData, BoardCardData } from '@/components/board';

type Worker = Database['public']['Tables']['workers']['Row'];
type Workspace = Database['public']['Tables']['workspaces']['Row'];
type Task = Database['public']['Tables']['tasks']['Row'];

/**
 * Boards Overview Page — "Стол" (Desk)
 * 
 * Figma spec (node 307:28401 "stol"):
 *   - Header: "Стол" with desk icon
 *   - Sub-header: board count + active board
 *   - RiskPulse section: aggregated metrics across all boards
 *   - Board list: cards with stats and sprint info
 */

export default function BoardsPage() {
  const router = useRouter();
  const supabase = getClient();
  const { isLoading: authLoading, error: authError, data: authData } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
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
        // Get all workers for this user from auth data
        const workerId = authData.worker.id;
        const { data: workers } = await supabase
          .from('workers')
          .select('*')
          .eq('source_id', workerId)
          .eq('is_active', true);

        setWorkers(workers ?? []);

        const workspaceIds = ((workers ?? []) as Worker[]).map((w: Worker) => w.workspace_id);

        if (workspaceIds.length === 0) {
          setLoading(false);
          return;
        }

        // Get all workspaces
        const { data: wsData } = await supabase
          .from('workspaces')
          .select('*')
          .in('id', workspaceIds);

        const wsList = wsData as Workspace[] | null;
        setWorkspaces(wsList ?? []);

        // Fetch tasks for risk pulse aggregation
        const { data: tasks } = await supabase
          .from('tasks')
          .select('column, escalation_reason, assigned_to, workspace_id')
          .in('workspace_id', workspaceIds);

        const tasksList = (tasks ?? []) as Task[];

        // Aggregate risk data
        const peopleSet = new Set<string>();
        let processCount = 0;
        let escalationCount = 0;

        tasksList.forEach((task: Task) => {
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
        const cards: BoardCardData[] = (wsList ?? []).map((ws: Workspace) => {
          const wsTasks = tasksList.filter((t: Task) => t.workspace_id === ws.id);
          
          return {
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
            memberCount: (workers ?? []).filter((w: Worker) => w.workspace_id === ws.id && w.type === 'human').length,
            agentCount: (workers ?? []).filter((w: Worker) => w.workspace_id === ws.id && w.type === 'agent').length,
            stats: {
              inWork: wsTasks.filter((t: Task) => t.column === 'in_progress').length,
              escalations: wsTasks.filter((t: Task) => t.escalation_reason !== null).length,
              overloaded: 0, // Would need attention_risk_score view data
              done: wsTasks.filter((t: Task) => t.column === 'done').length,
            },
            // Sprint info would come from sprints table
            sprint: undefined,
          };
        });

        setBoardCards(cards);
      } catch (error) {
        console.error('Boards page load error:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [authData, supabase]);

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
          onClick={() => router.push('/board/create')}
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
