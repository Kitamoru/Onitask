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
import { getTaskPermission, getSubtaskPermission, CLAIMABLE_COLUMN } from '@/lib/taskPermissions';

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

describe('getSubtaskPermission (SUB-01) — права на подзадачу', () => {
  const parent = (
    over: Partial<{ created_by: string | null; assigned_to: string | null }> = {},
  ) => ({
    created_by: OTHER as string | null,
    assigned_to: null as string | null,
    ...over,
  });
  const subtask = (
    over: Partial<{ created_by: string | null; assigned_to: string | null; column: string }> = {},
  ) => ({
    created_by: 'admin-who-added' as string | null,
    assigned_to: null as string | null,
    column: CLAIMABLE_COLUMN as string,
    ...over,
  });

  it('исполнитель подзадачи (member) может править и двигать, но НЕ удалять — баг «нет кнопки переместить»', () => {
    // Регрессия: до фикса права считались ТОЛЬКО по родителю, и исполнитель
    // подзадачи — участник без прав на родителя — не видел «Переместить».
    const p = getSubtaskPermission(
      subtask({ assigned_to: ME }),
      parent(),
      ctx('member'),
    );
    expect(p.isAssignee).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(false);
  });

  it('автор родителя сохраняет полные права, даже если подзадачу добавил админ', () => {
    const p = getSubtaskPermission(subtask(), parent({ created_by: ME }), ctx('member'));
    expect(p.isCreator).toBe(true);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it('исполнитель родителя может править подзадачу, но не удалять', () => {
    const p = getSubtaskPermission(subtask(), parent({ assigned_to: ME }), ctx('member'));
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(false);
  });

  it('посторонний member без родительских прав — ничего, кроме self-claim пустой подзадачи в backlog', () => {
    const p = getSubtaskPermission(subtask(), parent(), ctx('member'));
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    // Пустая подзадача в backlog без исполнителя берётся в работу так же,
    // как обычная задача: self-claim решается по подзадаче, не по родителю.
    expect(p.canClaim).toBe(true);
    // А вне backlog claim недоступен.
    expect(
      getSubtaskPermission(subtask({ column: 'in_progress' }), parent(), ctx('member')).canClaim,
    ).toBe(false);
  });

  it('admin может всё (форс-мейдж)', () => {
    const p = getSubtaskPermission(subtask(), parent(), ctx('admin'));
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(true);
  });

  it('parent = null (самостоятельная задача / гонка с CASCADE) — правило по самой строке', () => {
    const own = getSubtaskPermission(subtask({ assigned_to: ME }), null, ctx('member'));
    expect(own.canEdit).toBe(true);
    expect(own.canDelete).toBe(false);

    const stranger = getSubtaskPermission(subtask(), null, ctx('member'));
    expect(stranger.canEdit).toBe(false);
    expect(stranger.canDelete).toBe(false);
  });

  it('self-claim решается по подзадаче: сирота в backlog при родителе с исполнителем — можно взять', () => {
    const p = getSubtaskPermission(
      subtask({ assigned_to: null }),
      parent({ assigned_to: OTHER }),
      ctx('member'),
    );
    expect(p.canClaim).toBe(true);
  });

  it('назначенная подзадача не подлежит self-claim — исполнитель просто правит её', () => {
    const p = getSubtaskPermission(
      subtask({ assigned_to: ME }),
      parent({ assigned_to: OTHER }),
      ctx('member'),
    );
    expect(p.canClaim).toBe(false);
    expect(p.canEdit).toBe(true);
  });

  it('подзадача вне backlog не подлежит self-claim', () => {
    const p = getSubtaskPermission(
      subtask({ column: 'in_progress' }),
      parent(),
      ctx('member'),
    );
    expect(p.canClaim).toBe(false);
  });

  it('без workerId (не загружен пользователь) — никаких прав', () => {
    const p = getSubtaskPermission(subtask({ assigned_to: ME }), parent(), ctx('member', null));
    expect(p.canEdit).toBe(false);
    expect(p.canClaim).toBe(false);
  });
});
