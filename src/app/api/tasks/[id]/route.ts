'use server';

/**
 * PATCH /api/tasks/[id] — Update a single task (last-write-wins).
 *
 * Implements last-write-wins semantics (per INV-09). When the client sends an
 * `expected_version`, the server compares it against the current DB version and
 * returns a `warning` on mismatch so the client can reconcile via force refresh.
 * Supports partial updates: column, assigned_to, reviewer_id, priority,
 * cognitive_weight, deadline, title, description, is_blocked, needs_human, tags.
 *
 * Also broadcasts a 'task_changed' event for flow metrics cache invalidation.
 *
 * Uses Telegram initData auth (server-side, service_role key) instead of Supabase Auth.
 *
 * Based on: dev_setup §7.2, §7.3, TASKS.md Stage 4 FLOW-01
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../lib/api-auth';
import { enrichTaskRow } from '../../../../../lib/taskEnrichment';
import type { Database } from '../../../../../types/supabase';
import {
  isAllowedStoryPoint,
  isValidCognitiveWeight,
  normalizeStoryPointsConfig,
} from '@/lib/storyPoints';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

// ─── PATCH /api/tasks/[id] — Update task ─────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth: единая точка извлечения initData из КЛОНА ДО чтения тела.
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const { id: taskId } = await params;
    const body = await request.json();

    // Build update object with only allowed fields
    const allowedFields = [
      'column', 'assigned_to', 'reviewer_id', 'priority',
      'cognitive_weight', 'deadline', 'title', 'description',
      'is_blocked', 'needs_human', 'tags', 'metadata',
      'handoff_to', 'handoff_notes', 'clarity_score', 'complexity',
      'enrichment_strategy', 'raw_input', 'source',
    ];

    const update: Partial<TasksRow> = {};
  for (const field of allowedFields) {
    // Only include fields that are defined and not null to avoid DB NOT NULL violations
    if (body[field] != null) { // catches undefined and null
      update[field as keyof TasksRow] = body[field];
    }
  }

    // Auto-set moved_to_column_at when column changes
    if ('column' in body && update.moved_to_column_at === undefined) {
      update.moved_to_column_at = new Date().toISOString();
    }

    // Fetch task + version, then verify membership in the task's own workspace
    // (resource-scoped tenancy — PATCH was previously missing any tenancy check).
    const supabase = createServerClient();
    const { data: taskRow, error: taskFetchError } = await supabase
      .from('tasks')
      .select('version, workspace_id, column, reviewer_id, metadata, created_by')
      .eq('id', taskId)
      .maybeSingle();

    if (taskFetchError) {
      return NextResponse.json({ error: taskFetchError.message }, { status: 500 });
    }

    if (!taskRow) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    if (!(await isWorkspaceMember(auth.profileId!, taskRow.workspace_id))) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    const { data: settingsRow } = await supabase
      .from('workspace_settings')
      .select('enable_cognitive_budget, story_points_config')
      .eq('workspace_id', taskRow.workspace_id)
      .maybeSingle();
    const evaluation = {
      cognitiveWeightEnabled: (settingsRow as any)?.enable_cognitive_budget !== false,
      storyPoints: normalizeStoryPointsConfig((settingsRow as any)?.story_points_config),
    };

    if (!evaluation.cognitiveWeightEnabled && body.cognitive_weight !== undefined) {
      return NextResponse.json({ error: 'Когнитивный вес отключён для этой доски' }, { status: 400 });
    }
    if (!evaluation.storyPoints.enabled && body.story_points !== undefined) {
      return NextResponse.json({ error: 'Story Points отключены для этой доски' }, { status: 400 });
    }

    if (evaluation.cognitiveWeightEnabled && body.cognitive_weight !== undefined && !isValidCognitiveWeight(body.cognitive_weight)) {
      return NextResponse.json({ error: 'Когнитивный вес должен быть от 0 до 3' }, { status: 400 });
    }
    if (evaluation.storyPoints.enabled && body.story_points !== undefined && !isAllowedStoryPoint(body.story_points, evaluation.storyPoints.values)) {
      return NextResponse.json({ error: 'Story point должен входить в настроенную шкалу доски' }, { status: 400 });
    }
    if (!evaluation.cognitiveWeightEnabled) delete update.cognitive_weight;
    const currentTask = taskRow;

    // Optimistic concurrency: if the client sent expected_version and it doesn't
    // match the current DB version, another client changed the task concurrently.
    // Apply last-write-wins (backward compatible) but surface a warning so the
    // client can reconcile its local state with a force refresh.
    const expectedVersion = (body as { expected_version?: number }).expected_version;
    const currentVersion = (currentTask as any)?.version ?? 0;
    let versionWarning: string | undefined;
    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      versionWarning = `Version mismatch: client expected ${expectedVersion}, server has ${currentVersion}. Applied last-write-wins; refresh to reconcile.`;
    }

    if (currentTask) {
      update.version = currentVersion + 1;
    } // Apply last-write-wins (backward compatible) — no early rejection.

    // Remove undefined values
    const cleanUpdate = Object.fromEntries(
      Object.entries(update).filter(([, v]) => v !== undefined),
    ) as Partial<TasksRow>;

    // Review approval workflow (миграция 049): human free-move bypass.
    // owner/admin workspace ИЛИ создатель задачи может перевести review→done
    // без Telegram-апрува — снимаем review_pending тем же UPDATE
    // (guard-триггер пропускает UPDATE без флага). Остальным — 403.
    if (
      cleanUpdate.column === 'done' &&
      taskRow.column === 'review' &&
      !taskRow.reviewer_id &&
      ((taskRow.metadata as Record<string, unknown> | null) ?? {})
        .review_pending === true
    ) {
      const { data: actorWorker } = await supabase
        .from('workers')
        .select('id, role')
        .eq('source_id', auth.profileId!)
        .eq('workspace_id', taskRow.workspace_id)
        .eq('type', 'human')
        .eq('is_active', true)
        .maybeSingle();

      const role = actorWorker?.role as string | null | undefined;
      const isOwnerAdmin = !!actorWorker && (role === 'owner' || role === 'admin');
      const isCreator =
        !!actorWorker &&
        !!taskRow.created_by &&
        taskRow.created_by === actorWorker.id;

      if (!isOwnerAdmin && !isCreator) {
        return NextResponse.json(
          {
            error:
              'Требуется согласование задачи (кнопка «Согласовать» в Telegram-уведомлении).',
          },
          { status: 403 },
        );
      }

      const meta = {
        ...((taskRow.metadata as Record<string, unknown>) || {}),
      };
      delete meta.review_pending;
      cleanUpdate.metadata = meta as TasksRow['metadata'];
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(cleanUpdate)
      .eq('id', taskId)
      .eq('workspace_id', taskRow.workspace_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (evaluation.storyPoints.enabled && body.story_points !== undefined) {
      const { error: enrichmentError } = await supabase
        .from('task_enrichments')
        .upsert({
          task_id: taskId,
          workspace_id: taskRow.workspace_id,
          story_points: body.story_points,
          sp_estimation_type: 'abstract',
          enrichment_status: 'done',
          model_used: 'manual',
          enriched_at: new Date().toISOString(),
        });
      if (enrichmentError) {
        return NextResponse.json({ error: enrichmentError.message }, { status: 500 });
      }
    }

    const responseTask = await enrichTaskRow(data as TasksRow);
    if (evaluation.storyPoints.enabled && body.story_points !== undefined) {
      responseTask.story_points = body.story_points;
    }

    // Broadcast task_changed event for flow metrics cache invalidation
    try {
      await supabase
        .channel('flowboard-metrics')
        .send({
          type: 'broadcast',
          event: 'task_changed',
          payload: { workspace_id: taskRow.workspace_id },
        });
    } catch {
      // Broadcast is best-effort
    }

    return NextResponse.json({
      task: responseTask,
      ...(versionWarning ? { warning: versionWarning } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/tasks/[id] — Delete task with cascade cleanup ────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth: единая точка извлечения initData из КЛОНА ДО чтения тела.
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const { id: taskId } = await params;
    console.log('[DELETE /api/tasks/:id] Task ID:', taskId);

    const supabase = createServerClient();

    // Verify the task exists and the profile is an active member of the task's
    // own workspace (resource-scoped tenancy). Replaces the fragile
    // `last_active_workspace_id === task.workspace_id` check, which returned 403
    // for valid members once they switched boards (multi-workspace users).
    const { data: taskData, error: taskFetchError } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .maybeSingle();

    if (taskFetchError) {
      return NextResponse.json({ error: taskFetchError.message }, { status: 500 });
    }

    if (!taskData) {
      console.warn('[DELETE /api/tasks/:id] Task not found:', taskId);
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    const taskWorkspaceId = (taskData as any).workspace_id;
    console.log('[DELETE /api/tasks/:id] Task workspace_id:', taskWorkspaceId);

    if (!(await isWorkspaceMember(auth.profileId!, taskWorkspaceId))) {
      console.error('[DELETE /api/tasks/:id] Access denied — not a member of task workspace:', taskWorkspaceId);
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    console.log('[DELETE /api/tasks/:id] Workspace check passed, proceeding with cascade delete');

    // Cascade delete related rows manually (tables without ON DELETE CASCADE)
    const anySupabase = supabase as any;

    // Clean up task_relations
    await anySupabase
      .from('task_relations')
      .delete()
      .or(`from_task_id.eq.${taskId},to_task_id.eq.${taskId}`);

    // Clean up task_column_history
    await anySupabase
      .from('task_column_history')
      .delete()
      .eq('task_id', taskId);

    // Clean up assignment_history
    await anySupabase
      .from('assignment_history')
      .delete()
      .eq('task_id', taskId);

    // Clean up bot_task_drafts
    await anySupabase
      .from('bot_task_drafts')
      .delete()
      .eq('task_id', taskId);

    // FILE-07: бинарники вложений из Storage (строки task_attachments каскадят
    // сами по ON DELETE CASCADE; объекты в bucket — нет, чистим явно ДО delete)
    try {
      const { data: attachRows } = await anySupabase
        .from('task_attachments')
        .select('storage_path')
        .eq('task_id', taskId);
      const paths = (attachRows ?? []).map(
        (r: { storage_path: string }) => r.storage_path
      );
      if (paths.length > 0) {
        await anySupabase.storage.from('task-attachments').remove(paths);
      }
    } catch (storageErr) {
      console.error('[DELETE /api/tasks/:id] attachment storage cleanup error:', storageErr);
    }

    // Finally, delete the task itself
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (deleteError) {
      console.error('tasks: delete error', deleteError);
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 },
      );
    }

    // Broadcast task_changed event for flow metrics cache invalidation
    try {
      await supabase
        .channel('flowboard-metrics')
        .send({
          type: 'broadcast',
          event: 'task_changed',
          payload: { workspace_id: taskWorkspaceId },
        });
    } catch {
      // Broadcast is best-effort
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
