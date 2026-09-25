/**
 * TASK-PERM: модель прав на запись в задачу (чистая функция).
 *
 * Покрывает согласованное правило: owner/admin — всё; автор — правит и удаляет;
 * исполнитель — правит, но не удаляет; остальные участники ничего; плюс
 * self-claim задачи из backlog без исполнителя.
 *
 * Прогоняется в node-env (vitest) без jsdom/RTL — как reviewDecision и
 * streamFilter, на которые этот модуль опирается по стилю.
 */
import { describe, it, expect } from 'vitest';
import { getTaskPermission, CLAIMABLE_COLUMN } from '@/lib/taskPermissions';

const ME = 'worker-me';
const OTHER = 'worker-other';

const ctx = (role: string | null, workerId: string | null = ME) => ({
  workerId,
  role,
});

const task = (over: Partial<Parameters<typeof getTaskPermission>[0]> = {}) => ({
  created_by: OTHER as string | null,
  assigned_to: null as string | null,
  column: 'in_progress' as string,
  ...over,
});

describe('getTaskPermission', () => {
  it('owner может всё: править и удалять', () => {
    const p = getTaskPermission(task(), ctx('owner'));
    expect(p.isAdmin).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it('admin может всё: править и удалять', () => {
    const p = getTaskPermission(task(), ctx('admin'));
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it('автор может править и удалять', () => {
    const p = getTaskPermission(task({ created_by: ME }), ctx('member'));
    expect(p.isCreator).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it('исполнитель может править, но НЕ удалять', () => {
    const p = getTaskPermission(task({ assigned_to: ME }), ctx('member'));
    expect(p.isAssignee).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(false);
  });

  it('member без авторства и без прав исполнителя — ничего', () => {
    const p = getTaskPermission(task(), ctx('member'));
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canClaim).toBe(false);
  });

  it('viewer — то же, что member без прав', () => {
    const p = getTaskPermission(task(), ctx('viewer'));
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
  });

  it('задача с другим исполнителем недоступна', () => {
    const p = getTaskPermission(task({ assigned_to: OTHER }), ctx('member'));
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
  });

  it('created_by = null не считается авторством', () => {
    const p = getTaskPermission(task({ created_by: null }), ctx('member'));
    expect(p.isCreator).toBe(false);
    expect(p.canDelete).toBe(false);
  });

  it('self-claim: задача из backlog без исполнителя доступна к взятию', () => {
    const p = getTaskPermission(
      task({ column: CLAIMABLE_COLUMN, assigned_to: null }),
      ctx('member'),
    );
    expect(p.canClaim).toBe(true);
    expect(p.canEdit).toBe(false);
  });

  it('self-claim запрещён вне backlog', () => {
    for (const column of ['in_progress', 'review', 'done']) {
      const p = getTaskPermission(
        task({ column, assigned_to: null }),
        ctx('member'),
      );
      expect(p.canClaim).toBe(false);
    }
  });

  it('self-claim запрещён, если исполнитель уже назначен', () => {
    const p = getTaskPermission(
      task({ column: CLAIMABLE_COLUMN, assigned_to: OTHER }),
      ctx('member'),
    );
    expect(p.canClaim).toBe(false);
  });

  it('у автора/исполнителя/админа canClaim всегда false (они уже могут всё)', () => {
    expect(getTaskPermission(task({ column: CLAIMABLE_COLUMN }), ctx('admin')).canClaim).toBe(false);
    expect(
      getTaskPermission(task({ column: CLAIMABLE_COLUMN, created_by: ME }), ctx('member')).canClaim,
    ).toBe(false);
    expect(
      getTaskPermission(task({ column: CLAIMABLE_COLUMN, assigned_to: ME }), ctx('member')).canClaim,
    ).toBe(false);
  });

  it('без workerId (не загружен пользователь) — никаких прав', () => {
    const p = getTaskPermission(task(), ctx('owner', null));
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canClaim).toBe(false);
  });

  it('без задачи — никаких прав, без исключений', () => {
    const p = getTaskPermission(null, ctx('owner'));
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canClaim).toBe(false);
  });

  it('агентский автор (role = null у агента) не даёт прав участнику', () => {
    // Автор-агент не связан с source_id профиля → participant не автор.
    const p = getTaskPermission(task({ created_by: OTHER }), ctx('member'));
    expect(p.isCreator).toBe(false);
    expect(p.canEdit).toBe(false);
  });
});
