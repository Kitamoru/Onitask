// POST /api/tasks/[id]/submit — SUBMIT-01: сдача задачи (шаг «Результат»).
// Атомарно: task_submissions (+ привязка файлов) + move в review/done — RPC
// submit_task (миг. 082, EXECUTE только у service_role). Триггеры history/
// version/notify отрабатывают в той же TX (паттерн 064). Auth — Telegram
// initData (паттерн PATCH-маршрута /api/tasks/[id]).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase';
import {
  authenticateRequest,
  extractInitData,
  isWorkspaceMember,
} from '../../../../../../lib/api-auth';
import { enrichTaskRow } from '../../../../../../lib/taskEnrichment';
import type { Database } from '../../../../../../types/supabase';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

const MAX_LINKS = 10;
const MAX_ATTACHMENTS = 5;

type SubmitBody = {
  target_column?: string;
  body_text?: string;
  links?: Array<{ label?: string; url?: string }>;
  attachment_ids?: string[];
  expected_version?: number;
  edited?: boolean;
};

/** Маппинг slugs-исключений RPC submit_task на HTTP-ответы (паттерн PATCH-маршрута). */
function mapRpcError(message: string): { status: number; error: string } {
  switch (message) {
    case 'task_not_found':
      return { status: 404, error: 'Задача не найдена' };
    case 'not_a_workspace_member':
      return { status: 403, error: 'Доступ запрещён' };
    case 'invalid_target_column':
      return { status: 400, error: 'Недопустимая целевая колонка' };
    case 'same_column':
      return { status: 400, error: 'Задача уже в этой колонке' };
    case 'version_conflict':
      return {
        status: 409,
        error:
          'Версия задачи изменилась (кто-то обновил её параллельно). Обновите данные и повторите.',
      };
    case 'review_approval_required':
      return {
        status: 403,
        error:
          'Требуется согласование задачи (кнопка «Согласовать» в Telegram-уведомлении).',
      };
    default:
      return { status: 500, error: message || 'Не удалось сдать задачу' };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth: единая точка извлечения initData (паттерн PATCH /api/tasks/[id]).
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }
    const profileId = auth.profileId!;
    const { id: taskId } = await params;
    const body = (await request.json()) as SubmitBody;

    const targetColumn = body.target_column;
    const bodyText = typeof body.body_text === 'string' ? body.body_text : '';
    const expectedVersion =
      typeof body.expected_version === 'number' ? body.expected_version : null;
    const edited = body.edited !== false;

    if (targetColumn !== 'review' && targetColumn !== 'done') {
      return NextResponse.json(
        { error: 'Недопустимая целевая колонка' },
        { status: 400 },
      );
    }

    // Ссылки: [{label, url}] — ExternalLinksCard-совместимый формат.
    const rawLinks = Array.isArray(body.links) ? body.links : [];
    if (rawLinks.length > MAX_LINKS) {
      return NextResponse.json(
        { error: `Максимум ${MAX_LINKS} ссылок` },
        { status: 400 },
      );
    }
    const links = rawLinks
      .map((l) => ({
        label: String(l?.label ?? '').slice(0, 120).trim(),
        url: String(l?.url ?? '').slice(0, 500).trim(),
      }))
      .filter((l) => l.url.length > 0);

    // Вложения: только существующие UUID этой задачи (RPC перепроверит task_id).
    const attachmentIds = (Array.isArray(body.attachment_ids) ? body.attachment_ids : [])
      .filter(
        (v): v is string =>
          typeof v === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      )
      .slice(0, MAX_ATTACHMENTS);

    const supabase = createServerClient();

    // Tenancy: задача существует + профиль — активный член её воркспейса
    // (resource-scoped, паттерн PATCH-маршрута).
    const { data: taskRow, error: taskFetchError } = await supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', taskId)
      .maybeSingle();
    if (taskFetchError) {
      return NextResponse.json({ error: taskFetchError.message }, { status: 500 });
    }
    if (!taskRow) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }
    if (!(await isWorkspaceMember(profileId, taskRow.workspace_id as string))) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 });
    }

    // Атомарная сдача (RPC, service-only). Триггеры той же TX:
    // history + version + task_review/task_done notify + human_override.
    const { data: rpcData, error: rpcError } = await supabase.rpc('submit_task', {
      p_task_id: taskId,
      p_profile_id: profileId,
      p_target_column: targetColumn,
      p_body_text: bodyText,
      p_links: links,
      p_attachment_ids: attachmentIds,
      p_expected_version: expectedVersion ?? undefined,
      p_edited: edited,
    });

    if (rpcError) {
      const mapped = mapRpcError(rpcError.message);
      return NextResponse.json(
        { error: mapped.error },
        { status: mapped.status },
      );
    }

    // Свежая строка задачи после move (version/moved_to_column_at обновлены
    // триггерами внутри RPC).
    const { data: updated, error: refetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (refetchError || !updated) {
      return NextResponse.json({ error: 'Не удалось прочитать задачу' }, { status: 500 });
    }

    // Broadcast task_changed для инвалидации кэша flow-метрик (паттерн PATCH).
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

    const rpc = (rpcData ?? {}) as { submission_id?: string; reused?: boolean };
    return NextResponse.json({
      task: await enrichTaskRow(updated as TasksRow),
      submission_id: rpc.submission_id ?? null,
      reused: rpc.reused ?? false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
