'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Check if Supabase env vars are available
const hasSupabaseEnv = 
  typeof process !== 'undefined' && 
  process.env.NEXT_PUBLIC_SUPABASE_URL && 
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase: any = null;
if (hasSupabaseEnv) {
  supabase = require('../../lib/supabase').createBrowserClient();
}

import { RiskPulse, BoardCard } from '@/components/board';
import type { RiskPulseData, BoardCardData } from '@/components/board';

/**
 * Mock data for preview when Supabase is not configured.
 * Matches the Figma design structure.
 */
const MOCK_RISK_DATA: RiskPulseData = {
  people: 2,
  processes: 1,
  escalations: 28,
};

const MOCK_BOARD_CARDS: BoardCardData[] = [
  {
    id: 'mock-1',
    name: 'Благополучная доска',
    slug: 'blag',
    memberCount: 4,
    agentCount: 2,
    stats: { inWork: 7, escalations: 2, overloaded: 1, done: 12 },
    sprint: { name: 'Спринт 3', topic: 'Auth & MCP', daysElapsed: 6, totalDays: 14 },
  },
  {
    id: 'mock-2',
    name: 'Доска задач',
    slug: 'tasks',
    memberCount: 3,
    agentCount: 1,
    stats: { inWork: 5, escalations: 0, overloaded: 0, done: 8 },
    sprint: { name: 'Спринт 2', topic: 'UI Polish', daysElapsed: 3, totalDays: 14 },
  },
  {
    id: 'mock-3',
    name: 'Backend API',
    slug: 'backend',
    memberCount: 2,
    agentCount: 3,
    stats: { inWork: 10, escalations: 5, overloaded: 3, done: 20 },
    sprint: undefined,
  },
];

/**
 * Boards Overview Page — "Стол" (Desk)
 * 
 * Figma spec (node 307:28401 "stol"):
 *   - Component: stol, designedWidth=390px
 *   - Layout: mode=column, overflowScroll=y, padding=16px, gap=24px
 *   - Background: #0A0A0A
 *   - Header section: gap=4px
 *   - Header title: Inter Display Medium 20px/24px, letterSpacing=-0.025em, #FFFFFF
 *   - Sub-header: mode=row, gap=4px
 *   - Sub-header text: style_c414909c, #8B8B8B, 12px/14px Medium
 *   - Active board: fill_041c34f7, #F59E0B
 *   - center-container: gap=20px
 *   - "Мои доски" header: amber line 2x18px, Inter Display Medium 14px/18px, #FAFAFA
 *   - Board cards list: gap=12px between cards
 *   - "Добавить доску" button: height=40px, padding=0 16px
 *   - Bottom filler: height=80px, bg=#0A0A0A
 */

export default function BoardsPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [riskData, setRiskData] = useState<RiskPulseData>(MOCK_RISK_DATA);
  const [boardCards, setBoardCards] = useState<BoardCardData[]>(MOCK_BOARD_CARDS);

  useEffect(() => {
    async function loadData() {
      try {
        if (!hasSupabaseEnv || !supabase) {
          // Use mock data for preview
          setWorkspaces(MOCK_BOARD_CARDS.map(c => ({ id: c.id, name: c.name, slug: c.slug })));
          setRiskData(MOCK_RISK_DATA);
          setBoardCards(MOCK_BOARD_CARDS);
          setLoading(false);
          return;
        }

        // Get current user session
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          router.push('/');
          return;
        }

        // Get all workers for this user
        const { data: workers } = await supabase
          .from('workers')
          .select('*')
          .eq('source_id', user.id)
          .eq('is_active', true);

        const workspaceIds = (workers ?? []).map((w: any) => w.workspace_id);

        if (workspaceIds.length === 0) {
          setLoading(false);
          return;
        }

        // Get all workspaces
        const { data: workspaces } = await supabase
          .from('workspaces')
          .select('*')
          .in('id', workspaceIds);

        setWorkspaces(workspaces ?? []);

        // Fetch tasks for risk pulse aggregation
        const { data: tasks } = await supabase
          .from('tasks')
          .select('column, escalation_reason, assigned_to, workspace_id')
          .in('workspace_id', workspaceIds);

        // Aggregate risk data
        const peopleSet = new Set<string>();
        let processCount = 0;
        let escalationCount = 0;

        (tasks ?? []).forEach((task: any) => {
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
        const cards: BoardCardData[] = (workspaces ?? []).map((ws: any) => {
          const wsTasks = (tasks ?? []).filter((t: any) => t.workspace_id === ws.id);
          
          return {
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
            memberCount: (workers ?? [])
              .filter((w: any) => w.workspace_id === ws.id && w.type === 'human')
              .length,
            agentCount: (workers ?? [])
              .filter((w: any) => w.workspace_id === ws.id && w.type === 'agent')
              .length,
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
      } catch (error) {
        console.error('Boards page load error:', error);
        // Fallback to mock data on error
        setWorkspaces(MOCK_BOARD_CARDS.map(c => ({ id: c.id, name: c.name, slug: c.slug })));
        setRiskData(MOCK_RISK_DATA);
        setBoardCards(MOCK_BOARD_CARDS);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
      </div>
    );
  }

  const activeWorkspace = workspaces[0]?.slug || '';

  return (
    <div
      className="flex flex-col"
      style={{
        minHeight: '100vh',
        overflowY: 'auto' as const,
        padding: '16px',
        gap: '24px',
        maxWidth: '390px',
        margin: '0 auto',
        backgroundColor: '#0A0A0A',
        boxSizing: 'border-box' as const,
      }}
    >
      {/* Header section: "Стол" */}
      <div
        className="flex flex-col"
        style={{
          alignSelf: 'stretch',
          justifyContent: 'center',
          gap: '4px',
        }}
      >
        {/* Title row with desk icon */}
        <div
          className="flex items-center justify-center"
          style={{
            gap: '8px',
          }}
        >
          {/* Desk icon SVG */}
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
          {/* Title text */}
          <h1
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '20px',
              lineHeight: '24px',
              fontWeight: '500',
              letterSpacing: '-0.025em',
              textAlign: 'left' as const,
              color: '#FAFAFA',
            }}
          >
            Стол
          </h1>
        </div>

        {/* Sub-header: board count + active */}
        <div
          className="flex items-center"
          style={{
            alignSelf: 'stretch',
            gap: '4px',
          }}
        >
          <span
            style={{
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '12px',
              lineHeight: '14px',
              fontWeight: '500',
              color: '#8B8B8B',
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

      {/* Center container: RiskPulse + Board List */}
      <div
        className="flex flex-col"
        style={{
          alignSelf: 'stretch',
          gap: '20px',
        }}
      >
        {/* Risk Pulse Section */}
        <RiskPulse
          data={riskData}
        />

        {/* "Мои доски" section */}
        <div
          className="flex flex-col"
          style={{
            alignSelf: 'stretch',
            alignItems: 'stretch',
            gap: '12px',
          }}
        >
          {/* Section header with amber line */}
          <div
            className="flex items-center justify-between w-full"
          >
            <div
              className="flex items-center"
              style={{
                gap: '8px',
              }}
            >
              {/* Amber accent line */}
              <div
                style={{
                  width: '2px',
                  height: '18px',
                  backgroundColor: '#F59E0B',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              {/* Section title */}
              <p
                style={{
                  fontFamily: "'Inter Display', system-ui, sans-serif",
                  fontSize: '14px',
                  lineHeight: '18px',
                  fontWeight: '500',
                  textAlign: 'left' as const,
                  color: '#FAFAFA',
                }}
              >
                Мои доски
              </p>
            </div>
          </div>

          {/* Board Cards List */}
          <div
            className="flex flex-col"
            style={{
              gap: '12px',
            }}
          >
            {boardCards.map((card) => (
              <BoardCard
                key={card.id}
                data={card}
                onClick={() => router.push(`/board/${card.slug}`)}
                isActive={card.slug === activeWorkspace}
              />
            ))}
          </div>
        </div>

        {/* "Добавить доску" button */}
        <button
          onClick={() => router.push('/board/create')}
          className="flex items-center justify-center w-full"
          style={{
            height: '40px',
            padding: '0px 16px',
            backgroundColor: '#0A0A0A',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: '14px',
            lineHeight: '18px',
            fontWeight: '600',
            letterSpacing: '-0.0357em',
            textAlign: 'center' as const,
            color: '#FAFAFA',
            border: '1px solid #8B8B8B',
            cursor: 'pointer',
          }}
          aria-label="Добавить доску"
        >
          Добавить доску
        </button>
      </div>

      {/* Bottom spacer for fixed menu — replaced by global body padding */}
    </div>
  );
}