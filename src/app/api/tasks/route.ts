'use server';

/**
 * Flow Board API — Tasks endpoint.
 *
 * Implements last-write-wins semantics without version check (per INV-09 note).
 * Supports GET (list) and POST (create) at /api/tasks.
 * PATCH is handled by /api/tasks/[id]/route.ts.
 *
 * Uses Telegram initData auth (server-side, service_role key) instead of Supabase Auth.
 *
 * Based on: dev_setup §7.2, §7.3, TASKS.md Stage 4 FLOW-01
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
  getDefaultWorkspaceId,
  isWorkspaceMember,
} from '../../../../lib/api-auth';
import { enrichTaskRow, enrichTaskRowsBatch } from '../../../../lib/taskEnrichment';
import type { Database } from '../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

// ─── GET /api/tasks — List tasks ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const supabase = createServerClient();

    // Parse query params
    const url = new URL(request.url);
    const requestedWorkspaceId = url.searchParams.get('workspace_id');
    const column = url.searchParams.get('column');
    const assignedTo = url.searchParams.get('assigned_to');
    const includeInbox = url.searchParams.get('include_inbox') === 'true';

    // Workspace: explicit ?workspace_id= (verified) → default membership.
    // Avoids the non-deterministic `.limit(1)` worker when a user has several workspaces.
    let workspaceId: string | null = null;
    if (requestedWorkspaceId) {
      if (!(await isWorkspaceMember(auth.profileId!, requestedWorkspaceId))) {
        return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
      }
      workspaceId = requestedWorkspaceId;
    } else {
      workspaceId = await getDefaultWorkspaceId(auth.profileId!);
    }

    if (!workspaceId) {
      return NextResponse.json({ tasks: [], count: 0 });
    }

    let query = supabase
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });

    if (column) {
      query = query.eq('column', column);
    }

    if (assignedTo) {
      query = query.eq('assigned_to', assignedTo);
    }

    if (!includeInbox) {
      query = query.eq('is_inbox', false);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Batch enrichment (N+1 fix): workspace + worker lookups в 2 групповых запроса
    // вместо 2×N одиночных. Маппинг полей идентичен enrichTaskRow.
    const enriched = await enrichTaskRowsBatch((data ?? []) as TasksRow[]);

    return NextResponse.json({
      tasks: enriched,
      count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── POST /api/tasks — Create task ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth: единая точка извлечения initData из клона ДО чтения тела.
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const body = await request.json();
    const {
      title,
      description,
      column,
      priority,
      cognitive_weight,
      deadline,
      is_blocked,
      needs_human,
      tags,
      source,
      metadata,
      workspace_id: requestedWorkspaceId,
    } = body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Поле "title" обязательно и должно быть строкой' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Workspace: explicit from body (verified membership) → default membership.
    // Avoids the non-deterministic `.limit(1)` worker when a user has several workspaces.
    let workspaceId: string | undefined = requestedWorkspaceId as string | undefined;
    if (workspaceId) {
      if (!(await isWorkspaceMember(auth.profileId!, workspaceId))) {
        return NextResponse.json(
          { error: 'Доступ запрещён: вы не являетесь участником этого workspace' },
          { status: 403 },
        );
      }
    } else {
      workspaceId = (await getDefaultWorkspaceId(auth.profileId!)) ?? undefined;
    }

    if (!workspaceId) {
      return NextResponse.json({ error: 'У вас нет активных workspace' }, { status: 403 });
    }

    // created_by — active worker row inside the target workspace (resource-scoped).
    const worker = await getActiveWorkerInWorkspace(auth.profileId!, workspaceId);
    if (!worker) {
      return NextResponse.json(
        { error: 'Доступ запрещён: вы не являетесь участником этого workspace' },
        { status: 403 },
      );
    }

    // Build insert payload with only known columns
    // Note: created_by is temporarily cast until types are regenerated after migration 023
    const insertPayload = {
      workspace_id: workspaceId,
      title: title.trim(),
      description: description ?? null,
      column: column ?? 'backlog',
      priority: priority ?? 'medium',
      cognitive_weight: cognitive_weight ?? 1,
      deadline: deadline ?? null,
      is_blocked: is_blocked ?? false,
      needs_human: needs_human ?? false,
      is_inbox: !column, // auto-set inbox if no explicit column
      tags: tags ?? [],
      source: source ?? 'manual',
      // metadata (external_links / checklist / related_tasks) — только валидный объект
      metadata:
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : null,
      created_by: worker.id,
    } as Database['public']['Tables']['tasks']['Insert'] & { created_by: string };

    const { data, error } = await supabase
      .from('tasks')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ task: await enrichTaskRow(data as TasksRow) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}