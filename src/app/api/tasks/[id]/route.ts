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
  getActiveWorkerInWorkspace,
  getTaskWritePermission,
} from '../../../../../lib/api-auth';
import { TASK_FORBIDDEN_EDIT, TASK_FORBIDDEN_DELETE } from '@/lib/taskPermissions';
import {
  subtaskOwnerRow,
  canBeSubtaskAssignee,
  SUBTASK_FORBIDDEN_ASSIGNEE,
} from '@/lib/subtasks';
import { isReviewBypassBlocked, REVIEW_BYPASS_BLOCKED } from '@/lib/reviewDecision';
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

    // SUB-01: `null` — это «поле снять», а `undefined` — «поле не передано».
    // Различать обязательно: в UI есть «Без исполнителя» и снятый срок, но PATCH
    // отбрасывал оба, и UI отчитывался об успехе, ничего не записав.
    //
    // Список построен по фактической nullability `tasks.Row`
    // (types/supabase.ts:2210), а не на глаз: колонки из RIGHT писать в null
    // нельзя, PATCH уронил бы их NOT NULL-ошибкой на каждом таком запросе.
    // `description` сюда НЕ входит намеренно — снятие описания владелец решил
    // оставить как есть (2026-10-01), даже при явном `null` от клиента.
    const NULLABLE_PATCH_FIELDS = new Set([
      'assigned_to', 'deadline', 'reviewer_id', 'handoff_to', 'handoff_notes',
      'clarity_score', 'complexity', 'enrichment_strategy', 'raw_input', 'source',
    ]);

    const update: Partial<TasksRow> = {};
  for (const field of allowedFields) {
    const value = body[field];
    // Не передан — поле не трогаем.
    if (value === undefined) continue;
    // Явный null в NOT NULL-колонке — отбрасываем (прежнее поведение).
    if (value === null && !NULLABLE_PATCH_FIELDS.has(field)) continue;
    update[field as keyof TasksRow] = value;
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
      .select('version, workspace_id, column, reviewer_id, metadata, created_by, assigned_to, parent_task_id')
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

    // SUB-01: права на ПОДЗАДАЧУ считаются по её РОДИТЕЛЮ (created_by/assigned_to
    // родителя), а колонка остаётся собственной — от неё зависит self-claim,
    // и «взять подзадачу в работу» должно решаться по подзадаче, не по родителю.
    //
    // Без этого автор задачи не мог бы отредактировать подзадачу, добавленную
    // админом, хотя UI (SubtaskViewSheet по правам на родителе) предлагал кнопки.
    const patchOwner = (await subtaskOwnerRow(
      taskRow as unknown as Parameters<typeof subtaskOwnerRow>[0],
      await loadSubtaskParent(supabase, (taskRow as any).parent_task_id as string | null),
    )) ?? (taskRow as any);

    // TASK-PERM: перемещение (column) и редактирование полей — это ОДИН и тот же
    // PATCH, поэтому единая проверка canEdit закрывает оба случая.
    // Правило: owner/admin — всё; автор (created_by) — правит; исполнитель
    // (assigned_to) — правит; остальные участники доски — нет.
    // Исключение — self-claim: участник может взять задачу из backlog без
    // исполнителя себе (тогда меняется только assigned_to → его worker.id).
    const permission = await getTaskWritePermission(auth.profileId!, {
      workspace_id: taskRow.workspace_id as string,
      created_by: (patchOwner.created_by as string | null) ?? null,
      assigned_to: (patchOwner.assigned_to as string | null) ?? null,
      column: taskRow.column as string,
    });

    if (!permission) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    const actor = await getActiveWorkerInWorkspace(auth.profileId!, taskRow.workspace_id as string);
    const isSelfClaim =
      permission.canClaim &&
      actor != null &&
      body.assigned_to === actor.id &&
      Object.keys(update).every((k) => k === 'assigned_to' || k === 'moved_to_column_at');

    if (!permission.canEdit && !isSelfClaim) {
      return NextResponse.json(
        { error: TASK_FORBIDDEN_EDIT },
        { status: 403 },
      );
    }

    // SUB-01: подзадаче нельзя назначить AI-агента (v1, ADR-2026-09-30).
    // Проверка именно здесь, а не только в POST /subtasks: PATCH — общий путь
    // назначения, и без него `assigned_to: <agent>` проходил бы мимо правила.
    // Побочный эффект, ради которого гард обязателен: trg_dispatch_outbox_on_assign
    // кладёт задачу в dispatch_outbox при назначении агенту, и агент получил бы
    // подзадачу в работу в обход фильтра `.is('parent_task_id', null)` в MCP.
    if (
      'assigned_to' in update &&
      (taskRow as any).parent_task_id != null &&
      update.assigned_to != null
    ) {
      const { data: assignee } = await supabase
        .from('workers')
        .select('id, type, is_active, workspace_id')
        .eq('id', update.assigned_to as string)
        .maybeSingle();

      const assigneeOk =
        assignee &&
        assignee.workspace_id === taskRow.workspace_id &&
        canBeSubtaskAssignee({
          id: assignee.id as string,
          type: assignee.type as 'human' | 'agent',
          is_active: assignee.is_active as boolean,
        });

      if (!assigneeOk) {
        return NextResponse.json(
          { error: SUBTASK_FORBIDDEN_ASSIGNEE },
          { status: 400 },
        );
      }
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
      // actor уже получен выше (worker текущего пользователя в workspace задачи).
      const role = actor?.role as string | null | undefined;
      const isOwnerAdmin = !!actor && (role === 'owner' || role === 'admin');
      const isCreator = !!actor && !!taskRow.created_by && taskRow.created_by === actor.id;

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

    // REV-02: назначенный ревьюер — согласование обязательно, мимо него не
    // ходим. Существующий гвард выше покрывает только случай «ревьюер НЕ
    // назначен»; этот закрывает обратный, иначе исполнитель (который проходит
    // canEdit) перетаскивал бы задачу с ревьюером прямо в «Сделано», минуя
    // согласование. Пропускаем самого ревьюера и owner/admin — форс-мейдж.
    if (
      cleanUpdate.column === 'done' &&
      taskRow.column !== 'done' &&
      isReviewBypassBlocked(
        { reviewer_id: taskRow.reviewer_id as string | null },
        { workerId: actor?.id, role: actor?.role as string | null | undefined },
      )
    ) {
      return NextResponse.json({ error: REVIEW_BYPASS_BLOCKED }, { status: 403 });
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
      // onConflict: task_id обязателен. PK таблицы — `id`, которого в payload
      // нет, поэтому без явного target PostgREST делает INSERT и падает на
      // UNIQUE(task_id). Раньше ручная правка Story Points завершалась 500,
      // если у задачи уже была строка обогащения (то есть почти всегда).
      const { error: enrichmentError } = await supabase
        .from('task_enrichments')
        .upsert(
          {
            task_id: taskId,
            workspace_id: taskRow.workspace_id,
            story_points: body.story_points,
            sp_estimation_type: 'abstract',
            enrichment_status: 'done',
            model_used: 'manual',
            enriched_at: new Date().toISOString(),
          },
          { onConflict: 'task_id' },
        );
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

/**
 * SUB-01: родитель подзадачи (или null, если это самостоятельная задача).
 *
 * Отдельный запрос вместо JOIN: задача уже прочитана, а `maybeSingle` на
 * отсутствующем родителе корректно даёт null — на этом строится запасной путь
 * в `subtaskOwnerRow` (гонка с ON DELETE CASCADE).
 */
async function loadSubtaskParent(
  supabase: ReturnType<typeof createServerClient>,
  parentTaskId: string | null,
): Promise<{ created_by: string | null; assigned_to: string | null; column: string } | null> {
  if (!parentTaskId) return null;
  const { data } = await supabase
    .from('tasks')
    .select('created_by, assigned_to, column')
    .eq('id', parentTaskId)
    .maybeSingle();
  return (data as { created_by: string | null; assigned_to: string | null; column: string } | null) ?? null;
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
      .select('workspace_id, created_by, assigned_to, column, parent_task_id')
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

    // SUB-01: права на подзадачу считаются по РОДИТЕЛЮ, а не по её собственному
    // created_by. Иначе автор задачи не смог бы удалить подзадачу, добавленную
    // админом, а UI (кнопка по правам на родителе) обещал бы действие, которое
    // сервер отверг бы 403. Подзадача — часть задачи, значит и права на неё
    // принадлежат задаче.
    const ownerRow = (await subtaskOwnerRow(
      taskData as unknown as Parameters<typeof subtaskOwnerRow>[0],
      await loadSubtaskParent(supabase, (taskData as any).parent_task_id as string | null),
    )) ?? (taskData as any);

    // TASK-PERM: удалять задачу может её автор или администратор доски.
    // Исполнитель (assigned_to) правит и двигает, но не удаляет.
    const permission = await getTaskWritePermission(auth.profileId!, {
      workspace_id: taskWorkspaceId as string,
      created_by: ownerRow.created_by ?? null,
      assigned_to: ownerRow.assigned_to ?? null,
      column: ownerRow.column ?? '',
    });

    if (!permission) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    if (!permission.canDelete) {
      console.error('[DELETE /api/tasks/:id] Access denied — not creator nor admin');
      return NextResponse.json({ error: TASK_FORBIDDEN_DELETE }, { status: 403 });
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

    // bot_task_drafts здесь НЕ чистим: колонки task_id у таблицы нет
    // (миграция 030: id, user_id, chat_id, title, description, source,
    // created_at, expires_at), и черновик не связан с задачей — он живёт
    // по chat_id 10 минут и удаляется по TTL (purge_expired_bot_task_drafts).
    // Прежний код звал delete().eq('task_id', taskId) и падал с 42703
    // undefined_column на каждом DELETE /api/tasks/:id.

    // FILE-07: бинарники вложений из Storage (строки task_attachments каскадят
    // сами по ON DELETE CASCADE; объекты в bucket — нет, чистим явно ДО delete).
    //
    // SUB-01: parent_task_id — ON DELETE CASCADE, поэтому удаление родителя
    // уносит и подзадачи, и их строки task_attachments. Но бинарники в бакете
    // останутся сиротами до ночного gc_orphan_task_attachments (миг. 081), то
    // есть на сутки. Собираем пути по подзадачам ЗДЕСЬ, в той же транзакции
    // удаления, — иначе ссылка на объект исчезла бы вместе со строкой.
    try {
      const { data: subtaskRows } = await anySupabase
        .from('tasks')
        .select('id')
        .eq('parent_task_id', taskId);
      const subtaskIds = (subtaskRows ?? []).map((r: { id: string }) => r.id);

      const { data: attachRows } = await anySupabase
        .from('task_attachments')
        .select('storage_path')
        .eq('task_id', taskId);
      const paths = (attachRows ?? []).map(
        (r: { storage_path: string }) => r.storage_path,
      );

      if (subtaskIds.length > 0) {
        const { data: subAttachRows } = await anySupabase
          .from('task_attachments')
          .select('storage_path')
          .in('task_id', subtaskIds);
        for (const r of (subAttachRows ?? []) as Array<{ storage_path: string }>) {
          if (r.storage_path) paths.push(r.storage_path);
        }
      }

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
