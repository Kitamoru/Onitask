'use server';

/**
 * PATCH /api/workers/:workerId/access — Update a worker's access preset and/or
 * custom role title (должность) on the board.
 *
 * Body: { preset?: 'admin' | 'member', role_title?: string | null }
 *   - preset     → workers.role (пресет доступов; 'owner' выдаётся/снимается
 *                  только напрямую в БД — вне скоупа этого роута)
 *   - role_title → workers.role_title (кастомная «Роль в доске», ≤ 50 символов)
 *
 * Permissions:
 *   - preset:      actor owner/admin; target не owner; target ≠ actor (self).
 *   - role_title:  чужая должность — owner/admin; свою — любой активный воркер.
 *                  Должность owner'а правит только сам owner.
 *
 * Смена пресета — только через service role (Master §4: RLS запрещает само-смену
 * role). Этот роут — единая точка проверки (по образцу revoke).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, extractInitData, getActiveWorkerInWorkspace } from '../../../../../../lib/api-auth';
import { createServerClient } from '../../../../../../lib/supabase';

const MAX_ROLE_TITLE = 50;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workerId: string }> },
) {
  try {
    // 1. Auth
    const auth = await authenticateRequest(await extractInitData(request));
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const { workerId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
    }

    const preset = body.preset as string | undefined;
    const hasRoleTitle = 'role_title' in body;
    const rawRoleTitle = body.role_title;

    // 2. Validate payload — хотя бы одно поле должно изменяться
    if (preset === undefined && !hasRoleTitle) {
      return NextResponse.json(
        { error: 'Нечего сохранять: передайте preset и/или role_title' },
        { status: 400 },
      );
    }

    if (preset !== undefined && preset !== 'admin' && preset !== 'member') {
      return NextResponse.json(
        { error: 'Пресет должен быть "admin" или "member"' },
        { status: 400 },
      );
    }

    let roleTitle: string | null | undefined;
    if (hasRoleTitle) {
      if (rawRoleTitle === null) {
        roleTitle = null; // явная очистка должности
      } else if (typeof rawRoleTitle === 'string') {
        const trimmed = rawRoleTitle.trim();
        if (trimmed.length === 0) {
          roleTitle = null; // пустая строка = очистка
        } else if (trimmed.length > MAX_ROLE_TITLE) {
          return NextResponse.json(
            { error: `Роль в доске: максимум ${MAX_ROLE_TITLE} символов` },
            { status: 400 },
          );
        } else {
          roleTitle = trimmed;
        }
      } else {
        return NextResponse.json({ error: 'Некорректный role_title' }, { status: 400 });
      }
    }

    const supabase = createServerClient();

    // 3. Fetch target worker
    const { data: targetWorker, error: fetchError } = await supabase
      .from('workers')
      .select('id, workspace_id, role, type, is_active')
      .eq('id', workerId)
      .maybeSingle();

    if (fetchError) {
      console.error('access: target fetch error', fetchError);
      return NextResponse.json({ error: 'database_error' }, { status: 500 });
    }

    if (!targetWorker) {
      return NextResponse.json({ error: 'Воркер не найден' }, { status: 404 });
    }

    const target = targetWorker as {
      id: string;
      workspace_id: string;
      role: string | null;
      type: string | null;
      is_active: boolean;
    };

    // 4. Target must be active and human (у агентов role = NULL, доступы не настраиваются)
    if (!target.is_active) {
      return NextResponse.json({ error: 'Воркер неактивен' }, { status: 400 });
    }
    if (target.type !== 'human') {
      return NextResponse.json(
        { error: 'Нельзя менять доступы у AI-агента' },
        { status: 400 },
      );
    }

    // 5. Resolve actor in the same workspace
    const actorWorker = await getActiveWorkerInWorkspace(auth.profileId!, target.workspace_id);
    if (!actorWorker) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }
    const isActorAdmin = actorWorker.role === 'owner' || actorWorker.role === 'admin';
    const isSelf = actorWorker.id === target.id;
    const isTargetOwner = target.role === 'owner';

    // 6. Permission checks
    if (preset !== undefined) {
      if (!isActorAdmin) {
        return NextResponse.json(
          { error: 'Только владелец или администратор доски может менять пресеты' },
          { status: 403 },
        );
      }
      if (isTargetOwner) {
        return NextResponse.json(
          { error: 'Нельзя менять пресет у владельца доски' },
          { status: 403 },
        );
      }
      if (isSelf) {
        return NextResponse.json(
          { error: 'Нельзя менять свой пресет доступов' },
          { status: 400 },
        );
      }
    }

    if (hasRoleTitle && !isSelf) {
      if (!isActorAdmin) {
        return NextResponse.json(
          { error: 'Чужую роль может менять только владелец или администратор доски' },
          { status: 403 },
        );
      }
      if (isTargetOwner) {
        return NextResponse.json(
          { error: 'Роль владельца доски может менять только он сам' },
          { status: 403 },
        );
      }
    }

    // 7. Update (only provided fields)
    const update: { role?: string; role_title?: string | null } = {};
    if (preset !== undefined) update.role = preset;
    if (hasRoleTitle) update.role_title = roleTitle ?? null;

    const { error: updateError } = await supabase
      .from('workers')
      .update(update)
      .eq('id', target.id);

    if (updateError) {
      console.error('access: update error', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 8. Broadcast for realtime
    try {
      await supabase
        .channel('flowboard-metrics')
        .send({
          type: 'broadcast',
          event: 'task_changed',
          payload: { workspace_id: target.workspace_id },
        });
    } catch {
      // Best-effort
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('access: unexpected error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
