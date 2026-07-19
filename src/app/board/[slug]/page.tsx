'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getClient } from '@/lib/supabase/client';
import type { Database } from '../../../../types/supabase';
import { BoardDetail } from '@/components/board';
import type { ExternalLinkData, DocumentData } from '@/components/board';

type Worker = Database['public']['Tables']['workers']['Row'];
type Workspace = Database['public']['Tables']['workspaces']['Row'];
type Task = Database['public']['Tables']['tasks']['Row'];
type Sprint = Database['public']['Tables']['sprints']['Row'];
type Document = Database['public']['Tables']['workspace_documents']['Row'];

/**
 * Board Detail Page — displays the content of a single board/workspace.
 * 
 * Route: /board/[slug]
 * Matches Figma node: 1:836 (desk / [desk_UUID] / edit)
 * 
 * Data loading:
 *   1. Get current user session
 *   2. Find workspace by slug
 *   3. Load workers, tasks, sprints, documents for that workspace
 *   4. Transform into BoardDetail props
 */

export default function BoardDetailPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;
  const supabase = getClient();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Database['public']['Tables']['profiles']['Row'] | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        // Get current user session
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push('/');
          return;
        }

        // Get profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        setProfile(profile);

        // Get all worker workspace IDs
        const { data: workers } = await supabase
          .from('workers')
          .select('*')
          .eq('source_id', user.id)
          .eq('is_active', true);

        setWorkers(workers ?? []);

        const workspaceIds = (workers ?? []).map((w) => w.workspace_id);

        if (workspaceIds.length === 0) {
          setLoading(false);
          return;
        }

        // Get workspace by slug
        const { data: workspace } = await supabase
          .from('workspaces')
          .select('*')
          .in('id', workspaceIds)
          .eq('slug', slug)
          .maybeSingle();

        if (!workspace) {
          // Redirect to boards overview if not found
          router.push('/boards');
          return;
        }

        setWorkspace(workspace);

        // Filter workers for this workspace
        const wsWorkers = (workers ?? []).filter((w) => w.workspace_id === workspace.id);

        // Get tasks for this workspace
        const { data: tasks } = await supabase
          .from('tasks')
          .select('*')
          .eq('workspace_id', workspace.id);

        setTasks(tasks ?? []);

        // Get sprints for this workspace
        const { data: sprints } = await supabase
          .from('sprints')
          .select('*')
          .eq('workspace_id', workspace.id)
          .eq('status', 'active')
          .order('start_date', { ascending: false })
          .limit(1);

        setSprints(sprints ?? []);

        // Get documents for this workspace
        const { data: docs } = await supabase
          .from('workspace_documents')
          .select('*')
          .eq('workspace_id', workspace.id)
          .eq('status', 'ready')
          .order('created_at', { ascending: false });

        setDocuments(docs ?? []);
      } catch (error) {
        console.error('Board detail page load error:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router, slug]);

  // Transform data for BoardDetail component
  const activeSprint = sprints[0];
  const sprintInfo = activeSprint
    ? {
        id: activeSprint.id,
        name: activeSprint.name ?? `Спринт`,
        topic: '',
        startDate: new Date(activeSprint.start_date).toLocaleDateString('ru-RU'),
        endDate: new Date(activeSprint.end_date).toLocaleDateString('ru-RU'),
        daysElapsed: 0,
        totalDays: Math.max(
          1,
          Math.ceil(
            (new Date(activeSprint.end_date).getTime() - new Date(activeSprint.start_date).getTime()) / (1000 * 60 * 60 * 24)
          )
        ),
      }
    : undefined;

  const sprintTasks = (tasks ?? [])
    .filter((t) => t.sprint_id === activeSprint?.id)
    .map((t) => ({
      id: t.id,
      title: t.title,
      column: t.column,
    }));

  const colleagues = (workers ?? [])
    .filter((w) => w.workspace_id === workspace?.id && w.type === 'human' && w.is_active)
    .map((w) => {
      const workerTasks = (tasks ?? []).filter(
        (t) => t.assigned_to === w.id && t.column !== 'done'
      );
      const overloaded = workerTasks.length > 5;

      return {
        id: w.id,
        displayName: w.display_name,
        avatarUrl: undefined, // Would need profiles.avatar_url
        cognitiveWeight: 2, // Default; would need attention_risk_score view
        spPerDay: 3.5, // Default; would need velocity calculation
        trendUp: true,
        roleLabel: getRoleLabel(w.role ?? undefined),
        activeTasks: workerTasks.length,
        overloaded,
        tasks: workerTasks.map((t) => `📌 ${t.title}`),
      };
    });

  const externalLinks: ExternalLinkData[] = []; // Would come from workspace_links table

  const documentList = (documents ?? []).map((d) => ({
    id: d.id,
    filename: d.filename,
    fileType: d.file_type as 'markdown' | 'text',
  }));

  return (
    <BoardDetail
      boardName={workspace?.name || ''}
      slug={slug}
      sprint={sprintInfo}
      sprintTasks={sprintTasks}
      colleagues={colleagues}
      externalLinks={externalLinks}
      documents={documentList}
      deadlineWarningDays={1}
      loading={loading}
    />
  );
}

function getRoleLabel(role?: string): string {
  switch (role) {
    case 'owner':
      return '👑 Владелец';
    case 'admin':
      return '🛡️ Администратор';
    case 'member':
      return '👤 Участник';
    case 'viewer':
      return '👁️ Наблюдатель';
    default:
      return '👤 Участник';
  }
}