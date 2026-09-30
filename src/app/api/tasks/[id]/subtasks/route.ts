'use server';

/**
 * GET/POST /api/tasks/[id]/subtasks — SUB-01: подзадачи задачи.
 *
 * GET  → список подзадач родителя (order by subtask_index).
 * POST → создать одну подзадачу: { title, assigned_to, deadline }.
 *
 * Правила (решения владельца 2026-09-30, ADR-2026-09-30 в decisions.md):
 *   · создавать подзадачи может автор родителя или owner/admin — то же
 *     getTaskPermission, что у PATCH /api/tasks/[id];
 *   · assigned_to — только активный человек (агент отклоняется, см. ADR);
 *   · reviewer_id = автор РОДИТЕЛЯ, и только если он человек. Именно явный
 *     reviewer_id закрывает обход «исполнитель увёл подзадачу из backlog прямо
 *     в Сделано»: при NULL гард review_state_check не срабатывает (он ловит
 *     только вход в review), а isReviewBypassBlocked требует ревьюера;
 *   · лимит 10 — проверяется до INSERT, чтобы отвечать 409, а не падать
 *     на CHECK в БД;
 *   · один уровень вложенности: подзадача для подзадачи — 400.
 *
 * Auth — Telegram initData (паттерн соседних маршрутов tasks/[id]).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveWorkerInWorkspace,
  getTaskWritePermission,
} from '../../../../../../lib/api-auth';
import { enrichTaskRowsBatch } from '../../../../../../lib/taskEnrichment';
import type { Database } from '../../../../../../types/supabase';
import {
  MAX_SUBTASKS,
  SUBTASK_FORBIDDEN_ASSIGNEE,
  SUBTASK_INITIAL_COLUMN,
  SUBTASK_LIMIT_REACHED,
  SUBTASK_TITLE_REQUIRED,
  canBeSubtaskAssignee,
  nextSubtaskIndex,
  normalizeSubtaskTitle,
  resolveSubtaskReviewerId,
  validateSubtaskParent,
} from '@/lib/subtasks';
import { getAuthorizedTask } from './auth';

type TasksRow = Database['public']['Tables']['tasks']['Row'];
type Params = { params: Promise<{ id: string }> };

type CreateSubtaskBody = {
  title?: unknown;
  /** Полный текст подзадачи (поле «Что нужно сделать»). */
  description?: unknown;
  assigned_to?: unknown;
  deadline?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id: taskId } = await params;
    const ctx = await getAuthorizedTask(request, taskId);
    if ('error' in ctx) return ctx.error;

    const { data, error } = await ctx.supabase
      .from('tasks')
      .select('*')
      .eq('parent_task_id', taskId)
      .order('subtask_index', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const subtasks = await enrichTaskRowsBatch((data ?? []) as TasksRow[]);
    return NextResponse.json({ success: true, subtasks });
  } catch (err) {
    console.error('[GET subtasks] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id: taskId } = await params;
    const ctx = await getAuthorizedTask(request, taskId);
    if ('error' in ctx) return ctx.error;

    const { supabase, task, profileId } = ctx;
    const body = (await request.json().catch(() => ({}))) as CreateSubtaskBody;

    // 1. Родитель — самостоятельная задача (один уровень вложенности).
    const parentProblem = validateSubtaskParent(task);
    if (parentProblem) {
      return NextResponse.json({ error: parentProblem }, { status: 400 });
    }

    // 2. Право создавать подзадачи = право редактировать родителя.
    const permission = await getTaskWritePermission(profileId, {
      workspace_id: task.workspace_id,
      created_by: task.created_by,
      assigned_to: task.assigned_to,
      column: task.column,
    });
    if (!permission?.canEdit) {
      return NextResponse.json(
        { error: 'Создавать подзадачи может автор задачи или администратор доски' },
        { status: 403 },
      );
    }

    // 3. Содержание.
    const title = normalizeSubtaskTitle(body.title);
    if (!title) {
      return NextResponse.json({ error: SUBTASK_TITLE_REQUIRED }, { status: 400 });
    }

    // 4. Исполнитель: только активный человек этой доски (v1).
    let assigneeId: string | null = null;
    if (body.assigned_to != null) {
      const raw = String(body.assigned_to);
      if (!UUID_RE.test(raw)) {
        return NextResponse.json(
          { error: 'Некорректный исполнитель' },
          { status: 400 },
        );
      }
      const { data: assignee } = await supabase
        .from('workers')
        .select('id, type, is_active, workspace_id')
        .eq('id', raw)
        .maybeSingle();

      // Чужой воркспейс отвечаем 404, как несуществующий UUID: иначе роут
      // подтверждал бы существование чужого работника.
      if (!assignee || assignee.workspace_id !== task.workspace_id) {
        return NextResponse.json(
          { error: 'Исполнитель не найден' },
          { status: 404 },
        );
      }
      if (!canBeSubtaskAssignee({
        id: assignee.id as string,
        type: assignee.type as 'human' | 'agent',
        is_active: assignee.is_active as boolean,
      })) {
        return NextResponse.json(
          { error: SUBTASK_FORBIDDEN_ASSIGNEE },
          { status: 400 },
        );
      }
      assigneeId = assignee.id as string;
    }

    // 5. Ревьюер — автор РОДИТЕЛЯ (решение владельца), и только если он
    //    человек: review_action требует type='human' (миг. 086), иначе approve
    //    был бы заблокирован навсегда.
    const { data: parentAuthor } = await supabase
      .from('workers')
      .select('id, type')
      .eq('id', task.created_by ?? '')
      .maybeSingle();
    const reviewerId = resolveSubtaskReviewerId({
      id: (parentAuthor?.id as string | null) ?? null,
      type: (parentAuthor?.type as 'human' | 'agent' | null) ?? null,
    });

    // 6. Лимит 10 — до INSERT, чтобы отвечать 409, а не падать на CHECK.
    const { data: siblings } = await supabase
      .from('tasks')
      .select('subtask_index')
      .eq('parent_task_id', taskId);
    const existingIndexes = (siblings ?? []).map(
      (row) => row.subtask_index as number | null,
    );
    if (existingIndexes.length >= MAX_SUBTASKS) {
      return NextResponse.json({ error: SUBTASK_LIMIT_REACHED }, { status: 409 });
    }
    // max+1, а не count+1: после удаления подзадачи позиции не должны
    // сдвинуться, иначе «третья стала второй» соврёт с тем, что видно в UI.
    const subtaskIndex = nextSubtaskIndex(existingIndexes);

    // 7. Срок: только валидная дата, невалидную не «угадываем».
    let deadline: string | null = null;
    if (typeof body.deadline === 'string' && body.deadline.trim()) {
      const parsed = new Date(body.deadline);
      deadline = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    const creator = await getActiveWorkerInWorkspace(profileId, task.workspace_id);

    // 8. INSERT. created_by = автор подзадачи (тот, кто её создал) — это
    //    отдельная роль от assigned_to; reviewer_id выше = автор РОДИТЕЛЯ.
    //    task_number проставит trg_assign_task_number (NULL для подзадачи),
    //    dup-очередь и enrichment отсеются гардами миграции 139.
    const { data: created, error: insertError } = await supabase
      .from('tasks')
      .insert({
        workspace_id: task.workspace_id,
        title,
        // Текст из «Что нужно сделать» храним и в description: шторка подзадачи
        // показывает его под заголовком «Подзадача», а title режется до 500.
        // Не передан description — отдаём title, чтобы старые вызовы работали.
        description:
          typeof body.description === 'string' && body.description.trim()
            ? body.description.trim()
            : title,
        column: SUBTASK_INITIAL_COLUMN,
        is_inbox: false,
        parent_task_id: taskId,
        subtask_index: subtaskIndex,
        assigned_to: assigneeId,
        reviewer_id: reviewerId,
        deadline,
        cognitive_weight: 1,
        source: 'manual', // проходит CHECK tasks_source_check
        created_by: creator?.id ?? null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[POST subtasks] insert error:', insertError);
      // 23505 — гонка по (parent_task_id, subtask_index).
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'Подзадача уже добавлена, попробуйте ещё раз' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const [enriched] = await enrichTaskRowsBatch([created as TasksRow]);
    return NextResponse.json({ success: true, subtask: enriched }, { status: 201 });
  } catch (err) {
    console.error('[POST subtasks] error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
